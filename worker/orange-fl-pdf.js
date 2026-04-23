// Parser for the Orange County FL daily jail booking PDF.
// Source: https://netapps.ocfl.net/BestJail/PDF/bookings.pdf — refreshed
// nightly, covers a rolling 24-hour window. PDF text extractors flatten the
// document into one continuous space-separated string (unpdf does this
// explicitly, pypdf adds newlines but we collapse them up-front for parity)
// so this parser anchors on regex patterns rather than line stages.
//
// One booking entry, after normalization, looks like:
//   "ALVARENGA, ERNESTO BRC-MBF-NAW / M26014451 ORLANDO, FL 32824 45
//    HISPANIC CASE: 2025CF008704AO MAITLAND PD FELONY / THIRD DEGREE
//    948.06-1 VIOLATION OF PROBATION"
//
// Released entries replace cell with "--" and append a release datetime
// after the booking#. Multiple "CASE:" blocks per defendant are common —
// charges roll up into the most recent CASE.

// Two-pass anchoring. PASS 1 finds the booking trailer — the cell + race +
// gender + booking# combination is distinctive enough that it never false-
// matches on charge text. Cell is "BRC-..." (allowing internal spaces) or
// "--" for released entries. Race letter is glued to the cell in flattened
// text (e.g. "BRC-MBF-NA"+"W" -> "BRC-MBF-NAW"), so the lazy [-A-Z0-9 ]*?
// + [WBHAIU] cleanly splits them.
const TRAILER_RE = new RegExp(
  String.raw`(?<cell>BRC[-A-Z0-9]*(?:\s+[A-Z0-9][-A-Z0-9]*)*?|--)` +
    String.raw`\s*(?<race>[WBHAIU])\s*\/\s*(?<gender>[MF])(?<booking>\d{7,9})` +
    String.raw`(?:\s+(?<release>\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}[AP]M))?`,
  'g'
);

