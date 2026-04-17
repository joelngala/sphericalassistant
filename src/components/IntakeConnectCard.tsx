import { useEffect, useState } from 'react';
import {
  disconnectIntake,
  fetchIntakeConnectionStatus,
  getIntakeUrl,
  startOfflineConsent,
} from '../lib/intakeConnect.ts';

interface IntakeConnectCardProps {
  firmName: string;
}

export default function IntakeConnectCard({ firmName }: IntakeConnectCardProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIntakeConnectionStatus()
      .then((status) => {
        if (!cancelled) setConnected(status.connected);
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach intake service');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const intakeUrl = getIntakeUrl(firmName || 'Your Firm');

  function handleConnect() {
    try {
      startOfflineConsent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start consent flow');
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    const confirmed = window.confirm(
      'Disconnect intake from your calendar? New intakes will stop creating calendar events until you reconnect.'
    );
    if (!confirmed) return;

    setDisconnecting(true);
    setError('');
    try {
      await disconnectIntake();
      setConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect intake');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(intakeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  return (
    <section className="intake-connect-card">
      <div className="intake-connect-head">
        <div>
          <h3>Client Intake Form</h3>
          <p className="subtitle">
            A public form for new clients. Share the link, embed on your site, or open it on a tablet.
          </p>
        </div>
        {loading ? (
          <div className="spinner-sm" />
        ) : connected ? (
          <span className="intake-connect-badge intake-connect-badge-ok">✓ Connected</span>
        ) : (
          <span className="intake-connect-badge intake-connect-badge-off">Not connected</span>
        )}
      </div>

      {!loading && !connected && (
        <>
          <p className="intake-connect-body">
            Grant the intake form permission to drop new leads into your calendar.
            One-time click; you never have to sign in again for intakes.
          </p>
          <button className="btn-primary" onClick={handleConnect}>
            Connect intake to my calendar
          </button>
        </>
      )}

      {!loading && connected && (
        <>
          <p className="intake-connect-body">
            Your intake form is live. Share this link or drop it on your website:
          </p>
          <div className="intake-connect-url-row">
            <code className="intake-connect-url">{intakeUrl}</code>
            <button className="btn-secondary" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="intake-connect-hint">
            New intakes will appear on your calendar as yellow "New Lead" events
            that don't block your time. Urgent intakes show in red.
          </p>
          <button className="btn-link" onClick={handleConnect}>
            Reconnect
          </button>
          <button className="btn-link" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </>
      )}

      {error && <div className="intake-connect-error">{error}</div>}
    </section>
  );
}
