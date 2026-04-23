import { useState } from 'react';

type Jurisdiction =
  | 'hillsborough-fl'
  | 'milwaukee-wi'
  | 'dane-wi'
  | 'waukesha-wi'
  | 'racine-wi'
  | 'brown-wi';

interface JurisdictionOption {
  value: Jurisdiction;
  label: string;
  system: 'hillsborough' | 'wcca';
  wccaCounty?: string;
  badge: string;
}

const JURISDICTIONS: JurisdictionOption[] = [
  { value: 'hillsborough-fl', label: 'Hillsborough County, FL', system: 'hillsborough', badge: 'HOVER + Public Records' },
  { value: 'milwaukee-wi', label: 'Milwaukee County, WI', system: 'wcca', wccaCounty: '40', badge: 'WCCA (Wisconsin)' },
  { value: 'dane-wi', label: 'Dane County, WI', system: 'wcca', wccaCounty: '13', badge: 'WCCA (Wisconsin)' },
  { value: 'waukesha-wi', label: 'Waukesha County, WI', system: 'wcca', wccaCounty: '67', badge: 'WCCA (Wisconsin)' },
  { value: 'racine-wi', label: 'Racine County, WI', system: 'wcca', wccaCounty: '51', badge: 'WCCA (Wisconsin)' },
  { value: 'brown-wi', label: 'Brown County, WI', system: 'wcca', wccaCounty: '05', badge: 'WCCA (Wisconsin)' },
];

interface HillsboroughMatch {
  source: 'citation' | 'filing';
  caseNumber: string;
  filingDate: string | null;
  defendant: {
    firstName: string;
    middleName: string;
    lastName: string;
    dob: string | null;
    city: string;
    zip: string;
  };
  charges: Array<{ description?: string; statute?: string }>;
  attorney: string | null;
  caseType?: string;
  match: { score: number; confidence: string; reasons: string[] };
}

interface HillsboroughResult {
  ok: boolean;
  windowDays?: number;
  matchCount?: number;
  matches?: HillsboroughMatch[];
  error?: string;
}

function wccaCaseDetailUrl(caseNumber: string, countyNo: string): string {
  const q = new URLSearchParams({ caseNo: caseNumber, countyNo });
  return `https://wcca.wicourts.gov/caseDetail.html?${q.toString()}`;
}

function wccaPartySearchUrl(lastName: string, firstName: string, countyNo: string): string {
  const q = new URLSearchParams({
    lastName,
    firstName,
    countyNo,
    isAdvanced: 'true',
  });
  return `https://wcca.wicourts.gov/partySearchResults.html?${q.toString()}`;
}

interface WccaMatch {
  caseNumber: string;
  partyName: string;
  dob: string;
  county: string;
  caseType: string;
  status: string;
}

interface CourtLookupCardProps {
  defaultFirstName?: string;
  defaultLastName?: string;
  defaultCaseNumber?: string;
  hideHeader?: boolean;
}