// PASS 2 helper: extract a name from the window directly to the left of a
// trailer. The LAST comma in the window sits between surname and given
// names. We take a single surname token (compound surnames like "DE LA
// CRUZ" are rare in this dataset; trading them for robustness against
// charge text bleeding in from the prior booking is the right call) and up
// to 4 given-name tokens.
const NAME_TOKEN_RE = /^[A-Z][A-Z'\-]*$/;

// Returns { name, startInWindow } so callers can compute the absolute
// position of the name in the original text (needed to bound the previous
// booking's body precisely).
function extractNameFromWindow(window) {
  const lastComma = window.lastIndexOf(',');
  if (lastComma === -1) return null;

  const beforeComma = window.slice(0, lastComma).trimEnd();
  const beforeTokens = beforeComma.split(/\s+/).filter(Boolean);
  const surnameToken = beforeTokens[beforeTokens.length - 1];
  if (!surnameToken || !NAME_TOKEN_RE.test(surnameToken)) return null;

  const afterComma = window.slice(lastComma + 1).trim();
  const afterTokens = afterComma.split(/\s+/).filter(Boolean);
  const givenTokens = [];
  for (const t of afterTokens) {
    if (!NAME_TOKEN_RE.test(t) || givenTokens.length >= 4) break;
    givenTokens.push(t);
  }
  if (givenTokens.length === 0) return null;

  // Find where the surname token starts in the window — that's the true
  // name start, regardless of how much whitespace surrounds it.
  const surnameStartInBefore = beforeComma.lastIndexOf(surnameToken);
  return {
    name: `${surnameToken}, ${givenTokens.join(' ')}`,
    startInWindow: surnameStartInBefore,
  };
}

const ADDRESS_RE = /^(ZNA|[A-Z][A-Z .'\-]*?,\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)/;
const AGE_ETH_RE = /(\d{1,3})\s+(HISPANIC|NON-HISPANIC|UNKNOWN)/;

// Charge pattern: LEVEL / [optional degree words]DEGREE[optional PLEA][statute][space][description]
// Statute starts with a digit and contains digits/dots/parens/letters/dashes.
// Description runs until the next charge or "CASE:" or end-of-body.
const CHARGE_RE =
  /(?<level>FELONY|MISDEMEANOR|TRAFFIC|CIVIL|OTHER)\s*\/\s*(?<degree>[A-Z ]*?)DEGREE(?:PLEA)?(?<statute>\d[\d.()A-Z\-]*)?(?:\s+(?<description>.+?))?(?=\s+(?:FELONY|MISDEMEANOR|TRAFFIC|CIVIL|OTHER)\s*\/|\s+CASE:|$)/g;

// "CASE:" splits cases within a body. After the marker we expect either a
// case number (always digit-led in FL) or just an arresting agency name.
const CASE_HEADER_RE = /^(?<num>\d\S*)?\s*(?<agency>.+?)$/;

// Page footers ("04/23/2026 at 1:07 amIMS061 Page: 1") and the repeating
// per-page report header bleed into charge descriptions when a booking
// straddles a page break. Strip them from the flattened text up-front so
// the body parsers see clean, contiguous booking text.
const PAGE_NOISE_RE =
  /\s*\d{1,2}\/\d{1,2}\/\d{4} at\s+\d+:\d+\s+[ap]m\s*IMS\d+\s+Page:\s+\d+\s*(?:ORANGE COUNTY JAIL BOOKING REPORT\s+BOOKINGS DURING THE 24-HOUR PERIOD\s+BEGINNING AT MIDNIGHT\s+\d{1,2}\/\d{1,2}\/\d{4}\s+Name Cell\s+Race\/?\s*Gender\/?\s*Ethnicity\s*Booking #\s*Age\s*Release Date\/Time\s*)?/gi;

function normalize(text) {
  return text.replace(/\s+/g, ' ').replace(PAGE_NOISE_RE, ' ').trim();
}

function parseAddress(raw) {
  if (!raw || raw === 'ZNA') return { city: null, state: null, zip: null };
  const m = raw.match(/^(.+?),\s*([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/);
  if (!m) return { city: null, state: null, zip: null };
  return { city: m[1].trim(), state: m[2], zip: m[3] || null };
}

function parseCases(body) {
  // Body is everything after age+ethnicity. Split into case blocks on "CASE:".
  const cases = [];
  const parts = body.split(/CASE:\s*/);
  // First element is anything before the first CASE: (usually empty or noise)
  parts.shift();

  for (const part of parts) {
    // Charge blocks live inline. Find the first charge marker; everything
    // before it is the case header (number + agency).
    const firstChargeIdx = part.search(/\b(?:FELONY|MISDEMEANOR|TRAFFIC|CIVIL|OTHER)\s*\//);
    const headerStr = (firstChargeIdx === -1 ? part : part.slice(0, firstChargeIdx)).trim();
    const chargeStr = firstChargeIdx === -1 ? '' : part.slice(firstChargeIdx);

    let caseNumber = '';
    let agency = '';
    if (headerStr) {
      const headerMatch = CASE_HEADER_RE.exec(headerStr);
      if (headerMatch?.groups) {
        const num = (headerMatch.groups.num || '').trim();
        if (num && /^\d/.test(num)) caseNumber = num;
        agency = (caseNumber ? headerMatch.groups.agency : headerStr).trim();
      } else {
        agency = headerStr;
      }
    }

    const charges = [];
    if (chargeStr) {
      // CHARGE_RE has /g — exec it in a loop on a fresh local copy
      const re = new RegExp(CHARGE_RE.source, 'g');
      let m;
      while ((m = re.exec(chargeStr)) !== null) {
        const g = m.groups;
        charges.push({
          level: g.level,
          degree: ((g.degree || '').replace(/\s+/g, ' ').trim() + ' DEGREE').trim(),
          statute: g.statute || '',
          description: (g.description || '').trim(),
        });
      }
    }

    cases.push({ caseNumber, agency, charges });
  }

  return cases;
}

export function parseBookingsPdfText(text) {
  if (!text) return { reportDate: null, totalReported: null, bookings: [] };

  const flat = normalize(text);

  let reportDate = null;
  const dateMatch = flat.match(/MIDNIGHT\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) reportDate = dateMatch[1];

  let totalReported = null;
  const totalMatch = flat.match(/TOTAL INMATES THIS REPORT:\s*(\d+)/);
  if (totalMatch) totalReported = Number(totalMatch[1]);

  // PASS 1: find every cell+race+booking trailer.
  const trailers = [];
  const re = new RegExp(TRAILER_RE.source, 'g');
  let m;
  while ((m = re.exec(flat)) !== null) {
    trailers.push({
      groups: { ...m.groups },
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // PASS 2: for each trailer, look ~80 chars to the left for the name.
  // Bound the window by the previous trailer's end so we never wander into
  // the prior booking's body.
  const real = [];
  for (let i = 0; i < trailers.length; i++) {
    const t = trailers[i];
    const prevEnd = i > 0 ? trailers[i - 1].end : 0;
    const windowStart = Math.max(prevEnd, t.start - 120);
    const window = flat.slice(windowStart, t.start);
    const hit = extractNameFromWindow(window);
    if (!hit) continue;
    real.push({
      groups: { ...t.groups, name: hit.name },
      start: windowStart + hit.startInWindow,
      end: t.end,
    });
  }

  const bookings = [];
  for (let i = 0; i < real.length; i++) {
    const a = real[i];
    const next = real[i + 1];
    const bodyStart = a.end;
    // Body ends at the next anchor or at the "TOTAL" footer
    const totalIdx = flat.indexOf('TOTAL INMATES THIS REPORT:', bodyStart);
    const candidates = [next?.start, totalIdx === -1 ? Infinity : totalIdx, flat.length].filter(
      (n) => typeof n === 'number'
    );
    const bodyEnd = Math.min(...candidates);
    const body = flat.slice(bodyStart, bodyEnd).trim();

    // Extract address (must be at start of body) — tolerate a leading
    // page-break preamble like "04/23/2026 at 1:07 amIMS061 Page: 2 ORANGE
    // COUNTY JAIL BOOKING REPORT ..." which can land between bookings when
    // a page break falls there. Skip past any such preamble.
    const cleaned = body.replace(
      /^\d{2}\/\d{2}\/\d{4} at\s+\d.*?Booking # Age Release Date\/Time\s*/i,
      ''
    );

    const addrMatch = cleaned.match(ADDRESS_RE);
    const addressRaw = addrMatch ? addrMatch[1] : null;
    const afterAddr = addressRaw ? cleaned.slice(addrMatch[0].length).trim() : cleaned;

    const ageEthMatch = afterAddr.match(AGE_ETH_RE);
    const age = ageEthMatch ? Number(ageEthMatch[1]) : null;
    const ethnicity = ageEthMatch ? ageEthMatch[2] : null;
    const afterAgeEth = ageEthMatch ? afterAddr.slice(ageEthMatch.index + ageEthMatch[0].length).trim() : afterAddr;

    const cases = parseCases(afterAgeEth);

    bookings.push({
      name: a.groups.name.trim().replace(/,$/, ''),
      cell: (a.groups.cell || '').trim(),
      race: a.groups.race,
      gender: a.groups.gender,
      bookingNumber: a.groups.booking,
      releaseAt: a.groups.release || null,
      address: parseAddress(addressRaw),
      age,
      ethnicity,
      cases,
    });
  }

  return { reportDate, totalReported, bookings };
}
