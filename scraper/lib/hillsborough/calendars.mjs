// Hillsborough criminal court calendars.
// Source: https://publicrec.hillsclerk.com/Criminal/court_calendars/{Felony,MISD,Traffic}/
//
// PDFs are published ~5 days before each court date (add-ons 1 day before).
// Filename pattern: "CIR CRIM <DIV> DIVISION_<YYYYMMDD>_<HHMM>_<SESSION>.pdf"
//
// Each PDF contains one court session (one judge, one morning/afternoon slot)
// with many defendants. We anchor parsing on "CASE NO:" and skip the
// boilerplate "SENTENCING PROVISIONS:" template pages that appear between
// each case block.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const BASE_URL = 'https://publicrec.hillsclerk.com/Criminal/court_calendars';

const TYPE_DIRS = {
  felony: 'Felony',
  misd: 'MISD',
  misdemeanor: 'MISD',
  traffic: 'Traffic',
};

function toFileDate(input) {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// IIS directory listings embed raw file names in <a> tags. This regex is
// permissive on purpose — anchor on ".pdf" and grab the href.
function parseDirListing(html) {
  const links = [];
  const re = /<a href="([^"]+\.pdf)">/gi;
  let m;
  while ((m = re.exec(html))) {
    links.push(decodeURIComponent(m[1]));
  }
  return links;
}

