// Wisconsin Circuit Court Access (WCCA) adapter.
// Source: https://wcca.wicourts.gov/
//
// Two search modes, matching hover.mjs:
//   - lookupCaseByNumber(caseNumber, { county })  — exact case detail
//   - lookupCasesByParty({ lastName, ... })       — name-based search
//
// Notes / caveats for demo framing:
//   * WCCA's Terms of Use restrict automated/bulk access. This adapter is
//     built as a user-initiated lookup helper — one case per invocation,
//     indistinguishable from a lawyer manually loading the page. Do not
//     crank it in a loop against WCCA; they IP-ban aggressive clients and
//     the licensed REST API is $12.5k/yr for that use case.
//   * WCCA shows a Terms-of-Use dialog on first visit. We click "I Accept"
//     so the session cookie is set before hitting the case-detail URL.
//   * Selectors are permissive; WCCA uses classic server-rendered HTML and
//     changes labels occasionally. Every field has multiple fallbacks and
//     returns null (not throws) on miss.
import { launchBrowser, captureFailure, withRetry } from './browser.mjs';

const WCCA_HOME = 'https://wcca.wicourts.gov/';
const WCCA_CASE_DETAIL = 'https://wcca.wicourts.gov/caseDetail.html';
const WCCA_NAME_SEARCH = 'https://wcca.wicourts.gov/nameSearch.html';
const NAV_TIMEOUT_MS = 60_000;
const ELEMENT_TIMEOUT_MS = 30_000;

// The 72-county code map. Only the big ones are inlined; if you need
// another, pass the numeric code directly as --county 54, etc.
const COUNTY_CODES = {
  milwaukee: '40',
  dane: '13',
  waukesha: '67',
  brown: '05',
  racine: '51',
  outagamie: '44',
  winnebago: '70',
  kenosha: '30',
  rock: '53',
  washington: '66',
  laCrosse: '32',
  'la crosse': '32',
  walworth: '64',
  sheboygan: '59',
  marathon: '37',
  eauClaire: '17',
  'eau claire': '17',
};

function resolveCounty(input) {
  if (!input) return COUNTY_CODES.milwaukee;
  const s = String(input).trim().toLowerCase();
  if (/^\d+$/.test(s)) return s.padStart(2, '0');
  const code = COUNTY_CODES[s];
  if (!code) {
    throw new Error(
      `Unknown county "${input}". Pass a numeric county code (e.g. --county 40) ` +
        `or one of: ${Object.keys(COUNTY_CODES).filter((k) => !k.includes(' ')).join(', ')}.`,
    );
  }
  return code;
}

// Accepts "2024CF001234", "2024-CF-001234", "2024 CF 001234"; returns the
// canonical URL form with no separators.
function normalizeCaseNumber(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function findFirst(page, candidates, { timeout = ELEMENT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of candidates) {
      const el = await page.$(selector);
      if (el && (await el.isVisible().catch(() => false))) return el;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`No candidate selector matched: ${candidates.join(' | ')}`);
}

async function maybeAcceptTerms(page) {
  const candidates = [
    'button:has-text("I Accept")',
    'button:has-text("Accept")',
    'input[value*="Accept" i]',
    'a:has-text("I Accept")',
    '[role="button"]:has-text("Accept")',
    'form[name="agree"] button',
  ];
  for (const sel of candidates) {
    const el = await page.$(sel).catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => null);
      await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => null);
      return true;
    }
  }
  return false;
}

