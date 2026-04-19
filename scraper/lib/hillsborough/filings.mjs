// Hillsborough daily criminal filings feed.
// Source: https://publicrec.hillsclerk.com/Criminal/dailyfilings/
// One CSV per day, named CriminalFiling_YYYYMMDD.csv, posted ~12:00 AM
// with the prior day's filings. One row per charge, so multiple rows
// per case — we group by CaseNumber into per-defendant records.
//
// This is the primary lead-gen feed for criminal defense: fresh filings
// with defense-attorney field ("No Attorney" = unrepresented).
import { parse } from 'csv-parse/sync';

const BASE_URL = 'https://publicrec.hillsclerk.com/Criminal/dailyfilings';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 14;

function toFileDate(input) {
  if (!input) throw new Error('Missing date input');
  const trimmed = String(input).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) throw new Error(`Invalid date: ${input}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dayNum = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, dayNum));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() + 1 !== mo ||
    d.getUTCDate() !== dayNum
  ) {
    throw new Error(`Invalid date: ${input}`);
  }
  return formatUtcDateStamp(d);
}

function formatUtcDateStamp(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getDefaultAnchorDate() {
  return new Date(Date.now() - MS_PER_DAY);
}

async function fetchCsvByStamp(stamp) {
  const url = `${BASE_URL}/CriminalFiling_${stamp}.csv`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, notFound: true, status: res.status, statusText: res.statusText, url };
    }
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  return { ok: true, url, text: await res.text(), stamp };
}

async function fetchMostRecentCsv(maxLookbackDays = DEFAULT_LOOKBACK_DAYS) {
  const anchor = getDefaultAnchorDate();
  for (let i = 0; i < maxLookbackDays; i++) {
    const candidate = new Date(anchor.getTime() - i * MS_PER_DAY);
    const stamp = formatUtcDateStamp(candidate);
    const fetched = await fetchCsvByStamp(stamp);
    if (fetched.ok) return fetched;
  }

  const anchorStamp = formatUtcDateStamp(anchor);
  throw new Error(
    `No criminal-filing CSV found in the last ${maxLookbackDays} day(s) ending ${anchorStamp}.`
  );
}

function csvDateToIso(mmddyyyy) {
  if (!mmddyyyy) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mmddyyyy.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Attorney field is literally "No Attorney" when unrepresented — anything
// else is a name (with trailing whitespace in the source data).
function isUnrepresented(attorneyField) {
  return (attorneyField || '').trim().toLowerCase() === 'no attorney';
}

// Collapse the per-charge rows for one case into a single record with a
// charges[] array. Defendant/category/attorney come from the first row
// since they repeat identically across charges of the same case.
function groupRowsByCase(rows) {
  const byCase = new Map();
  for (const row of rows) {
    const caseNumber = (row['CaseNumber'] || '').trim();
    if (!caseNumber) continue;

    if (!byCase.has(caseNumber)) {
      const attorney = (row['Attorney'] || '').trim();
      byCase.set(caseNumber, {
        caseNumber,
        caseCategory: (row['CaseCategory'] || '').trim(),
        caseType: (row['CaseTypeDescription'] || '').trim(),
        title: (row['Title'] || '').trim(),
        filingDate: csvDateToIso(row['FilingDate']),
        defendant: {
          firstName: (row['FirstName'] || '').trim(),
          middleName: (row['MiddleName'] || '').trim(),
          lastName: (row['LastName'] || '').trim(),
          address: (row['PartyAddress'] || '').trim(),
        },
        attorney: attorney || null,
        flags: {
          unrepresented: isUnrepresented(attorney),
        },
        charges: [],
      });
    }

    byCase.get(caseNumber).charges.push({
      number: (row['ChargeNumber'] || '').trim(),
      description: (row['ChargeOffenseDescription'] || '').trim(),
    });
  }
  return Array.from(byCase.values());
}

export async function fetchFilingsForDate(
  date,
  { last = null, unrepresented = false, type = null } = {}
) {
  let fetched;
  if (date) {
    const stamp = toFileDate(date);
    fetched = await fetchCsvByStamp(stamp);
    if (!fetched.ok) {
      throw new Error(`Failed to fetch ${fetched.url}: ${fetched.status} ${fetched.statusText}`);
    }
  } else {
    fetched = await fetchMostRecentCsv();
  }

  const records = parse(fetched.text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const cases = groupRowsByCase(records);

  let filtered = cases;
  if (unrepresented) filtered = filtered.filter((c) => c.flags.unrepresented);
  if (last) {
    const needle = String(last).trim().toUpperCase();
    filtered = filtered.filter((c) => c.defendant.lastName.toUpperCase() === needle);
  }
  if (type) {
    const needle = String(type).trim().toUpperCase();
    filtered = filtered.filter((c) => c.caseType.toUpperCase().includes(needle));
  }

  return {
    ok: true,
    county: 'hillsborough-fl',
    source: fetched.url,
    fetchedAt: new Date().toISOString(),
    fileDate: fetched.stamp,
    totalRows: records.length,
    totalCases: cases.length,
    matchedCases: filtered.length,
    filters: { last: last || null, unrepresented, type: type || null },
    cases: filtered,
  };
}
