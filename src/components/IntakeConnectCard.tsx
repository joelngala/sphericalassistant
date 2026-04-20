import { useEffect, useState } from 'react';
import {
  disconnectIntake,
  fetchIntakeConnectionStatus,
  getIntakeUrl,
  startOfflineConsent,
} from '../lib/intakeConnect.ts';

interface IntakeConnectCardProps {
  firmName: string;
  compact?: boolean;
}

export default function IntakeConnectCard({ firmName, compact = false }: IntakeConnectCardProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'form' | 'chat' | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

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

  const formUrl = getIntakeUrl(firmName || 'Your Firm', 'form');
  const chatUrl = getIntakeUrl(firmName || 'Your Firm', 'chat');

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

  async function handleCopy(kind: 'form' | 'chat') {
    try {
      await navigator.clipboard.writeText(kind === 'chat' ? chatUrl : formUrl);
      setCopied(kind);
      setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  if (compact && !expanded) {
    return (
      <section className="intake-compact">
        <div className="intake-compact-left">
          {loading ? (
            <div className="spinner-sm" />
          ) : connected ? (
            <span className="intake-compact-dot intake-compact-dot-ok" />
          ) : (
            <span className="intake-compact-dot intake-compact-dot-off" />
          )}
          <span className="intake-compact-label">Client intake</span>
          <span className="intake-compact-status">
            {loading ? 'checking…' : connected ? 'live' : 'not connected'}
          </span>
        </div>
        <div className="intake-compact-right">
          {!loading && connected && (
            <>
              <button className="btn-secondary btn-xs" onClick={() => handleCopy('form')}>
                {copied === 'form' ? 'Copied!' : 'Copy form'}
              </button>
              <button className="btn-secondary btn-xs" onClick={() => handleCopy('chat')}>
                {copied === 'chat' ? 'Copied!' : 'Copy chat'}
              </button>
            </>
          )}
          {!loading && !connected && (
            <button className="btn-primary btn-xs" onClick={handleConnect}>
              Connect
            </button>
          )}
          <button className="btn-link btn-xs" onClick={() => setExpanded(true)}>
            Manage
          </button>
        </div>
        {error && <div className="intake-connect-error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="intake-connect-card">
      <div className="intake-connect-head">
        <div>
          <h3>Client Intake</h3>
          <p className="subtitle">
            Two public intake links for new clients — a traditional form or a guided chat.
            Share either, embed on your site, or open on a tablet.
          </p>
        </div>
        <div className="intake-connect-head-right">
          {loading ? (
            <div className="spinner-sm" />
          ) : connected ? (
            <span className="intake-connect-badge intake-connect-badge-ok">✓ Connected</span>
          ) : (
            <span className="intake-connect-badge intake-connect-badge-off">Not connected</span>
          )}
          {compact && (
            <button className="btn-link btn-xs" onClick={() => setExpanded(false)}>
              Collapse
            </button>
          )}
        </div>
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
            Your intake is live. Share either link — both drop new leads onto your calendar the same way:
          </p>
          <div className="intake-connect-url-group">
            <div className="intake-connect-url-label">Form (structured fields)</div>
            <div className="intake-connect-url-row">
              <code className="intake-connect-url">{formUrl}</code>
              <button className="btn-secondary" onClick={() => handleCopy('form')}>
                {copied === 'form' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="intake-connect-url-group">
            <div className="intake-connect-url-label">Guided chat (conversational)</div>
            <div className="intake-connect-url-row">
              <code className="intake-connect-url">{chatUrl}</code>
              <button className="btn-secondary" onClick={() => handleCopy('chat')}>
                {copied === 'chat' ? 'Copied!' : 'Copy'}
              </button>
            </div>
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
