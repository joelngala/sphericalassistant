const OFFLINE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');

const STATE_STORAGE_KEY = 'sphericalIntakeOAuthState';

export function getIntakeCallbackUri(): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?page=oauth-callback`;
}

export function getIntakeUrl(firmName: string): string {
  const { origin, pathname } = window.location;
  const params = new URLSearchParams({ page: 'intake', firm: firmName });
  return `${origin}${pathname}?${params.toString()}`;
}

export function startOfflineConsent(): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  }

  // CSRF token for OAuth state round-trip
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_STORAGE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getIntakeCallbackUri(),
    response_type: 'code',
    scope: OFFLINE_SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function verifyOAuthState(returnedState: string | null): boolean {
  const saved = sessionStorage.getItem(STATE_STORAGE_KEY);
  if (!saved || !returnedState) return false;
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  return saved === returnedState;
}

export interface IntakeConnectionStatus {
  connected: boolean;
}

export async function fetchIntakeConnectionStatus(): Promise<IntakeConnectionStatus> {
  const workerUrl = import.meta.env.VITE_API_BASE_URL;
  const response = await fetch(`${workerUrl}/oauth/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    return { connected: false };
  }
  const data = await response.json();
  return { connected: Boolean(data.connected) };
}
