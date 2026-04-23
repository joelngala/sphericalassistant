import type { MilwaukeePayload, MilwaukeeWibrMatch, MilwaukeeCrashMatch } from '../types.ts';

interface MilwaukeeRecordsCardProps {
  payload: MilwaukeePayload;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

function normalizeConfidence(level: string): ConfidenceLevel {
  if (level === 'high' || level === 'medium' || level === 'low') return level;
  return 'low';
}

function ConfidenceDot({ level }: { level: string }) {
  const normalized = normalizeConfidence(level);
  const label = normalized === 'high'
    ? 'High confidence match'
    : normalized === 'medium'
      ? 'Medium confidence match'
      : 'Low confidence match';
  return <span className={`court-conf court-conf-${normalized}`} title={label} aria-label={label} />;
}

function WibrRow({ m }: { m: MilwaukeeWibrMatch }) {
  const meta = [
    m.zip ? `ZIP ${m.zip}` : null,
    m.district ? `District ${m.district}` : null,
  ].filter(Boolean).join(' • ');
  return (
    <div className="court-row">
      <div className="court-row-header">
        <ConfidenceDot level={m.confidence} />
        <span className="court-case">{m.incidentNum || '—'}</span>
        <span className="court-badge court-badge-filing">🚨 WIBR</span>
      </div>
      <div className="court-row-identity">{m.location || '(no location)'}</div>
      {meta && <div className="court-row-meta">{meta}</div>}
      {m.offenses && m.offenses.length > 0 && (
        <div className="court-row-charge">{m.offenses.join(', ')}</div>
      )}
      {m.reportedAt && <div className="court-row-date">Reported {m.reportedAt}</div>}
    </div>
  );
}

function CrashRow({ m }: { m: MilwaukeeCrashMatch }) {
  return (
    <div className="court-row">
      <div className="court-row-header">
        <ConfidenceDot level={m.confidence} />
        <span className="court-case">{m.caseNumber || '—'}</span>
        <span className="court-badge court-badge-citation">🚗 Crash</span>
      </div>
      <div className="court-row-identity">{m.location || '(no location)'}</div>
      {m.caseDate && <div className="court-row-date">{m.caseDate}</div>}
    </div>
  );
}

export default function MilwaukeeRecordsCard({ payload }: MilwaukeeRecordsCardProps) {
  const { anchor, wibr, crashes, fpc } = payload;
  const hasRows = wibr.length > 0 || crashes.length > 0;
  const hasFpc = Boolean(fpc && (fpc.mpdTotal || fpc.mpdOpen));
  if (!hasRows && !hasFpc && !anchor) return null;

  const anchorBits = anchor
    ? [
        anchor.date ? `date ${anchor.date}` : null,
        anchor.address ? `addr "${anchor.address}"` : null,
        anchor.offense ? `type ${anchor.offense}` : null,
      ].filter(Boolean).join(' • ')
    : '';

  return (
    <section className="court-card">
      <header className="court-card-header">
        <div>
          <h3>Milwaukee Portal</h3>
          <p className="subtitle">
            Auto-pulled from the City of Milwaukee Open Data Portal at intake.
          </p>
        </div>
        <div className="court-card-stats">
          {wibr.length > 0 && (
            <span className="court-stat" title="Crime incidents">
              {wibr.length} WIBR
            </span>
          )}
          {crashes.length > 0 && (
            <span className="court-stat" title="Traffic crashes">
              {crashes.length} crash{crashes.length === 1 ? '' : 'es'}
            </span>
          )}
        </div>
      </header>

      {anchorBits && (
        <p className="subtitle" style={{ marginTop: 0 }}>
          Anchored on {anchorBits}.
        </p>
      )}

      {wibr.length > 0 && (
        <div className="court-section">
          <h4 className="court-section-title">WIBR crime incidents</h4>
          <div className="court-rows">
            {wibr.map((m, idx) => (
              <WibrRow key={`${m.incidentNum}-${idx}`} m={m} />
            ))}
          </div>
        </div>
      )}

      {crashes.length > 0 && (
        <div className="court-section">
          <h4 className="court-section-title">Traffic crashes</h4>
          <div className="court-rows">
            {crashes.map((m, idx) => (
              <CrashRow key={`${m.caseNumber}-${idx}`} m={m} />
            ))}
          </div>
        </div>
      )}

      {hasFpc && fpc && (
        <div className="court-section">
          <h4 className="court-section-title">FPC complaint context</h4>
          <p className="subtitle" style={{ marginTop: 0 }}>
            Public dataset redacts officer names — department-level totals only.
          </p>
          <div className="court-row">
            <div className="court-row-identity">
              MPD: {fpc.mpdTotal} total • {fpc.mpdOpen} open • {fpc.mpdLastYear} in last 12 months
            </div>
            {fpc.topCategories.length > 0 && (
              <div className="court-row-meta">
                Top categories: {fpc.topCategories.map((c) => `${c.category} (${c.count})`).join(' • ')}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
