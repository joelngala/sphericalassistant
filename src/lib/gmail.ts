const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRawMessage(to: string, subject: string, body: string, fromName?: string): string {
  const from = fromName ? `${fromName}` : '';
  const lines = [
    from ? `From: ${from}` : '',
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].filter(Boolean);

  return base64UrlEncode(lines.join('\r\n'));
}

export async function createDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  fromName?: string
): Promise<{ draftId: string; gmailUrl: string }> {
  const raw = buildRawMessage(to, subject, body, fromName);

  const response = await fetch(`${GMAIL_BASE}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Gmail API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    draftId: data.id,
    gmailUrl: 'https://mail.google.com/mail/#drafts',
  };
}
