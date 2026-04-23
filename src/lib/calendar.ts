import type {
  AppointmentFormData,
  AssistantReminderData,
  CalendarAttendee,
  CalendarEvent,
  WorkflowState,
} from '../types.ts';
import type { LinkedDocument } from './docs.ts';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch<T>(accessToken: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${CALENDAR_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Calendar API error: ${response.status}`);
  }

  return response.json();
}

export async function fetchUpcomingEvents(
  accessToken: string,
  days: number = 14
): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    orderBy: 'startTime',
    singleEvents: 'true',
    maxResults: '50',
  });

  const data = await calendarFetch<{ items?: CalendarEvent[] }>(
    accessToken,
    `/calendars/primary/events?${params}`
  );

  return data.items || [];
}

export async function fetchCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<CalendarEvent> {
  return calendarFetch<CalendarEvent>(
    accessToken,
    `/calendars/primary/events/${eventId}`
  );
}

export async function createAssistantReminderEvent(
  accessToken: string,
  reminder: AssistantReminderData,
  startAt: Date
): Promise<CalendarEvent> {
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

  return calendarFetch<CalendarEvent>(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: `[Spherical] ${reminder.title}`,
      description: reminder.detail,
      start: { dateTime: startAt.toISOString() },
      end: { dateTime: endAt.toISOString() },
      transparency: 'transparent',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 10 },
          { method: 'email', minutes: 60 },
        ],
      },
      extendedProperties: {
        private: {
          sphericalAssistantReminder: JSON.stringify(reminder),
        },
      },
    }),
  });
}

export async function createCalendarEvent(
  accessToken: string,
  form: AppointmentFormData
): Promise<CalendarEvent> {
  const summaryParts = [form.title.trim()];
  if (form.clientName.trim()) {
    summaryParts.push(form.clientName.trim());
  }

  const startDateTime = buildLocalDateTime(form.date, form.startTime);
  const endDateTime = buildLocalDateTime(form.date, form.endTime);

  const body: Record<string, unknown> = {
    summary: summaryParts.join(' - '),
    description: form.notes.trim() || undefined,
    location: form.location.trim() || undefined,
    start: { dateTime: startDateTime },
    end: { dateTime: endDateTime },
  };

  if (form.clientEmail.trim()) {
    body.attendees = [
      {
        email: form.clientEmail.trim(),
        ...(form.clientName.trim() ? { displayName: form.clientName.trim() } : {}),
      },
    ];
  }

  return calendarFetch<CalendarEvent>(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getWorkflowState(event: CalendarEvent): WorkflowState {
  const raw = event.extendedProperties?.private?.sphericalAssistant;
  if (!raw) return { status: 'new' };

  try {
    return JSON.parse(raw) as WorkflowState;
  } catch {
    return { status: 'new' };
  }
}

export function getAssistantReminder(event: CalendarEvent): AssistantReminderData | null {
  const raw = event.extendedProperties?.private?.sphericalAssistantReminder;
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AssistantReminderData;
  } catch {
    return null;
  }
}

export function isAssistantReminderEvent(event: CalendarEvent): boolean {
  return getAssistantReminder(event) !== null || event.summary.startsWith('[Spherical]');
}

export function isIntakeEvent(event: CalendarEvent): boolean {
  const source = event.extendedProperties?.private?.intakeSource;
  if (source) return true;
  const workflow = getWorkflowState(event);
  return workflow.source === 'intake-chatbot';
}

export function getIntakeReceivedAt(event: CalendarEvent): Date | null {
  const workflow = getWorkflowState(event);
  if (!workflow.receivedAt) return null;
  const d = new Date(workflow.receivedAt);
  return isNaN(d.getTime()) ? null : d;
}

export function isFreshIntake(event: CalendarEvent, windowMs = 24 * 60 * 60 * 1000): boolean {
  if (!isIntakeEvent(event)) return false;
  const received = getIntakeReceivedAt(event);
  if (!received) return false;
  return Date.now() - received.getTime() <= windowMs;
}

export async function updateEventWorkflow(
  accessToken: string,
  eventId: string,
  state: WorkflowState
): Promise<void> {
  await calendarFetch(accessToken, `/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      extendedProperties: {
        private: {
          sphericalAssistant: JSON.stringify(state),
        },
      },
    }),
  });
}

export async function updateEventDescription(
  accessToken: string,
  eventId: string,
  description: string,
): Promise<CalendarEvent> {
  return calendarFetch<CalendarEvent>(accessToken, `/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({ description }),
  });
}

export async function updateEventAttendee(
  accessToken: string,
  event: CalendarEvent,
  email: string,
  displayName?: string
): Promise<CalendarEvent> {
  const attendees = upsertClientAttendee(event.attendees || [], email, displayName);

  return calendarFetch<CalendarEvent>(accessToken, `/calendars/primary/events/${event.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ attendees }),
  });
}

export function parseServiceType(summary: string): string {
  const parts = summary.split(/[-–—]/);
  return parts[0].trim() || summary.trim();
}

export function getClientNameFromSummary(summary: string): string {
  const parts = summary.split(/[-–—]/);
  return parts.length > 1 ? parts.slice(1).join('-').trim() : '';
}

