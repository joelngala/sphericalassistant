import type { OrangeFlPayload, OrangeFlBookingMatch, OrangeFlParcelHit } from '../types.ts';

interface OrangeFlRecordsCardProps {
  payload: OrangeFlPayload;
  defendantLastName?: string;
  defendantFirstName?: string;
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

// Open the OC Clerk case search with the defendant prefilled. The extension
// (content/myorangeclerk.js) detects this URL, fills the form, and after
// the user clears the CAPTCHA scrapes the results table.
function buildClerkSearchUrl(firstName?: string, lastName?: string): string {
  const params = new URLSearchParams();
  if (firstName) params.set('first', firstName);
  if (lastName) params.set('last', lastName);
  // Custom hash the extension can sniff cross-origin without depending on
  // the clerk's URL scheme.
  return `https://myeclerk.myorangeclerk.com/Cases/Search#spherical=${encodeURIComponent(params.toString())}`;
}

function BookingRow({ m }: { m: OrangeFlBookingMatch }) {
  const status = m.releaseAt
    ? `Released ${m.releaseAt}`
    : `In custody${m.cell ? ` • cell ${m.cell}` : ''}`;
  const charge = m.topCase?.topCharge;
  return (
    <div className="court-row">
      <div className="court-row-header">
        <ConfidenceDot level={m.confidence} />
        <span className="court-case">#{m.bookingNumber || '—'}</span>
        <span className="court-badge court-badge-citation">🔒 OCSO</span>
      </div>
      <div className="court-row-identity">
        {m.name}{m.age != null ? ` • ${m.age}yo` : ''}
      </div>
      <div className="court-row-meta">{status}</div>
      {m.topCase && (
        <div className="court-row-meta">
          Case {m.topCase.caseNumber || '(none)'} • {m.topCase.agency}
        </div>
      )}
      {charge && (
        <div className="court-row-charge">
          {charge.level} / {charge.degree} — {charge.description || charge.statute}
          {m.topCase && m.topCase.chargeCount > 1 ? ` (+${m.topCase.chargeCount - 1} more)` : ''}
        </div>
      )}
      {m.address.zip && (
        <div className="court-row-meta">
          {m.address.city || ''} {m.address.zip}
        </div>
      )}
    </div>
  );
}

function ParcelRow({ p }: { p: OrangeFlParcelHit }) {
  return (
    <div className="court-row">
      <div className="court-row-header">
        <span className="court-case">{p.address || '—'}</span>
        <span className="court-badge court-badge-filing">📍 OCGIS</span>
      </div>
      <div className="court-row-meta">
        {p.jurisdiction || '—'} {p.zip || ''} • parcel {p.parcelId || '—'}
      </div>
      {p.useCode && <div className="court-row-charge">Use: {p.useCode}</div>}
    </div>
  );
}

export default function OrangeFlRecordsCard({
  payload,
  defendantFirstName,
  defendantLastName,
}: OrangeFlRecordsCardProps) {
  const { reportDate, totalReported, bookings, parcels, parcelAddress } = payload;
  const hasBookings = bookings.length > 0;
  const hasParcels = parcels.length > 0;
  if (!hasBookings && !hasParcels && !reportDate) return null;

  const clerkUrl = buildClerkSearchUrl(defendantFirstName, defendantLastName);

  return (
    <section className="court-card">
      <header className="court-card-header">
        <div>
          <h3>Orange County FL</h3>
          <p className="subtitle">
            Auto-pulled at intake from OCSO daily booking PDF + OCGIS Address Points.
          </p>
        </div>
        <div className="court-card-stats">
          {hasBookings && (
            <span className="court-stat" title="OCSO bookings">
              {bookings.length} booking{bookings.length === 1 ? '' : 's'}
            </span>
          )}
          {hasParcels && (
            <span className="court-stat" title="Parcel hits">
              {parcels.length} parcel{parcels.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </header>

      {reportDate && (
        <p className="subtitle" style={{ marginTop: 0 }}>
          Booking report {reportDate} • {totalReported} entries scanned in last 24h.
        </p>
      )}

      {hasBookings && (
        <div className="court-section">
          <h4 className="court-section-title">OCSO bookings</h4>
          <div className="court-rows">
            {bookings.map((m) => (
              <BookingRow key={m.bookingNumber} m={m} />
            ))}
          </div>
        </div>
      )}

      {hasParcels && (
        <div className="court-section">
          <h4 className="court-section-title">
            Parcel candidates{parcelAddress ? ` for "${parcelAddress}"` : ''}
          </h4>
          <div className="court-rows">
            {parcels.map((p) => (
              <ParcelRow key={p.parcelId} p={p} />
            ))}
          </div>
        </div>
      )}

      <div className="court-section">
        <a
          className="btn-secondary btn-sm"
          href={clerkUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          🔗 Open OC Clerk case search
          {defendantLastName ? ` for ${defendantFirstName || ''} ${defendantLastName}`.trim() : ''}
        </a>
        <p className="subtitle" style={{ marginTop: 4 }}>
          Spherical extension auto-fills the search; you'll need to solve the
          one-tap CAPTCHA. Results are scraped back into this matter.
        </p>
      </div>
    </section>
  );
}