export async function listCalendarPdfs(type, date) {
  const dir = TYPE_DIRS[type?.toLowerCase()];
  if (!dir) throw new Error(`Unknown calendar type: ${type} (expected felony|misd|traffic)`);

  const stamp = toFileDate(date);
  const indexUrl = `${BASE_URL}/${dir}/`;

  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${indexUrl}: ${res.status}`);
  const html = await res.text();

  const allHrefs = parseDirListing(html);
  const matches = allHrefs.filter((href) => href.includes(`_${stamp}_`));

  return matches.map((href) => {
    // IIS listings return absolute paths like "/Criminal/court_calendars/Felony/...pdf"
    // resolve against the server origin, otherwise treat as relative to indexUrl.
    const url = href.startsWith('/') ? new URL(href, indexUrl).href : new URL(href, indexUrl).href;
    const name = href.split('/').pop();
    return { name, url };
  });
}

async function extractPdfText(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data, disableWorker: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('\n');
    pages.push(text);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

// The template pages showing checkbox-based sentencing provisions are
// copy-pasted between every case block — drop them. We keep only pages
// that carry defendant data.
function isDataPage(pageText) {
  return /CASE NO:\s*\d/.test(pageText) && /Defendant:/.test(pageText);
}

// Pull the "CIR CRIM <DIV> DIVISION   <JUDGE>" and court-date line from
// the session header so every case in this PDF inherits the right date/judge.
function parseSessionHeader(pages) {
  const full = pages.join('\n');
  const session = /Court Session:\s*([^\n]+)/.exec(full)?.[1]?.trim() || null;
  const courtDate = /Court Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(full)?.[1] || null;
  const judge = /Judge:\s*([^\n]+)/.exec(full)?.[1]?.trim() || null;
  const courtRoom = /Court Room:\s*([^\n]+)/.exec(full)?.[1]?.trim() || null;
  return { session, courtDate, judge, courtRoom };
}

function extract(re, text) {
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

function parseNames(raw) {
  if (!raw) return [];
  return raw
    .split(/;/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseFutureHearings(text) {
  const hearings = [];
  // Pattern: "JURY TRIAL 4/22/2026 9:00:00 AM" — type (may be multi-word),
  // then a date, then a time. The keyword set is small in practice.
  const re = /\b([A-Z][A-Z\/ ]{2,40}?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)/g;
  let m;
  while ((m = re.exec(text))) {
    hearings.push({
      type: m[1].trim(),
      date: m[2],
      time: m[3],
    });
  }
  return hearings;
}

function parseCaseBlock(block, session) {
  const caseNumber = extract(/CASE NO:\s*([A-Z0-9\-]+)/, block);
  if (!caseNumber) return null;

  const defendant = extract(/Defendant:\s*([^\n]+)/, block);
  const [lastName, firstRest] = (defendant || '').split(',').map((s) => s.trim());
  const [firstName, ...middleParts] = (firstRest || '').split(/\s+/);

  const dob = extract(/DOB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/, block);
  const gender = extract(/Gender:\s*([A-Za-z]+)/, block);
  const race = extract(/Race:\s*([A-Za-z]+)/, block);
  const address = extract(/Address:\s*([^\n]+)/, block);
  const inCustody = /In Custody:\s*YES/i.test(block);
  const dateOfArrest = extract(/Date of Arrest:\s*(\d{1,2}\/\d{1,2}\/\d{4})/, block);
  const bookingNo = extract(/Booking No:\s*([A-Z0-9\-]+)/, block);
  // Anchor offense-date capture on the digits to skip empty values that would
  // otherwise consume the next label ("Bond Out Date:").
  const offenseDate = extract(
    /Offense Date:\s*(\d{1,2}\/\d{1,2}\/\d{4}(?:,\s*\d{1,2}\/\d{1,2}\/\d{4})*)/,
    block
  );

  // PDF text extractor inserts newlines between runs, so SET FOR and its
  // value land on different "lines" — allow [\s\S] to cross newlines.
  const setFor = extract(/SET FOR:\s*([\s\S]+?)\s+HEARING COMMENTS:/, block);

  // Defense attorneys: line after "RC" on the PD/PA/APD/RC row, up until "ASA"
  const rcBlock = /RC\s+([\s\S]+?)\s+ASA\b/.exec(block);
  const defenseAttorneys = rcBlock ? parseNames(rcBlock[1]) : [];

  // State attorneys: line after "SWP" until "Defendant"/"SET FOR" header
  const asaBlock = /ASA\s+SWP\s+([\s\S]+?)(?:\n\s*(?:Defendant:|SET FOR:|VERDICT:|VOCC\/VOP:))/.exec(block);
  const stateAttorneys = asaBlock ? parseNames(asaBlock[1]) : [];

  // Raw charges: the DEGREE table. Just grab the slab between DISPO and
  // the next section anchor — downstream AI can normalize later.
  const chargesBlock = /DEGREE\s+CHARGE[^\n]*\n([\s\S]+?)(?:FUTURE HEARINGS:|SET FOR:|Defendant:|$)/.exec(block);
  const rawCharges = chargesBlock ? chargesBlock[1].trim() : null;

  const futureHearings = parseFutureHearings(block);

  return {
    caseNumber,
    defendant: {
      fullName: defendant,
      lastName: lastName || null,
      firstName: firstName || null,
      middleName: middleParts.length ? middleParts.join(' ') : null,
    },
    dob,
    gender,
    race,
    address,
    inCustody,
    dateOfArrest,
    bookingNumber: bookingNo,
    offenseDate,
    hearing: {
      session: session.session,
      courtDate: session.courtDate,
      judge: session.judge,
      courtRoom: session.courtRoom,
      setFor,
    },
    defenseAttorneys,
    stateAttorneys,
    rawCharges,
    futureHearings,
  };
}

export async function parseCalendarPdf(buffer) {
  const pages = await extractPdfText(buffer);
  const session = parseSessionHeader(pages);

  // Concatenate data pages only, then split on CASE NO: markers.
  const dataText = pages.filter(isDataPage).join('\n');
  const blocks = dataText.split(/(?=CASE NO:\s*\d)/g).filter((b) => b.includes('CASE NO:'));

  const cases = [];
  for (const block of blocks) {
    const parsed = parseCaseBlock(block, session);
    if (parsed) cases.push(parsed);
  }

  return { session, cases };
}

export async function fetchCalendarsForDate(type, date, { last = null } = {}) {
  const pdfs = await listCalendarPdfs(type, date);
  if (!pdfs.length) {
    return {
      ok: true,
      county: 'hillsborough-fl',
      type,
      date,
      fetchedAt: new Date().toISOString(),
      fileCount: 0,
      caseCount: 0,
      sessions: [],
      message: 'No calendar PDFs found for this date — they are typically posted 5 days in advance.',
    };
  }

  const sessions = [];
  let totalCases = 0;

  for (const pdf of pdfs) {
    const res = await fetch(pdf.url);
    if (!res.ok) {
      sessions.push({ pdf: pdf.name, error: `${res.status} ${res.statusText}` });
      continue;
    }
    const buffer = await res.arrayBuffer();
    try {
      const { session, cases } = await parseCalendarPdf(buffer);
      let filtered = cases;
      if (last) {
        const needle = String(last).trim().toUpperCase();
        filtered = cases.filter((c) => c.defendant.lastName?.toUpperCase() === needle);
      }
      totalCases += filtered.length;
      sessions.push({
        pdf: pdf.name,
        url: pdf.url,
        session,
        caseCount: filtered.length,
        cases: filtered,
      });
    } catch (error) {
      sessions.push({ pdf: pdf.name, error: error.message });
    }
  }

  return {
    ok: true,
    county: 'hillsborough-fl',
    type,
    date,
    fetchedAt: new Date().toISOString(),
    fileCount: pdfs.length,
    caseCount: totalCases,
    filters: { last: last || null },
    sessions,
  };
}
