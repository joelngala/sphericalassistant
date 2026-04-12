import type {
  BusinessInsights,
  MorningBrief,
  AppointmentAnalysis,
  CalendarEvent,
  ClientContact,
  DraftPreviewData,
  EmailDraft,
  EmailPreferences,
  EstimateResult,
} from '../types.ts';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

function getApiBaseUrl(): string {
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl.replace(/\/+$/, '');
  }

  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:8787';
  }

  return '';
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    throw new Error('AI service is not configured for this deployment.');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed');
  }

  return payload as T;
}

export function isAiServiceConfigured(): boolean {
  return getApiBaseUrl().length > 0;
}

export async function analyzeAppointment(
  event: CalendarEvent,
  client: ClientContact | null,
  preferences?: EmailPreferences
): Promise<AppointmentAnalysis> {
  return postJson<AppointmentAnalysis>('/analyze', {
    appointment: {
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description,
    },
    client: client
      ? {
          name: client.name,
          email: client.email,
          phone: client.phone,
          address: client.address,
          notes: client.notes,
        }
      : { name: 'Unknown', email: 'Unknown' },
    businessContext: buildBusinessContext(preferences),
  });
}

export async function generateEmailDraft(
  type: 'confirmation' | 'reminder' | 'followup',
  event: CalendarEvent,
  client: ClientContact | null,
  preferences?: EmailPreferences
): Promise<EmailDraft> {
  return postJson<EmailDraft>('/draft', {
    type,
    appointment: {
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description,
    },
    client: client
      ? { name: client.name, email: client.email }
      : { name: 'Valued Client', email: '' },
    preferences,
  });
}

export async function generateEstimate(
  serviceType: string,
  details: string,
  client: ClientContact | null
): Promise<EstimateResult> {
  return postJson<EstimateResult>('/estimate', {
    serviceType,
    details,
    client: client
      ? { name: client.name, address: client.address }
      : { name: 'Client' },
  });
}

export async function refineEmailDraft(
  instruction: string,
  draft: DraftPreviewData,
  event: CalendarEvent,
  client: ClientContact | null,
  preferences?: EmailPreferences
): Promise<EmailDraft> {
  return postJson<EmailDraft>('/refine-draft', {
    instruction,
    draft: {
      subject: draft.subject,
      body: draft.body,
      to: draft.to,
    },
    appointment: {
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description,
    },
    client: client
      ? {
          name: client.name,
          email: client.email,
          phone: client.phone,
          address: client.address,
          notes: client.notes,
        }
      : { name: 'Valued Client', email: draft.to },
    preferences,
  });
}

function buildBusinessContext(preferences?: EmailPreferences): string | undefined {
  if (!preferences) return undefined;

  const lines = [
    preferences.businessType ? `Business type: ${preferences.businessType}` : '',
    preferences.businessName ? `Business name: ${preferences.businessName}` : '',
    preferences.senderName ? `Sender name: ${preferences.senderName}` : '',
    preferences.serviceAreas ? `Service areas: ${preferences.serviceAreas}` : '',
    preferences.workingHours ? `Working hours: ${preferences.workingHours}` : '',
    preferences.leadGoals ? `Lead goals: ${preferences.leadGoals}` : '',
    preferences.repeatBusinessGoals ? `Repeat business goals: ${preferences.repeatBusinessGoals}` : '',
    preferences.noShowPolicy ? `No-show policy: ${preferences.noShowPolicy}` : '',
    preferences.estimatePolicy ? `Estimate policy: ${preferences.estimatePolicy}` : '',
    preferences.writingTone ? `Preferred tone: ${preferences.writingTone}` : '',
    preferences.generalInstructions ? `General instructions: ${preferences.generalInstructions}` : '',
    preferences.reviewLink ? `Review link: ${preferences.reviewLink}` : '',
    preferences.storefrontSummary ? `Storefront summary: ${preferences.storefrontSummary}` : '',
    preferences.signature ? `Default signature:\n${preferences.signature}` : '',
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : undefined;
}

export async function generateBusinessInsights(
  events: CalendarEvent[],
  preferences?: EmailPreferences
): Promise<BusinessInsights> {
  return postJson<BusinessInsights>('/business-insights', {
    events: events.map((event) => ({
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description,
      attendees: event.attendees?.map((attendee) => ({
        email: attendee.email,
        responseStatus: attendee.responseStatus,
      })),
    })),
    preferences,
  });
}

export async function generateMorningBrief(
  events: CalendarEvent[],
  preferences?: EmailPreferences
): Promise<MorningBrief> {
  return postJson<MorningBrief>('/morning-brief', {
    events: events.map((event) => ({
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      description: event.description,
      attendees: event.attendees?.map((attendee) => ({
        email: attendee.email,
        responseStatus: attendee.responseStatus,
      })),
    })),
    preferences,
  });
}
