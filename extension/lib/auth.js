import { OAUTH_CLIENT_ID, OAUTH_SCOPES } from './config.js';

const TOKEN_KEY = 'spherical.googleToken';

export async function getStoredToken() {
  const { [TOKEN_KEY]: entry } = await chrome.storage.local.get(TOKEN_KEY);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) return null;
  return entry;
}

export async function clearToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function getAccessToken({ interactive = true } = {}) {
  const existing = await getStoredToken();
  if (existing) return existing.accessToken;

  if (!OAUTH_CLIENT_ID) {
    throw new Error('OAUTH_CLIENT_ID is not set in lib/config.js');
  }

  const redirectUri = chrome.identity.getRedirectURL('oauth');
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: OAUTH_SCOPES,
    include_granted_scopes: 'true',
    prompt: interactive ? 'consent' : 'none',
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const redirect = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (response) => {
      if (chrome.runtime.lastError || !response) {
        return reject(new Error(chrome.runtime.lastError?.message || 'OAuth flow did not complete'));
      }
      resolve(response);
    });
  });

  const fragment = new URL(redirect).hash.slice(1);
  const out = new URLSearchParams(fragment);
  const accessToken = out.get('access_token');
  const expiresIn = Number(out.get('expires_in') || 3600);
  if (!accessToken) throw new Error('No access token returned by Google');

  const entry = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await chrome.storage.local.set({ [TOKEN_KEY]: entry });
  return accessToken;
}

export async function getUserProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}
