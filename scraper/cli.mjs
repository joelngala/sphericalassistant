#!/usr/bin/env node
// CLI wrapper for local testing.
//
// HOVER (Playwright, when a case number is known):
//   node cli.mjs --case 24-CA-012345
//   node cli.mjs --party --last Smith --first John --from 2026-01-15 --to 2026-04-15
//   node cli.mjs --case 24-CA-012345 --headed
//
// Hillsborough public-data pipeline (no Playwright, no CAPTCHA):
//   node cli.mjs --citations [--date 2026-04-17] [--dui] [--serious] [--last Smith]
//   node cli.mjs --calendars --type felony --date 2026-04-21 [--last Smith]
//   node cli.mjs --filings [--date 2026-04-17] [--unrepresented] [--last Smith] [--type drug]
//
import { lookupCaseByNumber, lookupCasesByParty } from './lib/hover.mjs';
import { fetchCitationsForDate } from './lib/hillsborough/citations.mjs';
import { fetchCalendarsForDate } from './lib/hillsborough/calendars.mjs';
import { fetchFilingsForDate } from './lib/hillsborough/filings.mjs';

function parseArgs(argv) {
  const args = { headless: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case') args.caseNumber = argv[++i];
    else if (arg === '--party') args.mode = 'party';
    else if (arg === '--citations') args.mode = 'citations';
    else if (arg === '--calendars') args.mode = 'calendars';
    else if (arg === '--filings') args.mode = 'filings';
    else if (arg === '--type') args.type = argv[++i];
    else if (arg === '--unrepresented') args.unrepresented = true;
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--last') args.lastName = argv[++i];
    else if (arg === '--first') args.firstName = argv[++i];
    else if (arg === '--middle') args.middleName = argv[++i];
    else if (arg === '--from') args.fromDate = argv[++i];
    else if (arg === '--to') args.toDate = argv[++i];
    else if (arg === '--dui') args.dui = true;
    else if (arg === '--serious') args.serious = true;
    else if (arg === '--headed') args.headless = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  if (args.caseNumber && !args.mode) args.mode = 'case';
  return args;
}

function printHelp() {
  console.log(`Usage:

  HOVER (Playwright — still blocked by CAPTCHA, experimental):
    node cli.mjs --case <CASE_NUMBER> [--headed]
    node cli.mjs --party --last <LAST> [--first <FIRST>] [--middle <MI>]
                 [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--headed]

  Hillsborough public-data pipeline (recommended — no CAPTCHA):
    node cli.mjs --citations [--date YYYY-MM-DD] [--dui] [--serious] [--last <LAST>]
    node cli.mjs --calendars --type <felony|misd|traffic> --date YYYY-MM-DD
                 [--last <LAST>]
    node cli.mjs --filings [--date YYYY-MM-DD] [--unrepresented] [--last <LAST>]
                 [--type <substring>]

Options:
  --citations        Daily citation feed (DUIs, traffic, etc.) — 1-day lag
  --calendars        Criminal court calendars (~5 days in advance)
  --filings          Daily criminal filings (felony/misd cases filed yesterday)
  --type             Calendars: felony|misd|traffic. Filings: case-type substring
  --date             YYYY-MM-DD (citations/filings optional; calendars required)
  --dui              Filter citations to DUI only
  --serious          Filter citations to serious traffic (reckless, leaving scene)
  --unrepresented    Filter filings to defendants with no attorney listed
  --last / --first   Defendant name filters
  --headed           Show browser (HOVER modes only)
`);
}

const args = parseArgs(process.argv);

if (args.help || !args.mode) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

let result;
try {
  if (args.mode === 'case') {
    result = await lookupCaseByNumber(args.caseNumber, { headless: args.headless });
  } else if (args.mode === 'party') {
    if (!args.lastName) {
      console.error('--party requires --last <lastName>');
      process.exit(1);
    }
    result = await lookupCasesByParty(
      {
        lastName: args.lastName,
        firstName: args.firstName,
        middleName: args.middleName,
        fromDate: args.fromDate,
        toDate: args.toDate,
      },
      { headless: args.headless }
    );
  } else if (args.mode === 'citations') {
    result = await fetchCitationsForDate(args.date, {
      last: args.lastName,
      dui: args.dui,
      serious: args.serious,
    });
  } else if (args.mode === 'calendars') {
    if (!args.type) {
      console.error('--calendars requires --type <felony|misd|traffic>');
      process.exit(1);
    }
    if (!args.date) {
      console.error('--calendars requires --date YYYY-MM-DD');
      process.exit(1);
    }
    result = await fetchCalendarsForDate(args.type, args.date, { last: args.lastName });
  } else if (args.mode === 'filings') {
    result = await fetchFilingsForDate(args.date, {
      last: args.lastName,
      unrepresented: args.unrepresented,
      type: args.type,
    });
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(2);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result?.ok ? 0 : 2);
