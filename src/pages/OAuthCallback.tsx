import { useEffect, useState } from 'react';
import { getIntakeCallbackUri, verifyOAuthState } from '../lib/intakeConnect.ts';

export default function OAuthCallback() {
  const [status, setStatus] = useState<'working' | 'success' | 'error'>('working');
  const [message, setMessage] = useState('Connecting intake to your calendar…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const returnedState = params.get('state');

    if (error) {
      setStatus('error');
      setMessage(`Google denied the request: ${error}`);
      return;
    }
    if (!code) {
      setStatus('error');
      setMessage('No authorization code was returned.');
      return;
    }
    if (!verifyOAuthState(returnedState)) {
      setStatus('error');
      setMessage('State mismatch — the consent flow may have been tampered with. Please try again.');
      return;
    }

    const workerUrl = import.meta.env.VITE_API_BASE_URL;
    const redirectUri = getIntakeCallbackUri();

    fetch(`${workerUrl}/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Exchange failed (${response.status})`);
        }
        setStatus('success');
        setMessage('Intake is now connected to your calendar. You can close this tab and return to the dashboard.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Exchange failed');
      });
  }, []);

  return (
    <div className="oauth-callback">
      <div className="oauth-card">
        <h2>
          {status === 'working' && 'Connecting…'}
          {status === 'success' && '✓ Connected'}
          {status === 'error' && '⚠ Something went wrong'}
        </h2>
        <p>{message}</p>
        {status !== 'working' && (
          <a href={import.meta.env.BASE_URL}>Back to dashboard</a>
        )}
      </div>
    </div>
  );
}