export default function CourtLookupCard({
  defaultFirstName = '',
  defaultLastName = '',
  defaultCaseNumber = '',
  hideHeader = false,
}: CourtLookupCardProps = {}) {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('hillsborough-fl');
  const [caseNumber, setCaseNumber] = useState(defaultCaseNumber);
  const [lastName, setLastName] = useState(defaultLastName);
  const [firstName, setFirstName] = useState(defaultFirstName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hillsResult, setHillsResult] = useState<HillsboroughResult | null>(null);
  const [wccaLink, setWccaLink] = useState<{ url: string; label: string } | null>(null);
  const [wccaResults, setWccaResults] = useState<WccaMatch[] | null>(null);
  const [wccaLoading, setWccaLoading] = useState(false);

  const selected = JURISDICTIONS.find((j) => j.value === jurisdiction)!;

  function resetResults() {
    setHillsResult(null);
    setWccaLink(null);
    setWccaResults(null);
    setError('');
  }

  function handleWccaExtensionSearch() {
    setWccaLoading(true);
    setWccaResults(null);
    setError('');

    const requestId = Date.now().toString();
    
    const listener = (event: MessageEvent) => {
      if (event.data?.type === 'spherical-intake:search-wcca-response' && event.data?.requestId === requestId) {
        window.removeEventListener('message', listener);
        setWccaLoading(false);
        if (event.data.response?.results) {
          setWccaResults(event.data.response.results);
        } else if (event.data.response?.error) {
          setError(event.data.response.error);
        }
      }
    };
    
    window.addEventListener('message', listener);
    
    window.postMessage({
      type: 'spherical-intake:search-wcca',
      payload: {
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        countyNo: selected.wccaCounty,
      },
      requestId
    }, '*');
    
    // Timeout
    setTimeout(() => {
      window.removeEventListener('message', listener);
      setWccaLoading((currentLoading) => {
        if (currentLoading) {
          setError('Extension search timed out. Ensure the extension is installed and active.');
          return false;
        }
        return currentLoading;
      });
    }, 60000);
  }

  async function handleLookup() {
    resetResults();
    if (!caseNumber.trim() && !lastName.trim()) {
      setError('Enter a case number or a last name.');
      return;
    }

    if (selected.system === 'wcca') {
      const countyNo = selected.wccaCounty!;
      if (caseNumber.trim()) {
        setWccaLink({
          url: wccaCaseDetailUrl(caseNumber.trim(), countyNo),
          label: `Open ${caseNumber.trim()} on WCCA`,
        });
      } else {
        setWccaLink({
          url: wccaPartySearchUrl(lastName.trim(), firstName.trim(), countyNo),
          label: `Search "${lastName.trim()}${firstName.trim() ? `, ${firstName.trim()}` : ''}" on WCCA`,
        });
      }
      return;
    }

    setLoading(true);
    try {
      const workerUrl = import.meta.env.VITE_API_BASE_URL;
      const response = await fetch(`${workerUrl}/court-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jurisdiction: 'hillsborough',
          caseNumber: caseNumber.trim(),
          lastName: lastName.trim(),
          firstName: firstName.trim(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Lookup failed (${response.status})`);
      }
      const data = (await response.json()) as HillsboroughResult;
      setHillsResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  const hasMatches = hillsResult?.ok && hillsResult.matches && hillsResult.matches.length > 0;

  return (
    <section className={`dashboard-panel court-lookup-panel ${hideHeader ? 'court-lookup-panel-embedded' : ''}`}>
      {!hideHeader && (
        <div className="panel-header">
          <div>
            <h3>Court Lookup</h3>
            <p className="subtitle">
              Pick a jurisdiction, drop in a case number or last name, and pull what the county has on file.
            </p>
          </div>
          <span className="court-lookup-badge">{selected.badge}</span>
        </div>
      )}

      <div className="court-lookup-controls">
        <label className="court-lookup-field">
          <span>Jurisdiction</span>
          <select
            value={jurisdiction}
            onChange={(e) => {
              setJurisdiction(e.target.value as Jurisdiction);
              resetResults();
            }}
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
        <label className="court-lookup-field">
          <span>Case number</span>
          <input
            type="text"
            placeholder={selected.system === 'wcca' ? '2024CF001234' : '24-CF-006353-A'}
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
          />
        </label>
        <label className="court-lookup-field">
          <span>Last name</span>
          <input
            type="text"
            placeholder="Smith"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </label>
        <label className="court-lookup-field">
          <span>First name (optional)</span>
          <input
            type="text"
            placeholder="John"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </label>
        <button className="btn-primary court-lookup-submit" onClick={handleLookup} disabled={loading}>
          {loading ? <div className="spinner-sm" /> : 'Look up'}
        </button>
      </div>

      {error && <div className="court-lookup-error">{error}</div>}

      {wccaLink && (
        <div className="court-lookup-wcca">
          <div className="court-lookup-api-warning" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#d97706', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
            <strong>Note:</strong> The official Wisconsin CCAP API costs $12,500/year. To save costs, this lookup uses the Spherical Assistant Chrome Extension to search WCCA on your behalf. You may be asked to manually solve a CAPTCHA.
          </div>
          <p>
            Wisconsin Circuit Court Access is a public portal. Open the record manually or automate the search via extension.
          </p>
          <div className="court-lookup-wcca-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
            <button className="btn-primary" onClick={handleWccaExtensionSearch} disabled={wccaLoading}>
              {wccaLoading ? 'Searching...' : 'Automate via Extension'}
            </button>
            <a className="btn-secondary" href={wccaLink.url} target="_blank" rel="noopener noreferrer" style={{ padding: '0.5rem 1rem', textDecoration: 'none', color: 'inherit', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
              Open Manually ↗
            </a>
          </div>
        </div>
      )}

      {wccaResults && (
        <div className="court-lookup-results" style={{ marginTop: '20px' }}>
          {wccaResults.length > 0 ? (
            <>
              <div className="court-lookup-results-summary">
                {wccaResults.length} match{wccaResults.length === 1 ? '' : 'es'} found via Extension
              </div>
              <div className="court-rows">
                {wccaResults.map((m, idx) => (
                  <div key={`${m.caseNumber}-${idx}`} className="court-row">
                    <div className="court-row-header">
                      <span className="court-case">{m.caseNumber || '—'}</span>
                      <span className="court-badge court-badge-filing" style={{ background: '#f3f4f6', color: '#4b5563' }}>Wisconsin CCAP</span>
                    </div>
                    <div className="court-row-identity">
                      {m.partyName || '(no name)'}
                      {m.dob && <> • DOB {m.dob}</>}
                    </div>
                    {m.caseType && <div className="court-row-meta">{m.caseType} • {m.county}</div>}
                    {m.status && <div className="court-row-charge">Status: {m.status}</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="panel-empty">No matches found on WCCA.</p>
          )}
        </div>
      )}

      {hillsResult?.ok && (
        <div className="court-lookup-results">
          {hasMatches ? (
            <>
              <div className="court-lookup-results-summary">
                {hillsResult.matchCount} match{hillsResult.matchCount === 1 ? '' : 'es'} in the last{' '}
                {hillsResult.windowDays} days
              </div>
              <div className="court-rows">
                {hillsResult.matches!.slice(0, 8).map((m, idx) => {
                  const fullName = [m.defendant.firstName, m.defendant.middleName, m.defendant.lastName]
                    .filter(Boolean)
                    .join(' ');
                  const charge = m.charges[0]?.description || m.charges[0]?.statute || '';
                  const unrepresented = m.attorney && m.attorney.toLowerCase().includes('no attorney');
                  return (
                    <div key={`${m.source}-${m.caseNumber}-${idx}`} className="court-row">
                      <div className="court-row-header">
                        <span className={`court-conf court-conf-${m.match.confidence}`} />
                        <span className="court-case">{m.caseNumber || '—'}</span>
                        <span className={`court-badge court-badge-${m.source}`}>
                          {m.source === 'citation' ? '🚗 Citation' : '⚖️ Filing'}
                        </span>
                      </div>
                      <div className="court-row-identity">
                        {fullName || '(no name)'}
                        {m.defendant.dob && <> • DOB {m.defendant.dob}</>}
                      </div>
                      {m.caseType && <div className="court-row-meta">{m.caseType}</div>}
                      {charge && (
                        <div className="court-row-charge">
                          {charge}
                          {m.charges.length > 1 && (
                            <span className="court-row-more"> +{m.charges.length - 1} more</span>
                          )}
                        </div>
                      )}
                      {m.attorney && (
                        <div className={`court-row-attorney ${unrepresented ? 'court-row-unrep' : ''}`}>
                          {unrepresented ? 'Unrepresented — opportunity' : `Attorney: ${m.attorney}`}
                        </div>
                      )}
                      {m.filingDate && <div className="court-row-date">Filed {m.filingDate}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="panel-empty">
              No matches in the public feeds for the last week. Try widening the name or confirming the
              case number on HOVER.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
