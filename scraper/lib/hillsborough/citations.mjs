// Hillsborough daily citation feed.
// Source: https://publicrec.hillsclerk.com/Traffic/citations_history_dds/
// One CSV per day, named Citation_DDS_YYYYMMDD.csv, uploaded ~1:30 AM
// with yesterday's citations. 41 columns, one row per citation.
//
// This is the gold data source for criminal-defense lead-gen: every DUI,
// reckless-driving, and traffic charge filed the day before.
import { parse } from 'csv-parse/sync';

const BASE_URL = 'https://publicrec.hillsclerk.com/Traffic/citations_history_dds';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 14;

// Florida statute prefixes we care about for criminal-defense intake.
// 316.193 = DUI; 316.027 = leaving scene w/ injury; 316.192 = reckless.
// Keep this list narrow — adding every traffic statute would drown lawyers in noise.
const DUI_STATUTE_PREFIXES = ['316.193'];
const SERIOUS_TRAFFIC_PREFIXES = ['316.027', '316.192', '316.1935'];

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
  // Daily feed is usually posted with a lag, so start from yesterday.
  return new Date(Date.now() - MS_PER_DAY);
}

async function fetchCsvByStamp(stamp) {
  const url = `${BASE_URL}/Citation_DDS_${stamp}.csv`;
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
    `No citation CSV found in the last ${maxLookbackDays} day(s) ending ${anchorStamp}.`
  );
}

function csvDateToIso(mmddyyyy) {
  if (!mmddyyyy) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mmddyyyy.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// Normalize one CSV row into the shape the rest of the system will consume.
// We keep raw fields too so downstream AI extraction can reference them.
function normalize(row) {
  const statute = (row['Statute Number'] || '').trim();
  const statuteDesc = (row['Statute Description'] || '').trim();
  const isDui = DUI_STATUTE_PREFIXES.some((p) => statute.startsWith(p));
  const isSerious = SERIOUS_TRAFFIC_PREFIXES.some((p) => statute.startsWith(p));

  return {
    caseNumber: (row['Case Number'] || '').trim(),
    uniformCaseNumber: (row['Uniform Case Number'] || '').trim(),
    citationNumber: (row['Citation Number'] || '').trim(),
    defendant: {
      lastName: (row['Last Name'] || '').trim(),
      firstName: (row['First Name'] || '').trim(),
      middleName: (row['Middle Name'] || '').trim(),
      suffix: (row['Suffix'] || '').trim(),
      dob: csvDateToIso(row['Date Of Birth']),
      race: (row['Race'] || '').trim(),
      gender: (row['Gender'] || '').trim(),
      address: {
        line1: (row['Address Line 1'] || '').trim(),
        line2: (row['Address Line 2'] || '').trim(),
        city: (row['City'] || '').trim(),
        state: (row['State'] || '').trim(),
        zip: (row['Zip Code'] || '').trim(),
      },
      driversLicense: (row['Drivers License Number'] || '').trim(),
      driversLicenseState: (row['Drivers License State'] || '').trim(),
    },
    offense: {
      statute,
      description: statuteDesc,
      offenseDate: csvDateToIso(row['Offense Date']),
      receivedDate: csvDateToIso(row['Received Date']),
      caseFiledDate: csvDateToIso(row['Case Filed Date']),
      caseClosedDate: csvDateToIso(row['Case Closed Date']),
      agency: (row['Law Enf Agency Name'] || '').trim(),
      officer: (row['Law Enf Officer Name'] || '').trim(),
      postedSpeed: (row['Posted Speed'] || '').trim(),
      actualSpeed: (row['Actual Speed'] || '').trim(),
    },
    disposition: {
      result: (row['Disposition'] || '').trim(),
      date: csvDateToIso(row['Disposition Date']),
      amountPaid: (row['Amount Paid'] || '').trim(),
      judgeName: (row['Judge Name'] || '').trim(),
    },
    flags: {
      isDui,
      isSeriousTraffic: isSerious,
      isOpen: !(row['Case Closed Date'] || '').trim(),
    },
  };
}

export async function fetchCitationsForDate(date, { last = null, dui = false, serious = false } = {}) {
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

  const normalized = records.map(normalize);

  let filtered = normalized;
  if (dui) filtered = filtered.filter((r) => r.flags.isDui);
  if (serious) filtered = filtered.filter((r) => r.flags.isSeriousTraffic);
  if (last) {
    const needle = String(last).trim().toUpperCase();
    filtered = filtered.filter((r) => r.defendant.lastName.toUpperCase() === needle);
  }

  return {
    ok: true,
    county: 'hillsborough-fl',
    source: fetched.url,
    fetchedAt: new Date().toISOString(),
    fileDate: fetched.stamp,
    totalRows: normalized.length,
    matchedRows: filtered.length,
    filters: { last: last || null, dui, serious },
    rows: filtered,
  };
}
