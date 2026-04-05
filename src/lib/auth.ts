import type { GoogleUser } from '../types.ts';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

let tokenClient: google.accounts.oauth2.TokenClient | null = null;

export function initAuth(
  onSuccess: (user: GoogleUser) => void,
  onError: (error: string) => void
): void {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (!clientId || clientId === 'your-client-id.apps.googleusercontent.com') {
    onError('Google Client ID is not configured. Set VITE_GOOGLE_CLIENT_ID in .env');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error) {
        onError(response.error_description || response.error);
        return;
      }

      if (!response.access_token) {
        onError('No access token received');
        return;
      }

      try {
        const user = await getUserInfo(response.access_token);
        onSuccess(user);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to get user info');
      }
    },
    error_callback: (error) => {
      onError(error.message || 'Authentication failed');
    },
  });
}

export function requestToken(): void {
  if (!tokenClient) {
    throw new Error('Auth not initialized. Call initAuth() first.');
  }
  tokenClient.requestAccessToken({ prompt: '' });
}

export function requestTokenWithConsent(): void {
  if (!tokenClient) {
    throw new Error('Auth not initialized. Call initAuth() first.');
  }
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function getUserInfo(accessToken: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  const data = await response.json();

  return {
    email: data.email,
    name: data.name,
    picture: data.picture,
    accessToken,
  };
}

export function revokeToken(accessToken: string): void {
  google.accounts.oauth2.revoke(accessToken);
}
