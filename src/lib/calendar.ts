import type { CalendarEvent, WorkflowState } from '../types.ts';

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

export function getWorkflowState(event: CalendarEvent): WorkflowState {
  const raw = event.extendedProperties?.private?.sphericalAssistant;
  if (!raw) return { status: 'new' };

  try {
    return JSON.parse(raw) as WorkflowState;
  } catch {
    return { status: 'new' };
  }
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

export function parseServiceType(summary: string): string {
  const parts = summary.split(/[-–—]/);
  return parts[0].trim() || summary.trim();
}

export function getClientNameFromSummary(summary: string): string {
  const parts = summary.split(/[-–—]/);
  return parts.length > 1 ? parts.slice(1).join('-').trim() : '';
}

export function getAttendeeEmails(event: CalendarEvent): string[] {
  return (event.attendees || [])
    .filter((a) => !a.self)
    .map((a) => a.email);
}

export function getEventDateTime(event: CalendarEvent): Date {
  const dt = event.start.dateTime || event.start.date || '';
  return new Date(dt);
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
