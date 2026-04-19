import type { CourtRecordsPayload, CourtRecordMatch, CourtHearingMatch } from '../types.ts';
import { buildHoverCaseLink } from '../lib/calendar.ts';

interface CourtRecordsCardProps {
  payload: CourtRecordsPayload;
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

function RecordRow({ rec }: { rec: CourtRecordMatch }) {
  const hoverUrl = buildHoverCaseLink(rec.caseNumber);
  const identity = [rec.name || '(no name)', rec.dob ? `DOB ${rec.dob}` : null].filter(Boolean).join(' • ');
  const unrepresented = rec.attorney && rec.attorney.toLowerCase().includes('no attorney');
  return (
    <div className="court-row">
      <div className="court-row-header">
        <ConfidenceDot level={rec.confidence} />
        <span className="court-case">{rec.caseNumber || '—'}</span>
        <span className={`court-badge court-badge-${rec.source || 'filing'}`}>
          {rec.source === 'citation' ? '🚗 Citation' : '⚖️ Filing'}
        </span>
        {hoverUrl && (
          <a className="court-hover-link" href={hoverUrl} target="_blank" rel="noopener noreferrer" title="Open on HOVER">
            ↗
          </a>
        )}
      </div>
      <div className="court-row-identity">{identity}</div>
      {rec.caseType && <div className="court-row-meta">{rec.caseType}</div>}
      {rec.charge && (
        <div className="court-row-charge">
          {rec.charge}
          {rec.chargeCount > 1 && <span className="court-row-more"> +{rec.chargeCount - 1} more</span>}
        </div>
      )}
      {rec.attorney && (
        <div className={`court-row-attorney ${unrepresented ? 'court-row-unrep' : ''}`}>
          {unrepresented ? 'Unrepresented — opportunity' : `Attorney: ${rec.attorney}`}
        </div>
      )}
      {rec.filingDate && <div className="court-row-date">Filed {rec.filingDate}</div>}
    </div>
  );
}

function HearingRow({ h }: { h: CourtHearingMatch }) {
  const hoverUrl = buildHoverCaseLink(h.caseNumber);
  const docket = [h.courtDate, h.session, h.room].filter(Boolean).join(' • ');
  return (
    <div className="court-row">
      <div className="court-row-header">
        <ConfidenceDot level={h.confidence} />
        <span className="court-case">{h.caseNumber || '—'}</span>
        {h.calendarType && (
          <span className="court-badge court-badge-hearing">🏛️ {h.calendarType.toUpperCase()}</span>
        )}
        {hoverUrl && (
          <a className="court-hover-link" href={hoverUrl} target="_blank" rel="noopener noreferrer" title="Open on HOVER">
            ↗
          </a>
        )}
      </div>
      <div className="court-row-identity">
        {h.name || '(no name)'}
        {h.dob && <> • DOB {h.dob}</>}
      </div>
      {docket && <div className="court-row-meta">{docket}</div>}
      {h.setFor && <div className="court-row-charge">{h.setFor}</div>}
      {h.nextFuture && <div className="court-row-date">Next setting: {h.nextFuture}</div>}
      {h.url && (
        <a className="court-row-source" href={h.url} target="_blank" rel="noopener noreferrer">
          Source calendar PDF ↗
        </a>
      )}
    </div>
  );
}

export default function CourtRecordsCard({ payload }: CourtRecordsCardProps) {
  const { records, hearings, recordsCount, hearingsCount, recordsWindow, hearingsWindow } = payload;
  const hasAny = records.length > 0 || hearings.length > 0;
  if (!hasAny) return null;

  return (
    <section className="court-card">
      <header className="court-card-header">
        <div>
          <h3>Hillsborough Court Records</h3>
          <p className="subtitle">
            Auto-pulled from county filings and published court calendars at intake.
          </p>
        </div>
        <div className="court-card-stats">
          {records.length > 0 && (
            <span className="court-stat" title={`All matches in last ${recordsWindow} days`}>
              {recordsCount} filing{recordsCount === 1 ? '' : 's'}
            </span>
          )}
          {hearings.length > 0 && (
            <span className="court-stat" title={`Hearings within next ${hearingsWindow} days`}>
              {hearingsCount} hearing{hearingsCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </header>

      {records.length > 0 && (
        <div className="court-section">
          <h4 className="court-section-title">Recent filings & citations</h4>
          <div className="court-rows">
            {records.map((rec, idx) => (
              <RecordRow key={`${rec.source}-${rec.caseNumber}-${idx}`} rec={rec} />
            ))}
          </div>
          {recordsCount > records.length && (
            <p className="court-section-footer">
              Showing top {records.length} of {recordsCount} — see event description for full list.
            </p>
          )}
        </div>
      )}

      {hearings.length > 0 && (
        <div className="court-section">
          <h4 className="court-section-title">Upcoming hearings</h4>
          <div className="court-rows">
            {hearings.map((h, idx) => (
              <HearingRow key={`${h.caseNumber}-${h.courtDate}-${h.session}-${idx}`} h={h} />
            ))}
          </div>
          {hearingsCount > hearings.length && (
            <p className="court-section-footer">
              Showing top {hearings.length} of {hearingsCount} — verify on HOVER for last-minute changes.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
