// Hillsborough County HOVER adapter.
// Two search modes:
//   - lookupCaseByNumber(caseNumber)        — exact match when client has a number
//   - lookupCasesByParty({ lastName, ... }) — fallback when the client does not
//
// Selectors are intentionally permissive because HOVER is a legacy JSP portal
// that changes markup without notice. Every field has 2+ fallback strategies.
// If a field is not found we return it as `null` rather than throwing, so
// downstream AI extraction can mark it low-confidence.
import { launchBrowser, captureFailure, withRetry } from './browser.mjs';

const HOVER_SEARCH_URL = 'https://hover.hillsclerk.com/html/case/caseSearch.html';
const NAV_TIMEOUT_MS = 60_000;
const ELEMENT_TIMEOUT_MS = 30_000;
const PARTY_RESULT_CAP = 50;

// Accepts formats like "24-CA-012345" or "2024-CA-012345" — trimmed/uppercased.
function normalizeCaseNumber(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '');
}

// HOVER date inputs usually expect MM/DD/YYYY. Accept ISO (YYYY-MM-DD) input
// from callers and convert, because that's what the worker / cron will send.
function toHoverDate(input) {
  if (!input) return '';
  const s = String(input).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const mm = slash[1].padStart(2, '0');
    const dd = slash[2].padStart(2, '0');
    return `${mm}/${dd}/${slash[3]}`;
  }
  return s;
}

// Try multiple selector strategies in order; return the first one that resolves
// to a visible element. Keeps the scraper resilient to minor markup changes.
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