// Pull key/value pairs out of the DT/DD or TH/TD patterns WCCA uses.
async function extractCaseDetail(page) {
  return page.evaluate(() => {
    const out = {
      pageTitle: document.title,
      heading: null,
      caseCaption: null,
      caseStatus: null,
      filingDate: null,
      classification: null,
      judge: null,
      charges: [],
      parties: [],
      hearings: [],
      events: [],
      rawTables: [],
    };

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // Heading (usually contains caseNumber - defendantName)
    const h = document.querySelector('h1, h2, .panel-title, .case-heading');
    out.heading = clean(h?.textContent);

    // Key/value pairs — WCCA uses <dt><dd> and two-cell <tr>
    const kv = {};
    document.querySelectorAll('dt').forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') kv[clean(dt.textContent).toLowerCase()] = clean(dd.textContent);
    });
    document.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.cells || []);
      if (cells.length === 2) {
        const key = clean(cells[0].textContent).toLowerCase().replace(/:$/, '');
        const val = clean(cells[1].textContent);
        if (key && val && !kv[key]) kv[key] = val;
      }
    });

    out.caseStatus = kv['status'] || kv['case status'] || null;
    out.filingDate = kv['filing date'] || kv['date filed'] || null;
    out.classification = kv['case type'] || kv['classification'] || kv['class'] || null;
    out.judge = kv['branch'] || kv['judge'] || kv['assigned judge'] || null;
    out.caseCaption = kv['caption'] || kv['case caption'] || null;

    // Table scanning — WCCA labels parties/charges/events by th text.
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const headerRow = t.rows?.[0];
      const headers = Array.from(headerRow?.cells || []).map((c) => clean(c.textContent).toLowerCase());
      const dataRows = Array.from(t.rows).slice(1).map((r) =>
        Array.from(r.cells).map((c) => clean(c.textContent)),
      );
      const headerSig = headers.join('|');

      // Save raw to help with debugging.
      out.rawTables.push({ headers, rowCount: dataRows.length });

      if (headers.includes('party') || headers.includes('name')) {
        for (const row of dataRows) {
          const rec = {};
          headers.forEach((h, i) => (rec[h] = row[i]));
          if (rec.name || rec.party) out.parties.push(rec);
        }
      }

      if (headers.includes('statute') || headers.includes('charge') || headers.includes('offense')) {
        for (const row of dataRows) {
          const rec = {};
          headers.forEach((h, i) => (rec[h] = row[i]));
          out.charges.push(rec);
        }
      }

      if (
        headers.some((h) => /hearing|court date|calendar/.test(h)) ||
        headers.some((h) => /date/.test(h)) && headers.some((h) => /type|description|event/.test(h))
      ) {
        for (const row of dataRows) {
          const rec = {};
          headers.forEach((h, i) => (rec[h] = row[i]));
          // Heuristic: rows with a date + event/description go to events; rows
          // with explicit hearing vocabulary go to hearings.
          const joined = Object.values(rec).join(' ').toLowerCase();
          if (/hearing|conference|trial|arraignment|motion|status/.test(joined)) {
            out.hearings.push(rec);
          } else {
            out.events.push(rec);
          }
        }
      }
    }

    return out;
  });
}

