import type { AppointmentAnalysis, CalendarEvent, ClientContact, EmailDraft, EstimateResult } from '../types.ts';

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
  businessContext?: string
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
    businessContext,
  });
}

export async function generateEmailDraft(
  type: 'confirmation' | 'reminder' | 'followup',
  event: CalendarEvent,
  client: ClientContact | null,
  businessName?: string
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
    businessName,
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