export async function lookupCaseByNumber(rawCaseNumber, { headless = true } = {}) {
  const caseNumber = normalizeCaseNumber(rawCaseNumber);
  if (!caseNumber) throw new Error('Case number is required');

  const { browser, page } = await launchBrowser({ headless });
  try {
    return await withRetry(
      async () => {
        await page.goto(HOVER_SEARCH_URL, {
          waitUntil: 'networkidle',
          timeout: NAV_TIMEOUT_MS,
        });

        // HOVER uses tabs for each search mode. Find the case-number tab/button.
        // Fallback strategy covers varying markup: button > anchor > tab role.
        const caseTab = await findFirst(page, [
          'a:has-text("Case Number")',
          'button:has-text("Case Number")',
          'li:has-text("Case Number") >> a',
          '[role="tab"]:has-text("Case Number")',
        ]).catch(() => null);
        if (caseTab) await caseTab.click();

        const input = await findFirst(page, [
          'input[name="caseNumber"]',
          'input#caseNumber',
          'input[placeholder*="Case" i]',
          'input[aria-label*="Case" i]',
        ]);
        await input.fill(caseNumber);

        const submit = await findFirst(page, [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Search")',
        ]);

        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => null),
          submit.click(),
        ]);

        // Results page: capture the raw table rows. We'll let the caller
        // (or the AI extraction step) normalize fields — the scraper's job is
        // retrieval + light structure, not interpretation.
        await page.waitForSelector('table', { timeout: ELEMENT_TIMEOUT_MS }).catch(() => null);

        const rows = await page.$$eval('table tr', (trs) =>
          trs
            .map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.textContent?.trim() || ''))
            .filter((cells) => cells.some((c) => c.length > 0))
        );

        // Click through to case detail page if a result is present.
        const detailLink = await page
          .$('table a[href*="caseSummary"], table a[href*="caseDetail"]')
          .catch(() => null);

        let detail = null;
        if (detailLink) {
          const href = await detailLink.getAttribute('href');
          await Promise.all([
            page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS }).catch(() => null),
            detailLink.click(),
          ]);

          const detailText = await page.evaluate(() => document.body.innerText);
          const detailRows = await page.$$eval('table tr', (trs) =>
            trs
              .map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.textContent?.trim() || ''))
              .filter((cells) => cells.some((c) => c.length > 0))
          );

          detail = {
            url: page.url(),
            sourceHref: href,
            text: detailText.slice(0, 20_000),
            tables: detailRows,
          };
        }

        return {
          ok: true,
          county: 'hillsborough-fl',
          queriedAt: new Date().toISOString(),
          caseNumber,
          searchResultsUrl: page.url(),
          searchResults: rows,
          detail,
        };
      },
      { attempts: 3, label: 'hover-case-lookup' }
    );
  } catch (error) {
    const dump = await captureFailure(page, 'hover-case-lookup');
    return {
      ok: false,
      county: 'hillsborough-fl',
      queriedAt: new Date().toISOString(),
      caseNumber,
      error: error.message,
      debug: dump,
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

// Party-name search. Used when the client does not yet know the case number —
// the nightly watch job calls this with the client's legal name and a date
// window around the incident (e.g., arrest date ± 90 days for criminal).
//
// Returns raw table rows. A downstream AI matcher scores candidates against
// the intake (name exact-match, date proximity, matter type) to pick the
// likely case. We intentionally don't try to be clever here.
export async function lookupCasesByParty(
  { lastName, firstName = '', middleName = '', fromDate = '', toDate = '' } = {},
  { headless = true } = {}
) {
  const cleanLast = String(lastName || '').trim();
  if (!cleanLast) throw new Error('lastName is required');

  const cleanFirst = String(firstName || '').trim();
  const cleanMiddle = String(middleName || '').trim();
  const hoverFrom = toHoverDate(fromDate);
  const hoverTo = toHoverDate(toDate);

  const { browser, page } = await launchBrowser({ headless });
  try {
    return await withRetry(
      async () => {
        await page.goto(HOVER_SEARCH_URL, {
          waitUntil: 'networkidle',
          timeout: NAV_TIMEOUT_MS,
        });

        // Switch to the Party/Business Name tab. HOVER uses varying markup
        // across updates, so try several strategies.
        const partyTab = await findFirst(page, [
          'a:has-text("Party Name")',
          'a:has-text("Party/Business")',
          'button:has-text("Party Name")',
          'li:has-text("Party") >> a',
          '[role="tab"]:has-text("Party")',
        ]).catch(() => null);
        if (partyTab) await partyTab.click();

        const lastInput = await findFirst(page, [
          'input[name="lastName"]',
          'input#lastName',
          'input[placeholder*="Last" i]',
          'input[aria-label*="Last" i]',
        ]);
        await lastInput.fill(cleanLast);

        if (cleanFirst) {
          const firstInput = await findFirst(page, [
            'input[name="firstName"]',
            'input#firstName',
            'input[placeholder*="First" i]',
            'input[aria-label*="First" i]',
          ]).catch(() => null);
          if (firstInput) await firstInput.fill(cleanFirst);
        }

        if (cleanMiddle) {
          const middleInput = await findFirst(page, [
            'input[name="middleName"]',
            'input#middleName',
            'input[placeholder*="Middle" i]',
            'input[aria-label*="Middle" i]',
          ]).catch(() => null);
          if (middleInput) await middleInput.fill(cleanMiddle);
        }

        if (hoverFrom) {
          const fromInput = await findFirst(page, [
            'input[name="filedFromDate"]',
            'input[name="fromDate"]',
            'input#fromDate',
            'input[placeholder*="From" i]',
            'input[aria-label*="From" i]',
          ]).catch(() => null);
          if (fromInput) await fromInput.fill(hoverFrom);
        }

        if (hoverTo) {
          const toInput = await findFirst(page, [
            'input[name="filedToDate"]',
            'input[name="toDate"]',
            'input#toDate',
            'input[placeholder*="To" i]',
            'input[aria-label*="To" i]',
          ]).catch(() => null);
          if (toInput) await toInput.fill(hoverTo);
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

        // Extract results table + an explicit "no results" sniff so callers can
        // distinguish "HOVER returned zero matches" from "scrape failed".
        const noResults = await page
          .evaluate(() => {
            const text = (document.body.innerText || '').toLowerCase();
            return (
              text.includes('no records') ||
              text.includes('no results') ||
              text.includes('no matching')
            );
          })
          .catch(() => false);

        const rows = await page.$$eval('table tr', (trs) =>
          trs
            .map((tr) => {
              const cells = [...tr.querySelectorAll('th, td')].map((c) => c.textContent?.trim() || '');
              const link = tr.querySelector('a[href]');
              return {
                cells,
                href: link ? link.getAttribute('href') : null,
              };
            })
            .filter((row) => row.cells.some((c) => c.length > 0))
        );

        // First row is usually the header. Split header vs data rows so the
        // caller can map cells by name ("Case Number", "Party Name", etc.).
        const [header, ...dataRows] = rows;
        const capped = dataRows.slice(0, PARTY_RESULT_CAP);

        return {
          ok: true,
          county: 'hillsborough-fl',
          queriedAt: new Date().toISOString(),
          query: {
            lastName: cleanLast,
            firstName: cleanFirst || null,
            middleName: cleanMiddle || null,
            fromDate: hoverFrom || null,
            toDate: hoverTo || null,
          },
          searchResultsUrl: page.url(),
          noResults,
          header: header?.cells || [],
          resultCount: capped.length,
          truncated: dataRows.length > PARTY_RESULT_CAP,
          results: capped,
        };
      },
      { attempts: 3, label: 'hover-party-lookup' }
    );
  } catch (error) {
    const dump = await captureFailure(page, 'hover-party-lookup');
    return {
      ok: false,
      county: 'hillsborough-fl',
      queriedAt: new Date().toISOString(),
      query: { lastName: cleanLast, firstName: cleanFirst, fromDate: hoverFrom, toDate: hoverTo },
      error: error.message,
      debug: dump,
    };
  } finally {
    await browser.close().catch(() => null);
  }
}