export async function lookupCaseByNumber(rawCaseNumber, { county = 'milwaukee', headless = true } = {}) {
  const caseNumber = normalizeCaseNumber(rawCaseNumber);
  if (!caseNumber) throw new Error('Case number is required');
  const countyCode = resolveCounty(county);

  const { browser, page } = await launchBrowser({ headless });
  try {
    return await withRetry(
      async () => {
        // Visit home first so ToS prompt is in a clean state.
        await page.goto(WCCA_HOME, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        await maybeAcceptTerms(page);

        const url = `${WCCA_CASE_DETAIL}?caseNo=${encodeURIComponent(caseNumber)}&countyNo=${countyCode}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        await maybeAcceptTerms(page);

        // Some deployments redirect back to a search form if the case is
        // not found. Detect that and bail with a clean error.
        const notFound = await page.$eval(
          'body',
          (b) => /no records found|case.*not found|invalid.*case/i.test(b.innerText || ''),
        ).catch(() => false);
        if (notFound) {
          return {
            ok: false,
            source: 'wcca',
            county: countyCode,
            caseNumber,
            url: page.url(),
            fetchedAt: new Date().toISOString(),
            error: 'Case not found on WCCA (check case number + county).',
          };
        }

        const detail = await extractCaseDetail(page);
        return {
          ok: true,
          source: 'wcca',
          county: countyCode,
          caseNumber,
          url: page.url(),
          fetchedAt: new Date().toISOString(),
          ...detail,
        };
      },
      { attempts: 2, label: 'wcca-case-lookup' },
    );
  } catch (error) {
    const debug = await captureFailure(page, 'wcca-case').catch(() => null);
    return {
      ok: false,
      source: 'wcca',
      caseNumber,
      county: countyCode,
      error: error.message,
      debug,
    };
  } finally {
    await browser.close();
  }
}

export async function lookupCasesByParty(
  { lastName, firstName, middleName, fromDate, toDate, county = 'milwaukee' },
  { headless = true } = {},
) {
  if (!lastName) throw new Error('lastName is required');
  const countyCode = resolveCounty(county);

  const { browser, page } = await launchBrowser({ headless });
  try {
    return await withRetry(
      async () => {
        await page.goto(WCCA_NAME_SEARCH, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
        await maybeAcceptTerms(page);

        const last = await findFirst(page, [
          'input[name="lastName"]',
          'input#lastName',
          'input[aria-label*="Last" i]',
        ]);
        await last.fill(lastName);

        if (firstName) {
          const first = await findFirst(page, [
            'input[name="firstName"]',
            'input#firstName',
            'input[aria-label*="First" i]',
          ]).catch(() => null);
          if (first) await first.fill(firstName);
        }

        if (middleName) {
          const mid = await findFirst(page, [
            'input[name="middleName"]',
            'input#middleName',
            'input[aria-label*="Middle" i]',
          ]).catch(() => null);
          if (mid) await mid.fill(middleName);
        }

        // County dropdown — set by display text.
        const countySel = await findFirst(page, [
          'select[name="countyNo"]',
          'select#countyNo',
          'select[aria-label*="County" i]',
        ]).catch(() => null);
        if (countySel) await countySel.selectOption({ value: countyCode }).catch(() => null);

        // Date filters (optional)
        const toWccaDate = (s) => {
          if (!s) return '';
          const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
          return s;
        };
        if (fromDate) {
          const f = await page.$('input[name="filingDateFrom"], input#filingDateFrom');
          if (f) await f.fill(toWccaDate(fromDate));
        }
        if (toDate) {
          const t = await page.$('input[name="filingDateTo"], input#filingDateTo');
          if (t) await t.fill(toWccaDate(toDate));
        }

        const submit = await findFirst(page, [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Search")',
        ]);
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => null),
          submit.click(),
        ]);

        await page.waitForSelector('table', { timeout: ELEMENT_TIMEOUT_MS }).catch(() => null);

        const results = await page.evaluate(() => {
          const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const tables = Array.from(document.querySelectorAll('table'));
          for (const t of tables) {
            const headers = Array.from(t.rows?.[0]?.cells || []).map((c) =>
              clean(c.textContent).toLowerCase(),
            );
            if (
              headers.some((h) => /case/.test(h)) &&
              headers.some((h) => /party|name|defendant/.test(h))
            ) {
              return Array.from(t.rows)
                .slice(1)
                .map((r) => {
                  const cells = Array.from(r.cells).map((c) => clean(c.textContent));
                  const rec = {};
                  headers.forEach((h, i) => (rec[h] = cells[i]));
                  const link = r.querySelector('a[href*="caseDetail"]');
                  if (link) rec.caseDetailUrl = link.href;
                  return rec;
                });
            }
          }
          return [];
        });

        return {
          ok: true,
          source: 'wcca',
          county: countyCode,
          query: { lastName, firstName, middleName, fromDate, toDate },
          url: page.url(),
          fetchedAt: new Date().toISOString(),
          resultCount: results.length,
          results,
        };
      },
      { attempts: 2, label: 'wcca-party-search' },
    );
  } catch (error) {
    const debug = await captureFailure(page, 'wcca-party').catch(() => null);
    return {
      ok: false,
      source: 'wcca',
      county: countyCode,
      query: { lastName, firstName, middleName, fromDate, toDate },
      error: error.message,
      debug,
    };
  } finally {
    await browser.close();
  }
}
