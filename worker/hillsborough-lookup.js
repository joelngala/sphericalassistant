// Hillsborough public-data lookup for the intake flow.
// Called from worker/index.js during /intake to search citations + filings
// feeds by last name over a rolling window, rank matches by confidence, and
// return enough distinguishing info for the attorney to pick the right one.
//
// Uses only fetch + small inline CSV parser so it stays Workers-safe.

const CITATIONS_BASE = 'https://publicrec.hillsclerk.com/Traffic/citations_history_dds';
const FILINGS_BASE = 'https://publicrec.hillsclerk.com/Criminal/dailyfilings';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 7;

// Minimal RFC-4180-ish parser. Both Hillsborough feeds are well-formed:
// comma-delimited, quoted strings (may contain commas), no embedded quotes
// escaped — if the source ever changes we'll see junk rows and bump to a
// full library.
function parseCsv(text) {
  const lines = [];
  let cur = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      cur.push(field);
      field = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (field !== '' || cur.length > 0) {
        cur.push(field);
        lines.push(cur);
      }
      cur = [];
      field = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    field += c;
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    lines.push(cur);
  }

  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1).map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? '';
    return obj;
  });
}

function formatStamp(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function isoFromMdy(mdy) {
  if (!mdy) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy).trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function fetchCsvOrNull(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function stampsForWindow(days) {
  // Yesterday is the freshest file that can exist (feeds post overnight).
  const anchor = new Date(Date.now() - MS_PER_DAY);
  const out = [];
  for (let i = 0; i < days; i++) {
    out.push(formatStamp(new Date(anchor.getTime() - i * MS_PER_DAY)));
  }
  return out;
}

async function fetchCitationsWindow(days) {
  const stamps = stampsForWindow(days);
  const texts = await Promise.all(
    stamps.map((s) => fetchCsvOrNull(`${CITATIONS_BASE}/Citation_DDS_${s}.csv`))
  );
  const rows = [];
  for (const text of texts) {
    if (!text) continue;
    rows.push(...parseCsv(text));
  }
  return rows;
}

async function fetchFilingsWindow(days) {
  const stamps = stampsForWindow(days);
  const texts = await Promise.all(
    stamps.map((s) => fetchCsvOrNull(`${FILINGS_BASE}/CriminalFiling_${s}.csv`))
  );
  const rows = [];
  for (const text of texts) {
    if (!text) continue;
    rows.push(...parseCsv(text));
  }
  return rows;
}

function normCitation(row) {
  return {
    source: 'citation',
    caseNumber: (row['Case Number'] || '').trim(),
    filingDate: isoFromMdy(row['Case Filed Date']) || isoFromMdy(row['Received Date']),
    defendant: {
      firstName: (row['First Name'] || '').trim(),
      middleName: (row['Middle Name'] || '').trim(),
      lastName: (row['Last Name'] || '').trim(),
      dob: isoFromMdy(row['Date Of Birth']),
      city: (row['City'] || '').trim(),
      zip: (row['Zip Code'] || '').trim(),
    },
    charges: [
      {
        statute: (row['Statute Number'] || '').trim(),
        description: (row['Statute Description'] || '').trim(),
      },
    ],
    attorney: null,
  };
}

// Filings feed is one row per charge — fold them into a map keyed by case.
function normFilings(rows) {
  const byCase = new Map();
  for (const row of rows) {
    const caseNumber = (row['CaseNumber'] || '').trim();
    if (!caseNumber) continue;
    if (!byCase.has(caseNumber)) {
      const address = (row['PartyAddress'] || '').trim();
      const { city, zip } = parseAddress(address);
      byCase.set(caseNumber, {
        source: 'filing',
        caseNumber,
        filingDate: isoFromMdy(row['FilingDate']),
        defendant: {
          firstName: (row['FirstName'] || '').trim(),
          middleName: (row['MiddleName'] || '').trim(),
          lastName: (row['LastName'] || '').trim(),
          dob: null,
          city,
          zip,
        },
        charges: [],
        attorney: (row['Attorney'] || '').trim() || null,
        caseType: (row['CaseTypeDescription'] || '').trim(),
      });
    }
    byCase.get(caseNumber).charges.push({
      number: (row['ChargeNumber'] || '').trim(),
      description: (row['ChargeOffenseDescription'] || '').trim(),
    });
  }
  return Array.from(byCase.values());
}

// "1234 MAIN ST APT 5, TAMPA, FL 33604" → { city: "TAMPA", zip: "33604" }
function parseAddress(raw) {
  if (!raw) return { city: '', zip: '' };
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length < 3) return { city: '', zip: '' };
  const city = parts[parts.length - 2] || '';
  const tail = parts[parts.length - 1] || '';
  const zip = (tail.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '';
  return { city, zip };
}

function norm(str) {
  return (str || '').trim().toUpperCase();
}

function scoreMatch(record, intake) {
  const reasons = [];
  let score = 0;

  if (intake.caseNumber && norm(record.caseNumber) === norm(intake.caseNumber)) {
    reasons.push('case-number exact');
    score += 100;
  }
  if (intake.dob && record.defendant.dob && record.defendant.dob === intake.dob) {
    reasons.push('DOB exact');
    score += 60;
  }
  if (intake.firstName && norm(record.defendant.firstName) === norm(intake.firstName)) {
    reasons.push('first-name match');
    score += 20;
  }
  if (intake.city && record.defendant.city && norm(record.defendant.city) === norm(intake.city)) {
    reasons.push('city match');
    score += 10;
  }
  if (intake.zip && record.defendant.zip && record.defendant.zip === intake.zip) {
    reasons.push('zip match');
    score += 10;
  }

  let confidence = 'low';
  if (score >= 100) confidence = 'high';
  else if (score >= 60) confidence = 'high';
  else if (score >= 20) confidence = 'medium';

  return { score, confidence, reasons };
}

// Parse "LAST, FIRST MIDDLE" or "FIRST MIDDLE LAST" out of the intake's full
// name — we only need last + first for the filter.
function splitFullName(fullName) {
  const s = (fullName || '').trim();
  if (!s) return { firstName: '', lastName: '' };
  if (s.includes(',')) {
    const [last, rest] = s.split(',').map((p) => p.trim());
    const [first] = (rest || '').split(/\s+/);
    return { firstName: first || '', lastName: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

export async function lookupHillsboroughRecords(intake, { days = DEFAULT_LOOKBACK_DAYS } = {}) {
  const { firstName, lastName } = splitFullName(intake.fullName);
  if (!lastName && !intake.caseNumber) {
    return { ok: true, searched: false, reason: 'no last name or case number provided', matches: [] };
  }

  const [citationRows, filingRows] = await Promise.all([
    fetchCitationsWindow(days),
    fetchFilingsWindow(days),
  ]);

  const citations = citationRows.map(normCitation);
  const filings = normFilings(filingRows);

  const needle = norm(lastName);
  const byLastName = (r) => !needle || norm(r.defendant.lastName) === needle;
  const byCaseNumber = (r) =>
    intake.caseNumber && norm(r.caseNumber) === norm(intake.caseNumber);

  const all = [...citations, ...filings].filter((r) => byLastName(r) || byCaseNumber(r));

  const intakeCtx = {
    firstName,
    caseNumber: intake.caseNumber,
    dob: intake.dob || null,
    city: intake.city || null,
    zip: intake.zip || null,
  };

  const scored = all.map((r) => ({ ...r, match: scoreMatch(r, intakeCtx) }));
  scored.sort((a, b) => b.match.score - a.match.score);

  return {
    ok: true,
    searched: true,
    windowDays: days,
    citationRows: citationRows.length,
    filingRows: filingRows.length,
    matchCount: scored.length,
    matches: scored.slice(0, 25),
  };
}