export function getCaseNumberFromEvent(event: CalendarEvent): string {
  const stored = event.extendedProperties?.private?.sphericalCaseNumber;
  if (stored) return stored.trim();
  const desc = event.description || '';
  const match = desc.match(/case\s*(?:number|#)\s*[:\-]?\s*([A-Za-z0-9\-./]+)/i);
  return match ? match[1].trim() : '';
}

export function getCourtRecords(event: CalendarEvent): import('../types.ts').CourtRecordsPayload | null {
  const raw = event.extendedProperties?.private?.sphericalCourt;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as import('../types.ts').CourtRecordsPayload;
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    const hearings = Array.isArray(parsed.hearings) ? parsed.hearings : [];
    const recordsWindow = Number.isFinite(parsed.recordsWindow) ? parsed.recordsWindow : 0;
    const hearingsWindow = Number.isFinite(parsed.hearingsWindow) ? parsed.hearingsWindow : 0;
    const recordsCount = Number.isFinite(parsed.recordsCount) ? parsed.recordsCount : records.length;
    const hearingsCount = Number.isFinite(parsed.hearingsCount) ? parsed.hearingsCount : hearings.length;
    return {
      records,
      hearings,
      recordsWindow,
      hearingsWindow,
      recordsCount,
      hearingsCount,
    };
  } catch {
    return null;
  }
}

export function getMilwaukeeRecords(event: CalendarEvent): import('../types.ts').MilwaukeePayload | null {
  const raw = event.extendedProperties?.private?.sphericalMilwaukee;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as import('../types.ts').MilwaukeePayload;
    return {
      anchor: parsed.anchor || null,
      wibr: Array.isArray(parsed.wibr) ? parsed.wibr : [],
      crashes: Array.isArray(parsed.crashes) ? parsed.crashes : [],
      fpc: parsed.fpc || null,
      windowDays: Number.isFinite(parsed.windowDays) ? parsed.windowDays : 0,
    };
  } catch {
    return null;
  }
}

export function buildHoverCaseLink(caseNumber: string): string {
  const n = (caseNumber || '').trim();
  if (!n) return '';
  return `https://hover.hillsclerk.com/html/case/caseSummary.html?caseNumber=${encodeURIComponent(n)}`;
}

export function getMatterFolderLabel(event: CalendarEvent): string {
  const client = getClientNameFromSummary(event.summary) || 'Unknown Client';
  const caseNo = getCaseNumberFromEvent(event);
  return caseNo ? `${client} — ${caseNo}` : client;
}

export function getAttendeeEmails(event: CalendarEvent): string[] {
  return (event.attendees || [])
    .filter((a) => !a.self)
    .map((a) => a.email);
}

function upsertClientAttendee(
  attendees: CalendarAttendee[],
  email: string,
  displayName?: string
): CalendarAttendee[] {
  const nextAttendees = [...attendees];
  const clientIndex = nextAttendees.findIndex((attendee) => !attendee.self);

  if (clientIndex >= 0) {
    nextAttendees[clientIndex] = {
      ...nextAttendees[clientIndex],
      email,
      ...(displayName ? { displayName } : {}),
    };
    return nextAttendees;
  }

  nextAttendees.push({
    email,
    ...(displayName ? { displayName } : {}),
  });

  return nextAttendees;
}

function buildLocalDateTime(date: string, time: string): string {
  const localDate = new Date(`${date}T${time}`);
  return localDate.toISOString();
}

export function getEventDateTime(event: CalendarEvent): Date {
  if (event.start.dateTime) return new Date(event.start.dateTime);
  if (event.start.date) {
    const [y, m, d] = event.start.date.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return new Date(NaN);
}

export function formatEventTime(event: CalendarEvent): string {
  const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end.dateTime ? new Date(event.end.dateTime) : null;

  if (!start) return 'All day';

  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const startStr = start.toLocaleTimeString([], timeOpts);
  const endStr = end ? end.toLocaleTimeString([], timeOpts) : '';

  return endStr ? `${startStr} - ${endStr}` : startStr;
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const dt = getEventDateTime(event);
    const key = dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let label = key;
    if (dt.toDateString() === today.toDateString()) label = 'Today';
    else if (dt.toDateString() === tomorrow.toDateString()) label = 'Tomorrow';

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(event);
  }

  return groups;
}

export function getLinkedDocuments(event: CalendarEvent): LinkedDocument[] {
  const raw = event.extendedProperties?.private?.sphericalLinkedDocs;
  if (!raw) return [];

  try {
    return JSON.parse(raw) as LinkedDocument[];
  } catch {
    return [];
  }
}

export async function addLinkedDocument(
  accessToken: string,
  event: CalendarEvent,
  doc: LinkedDocument
): Promise<CalendarEvent> {
  const existing = getLinkedDocuments(event);
  const updated = [...existing, doc];

  return calendarFetch<CalendarEvent>(accessToken, `/calendars/primary/events/${event.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      extendedProperties: {
        private: {
          ...event.extendedProperties?.private,
          sphericalLinkedDocs: JSON.stringify(updated),
        },
      },
    }),
  });
}
