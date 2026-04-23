// Milwaukee Open Data Portal lookup. Runs during /intake when the matter is
// located in Milwaukee. Uses an LLM pass over the free-text description to
// extract the incident's date / address / offense, then queries CKAN:
//   - WIBR Current (wibr)            — nightly-updated crime incidents YTD
//   - Traffic Crash (traffic_crash)  — daily-updated crashes, case-number keyed
//   - FPC Citizen Complaints         — aggregate only; dataset is redacted
// Google Geocoding turns the extracted address into lat/lon for logging; WIBR
// ships Wisconsin State Plane coords that we don't reproject — matching is by
// ZIP + tokenized address string, which is enough for "block-level" accuracy.

const CKAN_SEARCH = 'https://data.milwaukee.gov/api/3/action/datastore_search';

const RESOURCE_WIBR_CURRENT = '87843297-a6fa-46d4-ba5d-cb342fb2d3bb';
const RESOURCE_TRAFFIC_CRASH = '8fffaa3a-b500-4561-8898-78a424bdacee';
const RESOURCE_FPC_COMPLAINTS = '83052a7c-aeb0-4f8e-9289-4e18972e0df8';

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';

const MS_PER_DAY = 86400000;

// WIBR "offense" columns — per-incident flags set to "1" when that offense
// category applies. Keys match the LLM-extracted offenseCategory vocabulary.
const OFFENSE_COLUMN = {
  assault: 'AssaultOffense',
  burglary: 'Burglary',
  robbery: 'Robbery',
  theft: 'Theft',
  vehicleTheft: 'VehicleTheft',
  sexOffense: 'SexOffense',
  homicide: 'Homicide',
  criminalDamage: 'CriminalDamage',
  arson: 'Arson',
};

function normalizeUpper(str) {
  return (str || '').toString().trim().toUpperCase();
}

function tokenize(addr) {
  return normalizeUpper(addr)
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function parseLooseDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
  return null;
}

function daysBetween(a, b) {
  const dA = new Date(`${a}T00:00:00Z`).getTime();
  const dB = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(dA) || Number.isNaN(dB)) return Infinity;
  return Math.abs(Math.round((dA - dB) / MS_PER_DAY));
}

// --- LLM extraction ---------------------------------------------------------
// The structured intake fields only give us ZIP and city — the actual incident
// date, address, offense, and officer references live in the free-text
// description. One small Gemini call turns that into a structured record.

async function extractIncidentFromDescription(env, answers, callGemini) {
  const description = (answers?.description || '').trim();
  if (!description || typeof callGemini !== 'function') return null;

  const matterHint = answers?.matterType ? ` Matter type: ${answers.matterType}.` : '';
  const prompt = `You extract structured facts from a client-intake description for a Milwaukee, WI law firm.${matterHint}
Assume the current year is ${new Date().getFullYear()} if no year is explicitly specified in the description.

Return ONLY JSON matching this schema — use null for anything not clearly stated:
{
  "incidentDate": "YYYY-MM-DD or null",
  "incidentAddress": "normalized street address (e.g. '2700 N 27th St') or null",
  "offenseCategory": "one of: assault, burglary, robbery, theft, vehicleTheft, sexOffense, homicide, criminalDamage, arson, trafficCrash, policeStop, other, null",
  "officerMentioned": "name or badge if stated, or null"
}

Description:
${description}`;

  try {
    const text = await callGemini(env, 'gemini-2.5-flash', {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      incidentDate: parseLooseDate(parsed.incidentDate) || null,
      incidentAddress: (parsed.incidentAddress || '').toString().trim() || null,
      offenseCategory: (parsed.offenseCategory || '').toString().trim() || null,
      officerMentioned: (parsed.officerMentioned || '').toString().trim() || null,
    };
  } catch {
    return null;
  }
}

// --- Geocoding --------------------------------------------------------------

async function geocodeAddress(env, address) {
  const key = env?.GOOGLE_GEOCODING_API_KEY;
  if (!key || !address) return null;
  const params = new URLSearchParams({
    address: `${address}, Milwaukee, WI`,
    key,
  });
  try {
    const res = await fetch(`${GEOCODE_BASE}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const best = data?.results?.[0];
    const loc = best?.geometry?.location;
    if (!loc) return null;
    return {
      lat: loc.lat,
      lon: loc.lng,
      formatted: best.formatted_address || null,
      partialMatch: Boolean(best.partial_match),
    };
  } catch {
    return null;
  }
}

// --- WIBR --------------------------------------------------------------------

async function fetchWibrRows(zip) {
  const params = new URLSearchParams({
    resource_id: RESOURCE_WIBR_CURRENT,
    limit: '1000',
    sort: 'ReportedDateTime desc',
  });
  // ZIP is an indexed text column — filtering server-side keeps us under the
  // default 100-row page. Without ZIP we fall back to a broader pull capped
  // at 1000 rows (WIBR has ~7k YTD).
  if (zip) params.set('filters', JSON.stringify({ ZIP: zip }));
  const res = await fetch(`${CKAN_SEARCH}?${params.toString()}`);
  if (!res.ok) throw new Error(`WIBR CKAN ${res.status}`);
  const data = await res.json();
  return data?.result?.records || [];
}

function scoreWibrMatch(row, ctx) {
  const reasons = [];
  let score = 0;

  const rowTokens = tokenize(row.Location);
  const needleTokens = tokenize(ctx.incidentAddress);
  if (needleTokens.length && rowTokens.length) {
    const j = jaccard(rowTokens, needleTokens);
    if (j >= 0.5) {
      score += 50;
      reasons.push(`address match (${Math.round(j * 100)}%)`);
    } else if (j >= 0.2) {
      score += 20;
      reasons.push(`address partial (${Math.round(j * 100)}%)`);
    }
  }

  if (ctx.zip && row.ZIP === ctx.zip) {
    score += 15;
    reasons.push('ZIP match');
  }

  if (ctx.incidentDate && row.ReportedDateTime) {
    const rowDate = parseLooseDate(row.ReportedDateTime);
    if (rowDate) {
      const diff = daysBetween(rowDate, ctx.incidentDate);
      if (diff === 0) {
        score += 40;
        reasons.push('same-day');
      } else if (diff <= 2) {
        score += 20;
        reasons.push(`±${diff} day${diff === 1 ? '' : 's'}`);
      } else if (diff <= 7) {
        score += 5;
        reasons.push('same-week');
      }
    }
  }

  if (ctx.offenseCategory) {
    const col = OFFENSE_COLUMN[ctx.offenseCategory];
    if (col && Number(row[col]) > 0) {
      score += 25;
      reasons.push(`offense type (${ctx.offenseCategory})`);
    }
  }

  let confidence = 'low';
  if (score >= 90) confidence = 'high';
  else if (score >= 50) confidence = 'medium';

  return { score, confidence, reasons };
}

async function lookupWibr(ctx) {
  try {
    const rows = await fetchWibrRows(ctx.zip);
    const scored = [];
    for (const row of rows) {
      if (ctx.incidentDate && row.ReportedDateTime) {
        const rowDate = parseLooseDate(row.ReportedDateTime);
        if (rowDate && daysBetween(rowDate, ctx.incidentDate) > 14) continue;
      }
      const match = scoreWibrMatch(row, ctx);
      if (match.score <= 0) continue;
      const offenses = Object.entries(OFFENSE_COLUMN)
        .filter(([, col]) => Number(row[col]) > 0)
        .map(([key]) => key);
      scored.push({
        incidentNum: row.IncidentNum,
        reportedAt: row.ReportedDateTime,
        location: row.Location,
        zip: row.ZIP,
        policeDistrict: row.POLICE,
        weapon: row.WeaponUsed || null,
        offenses,
        match,
      });
    }
    scored.sort((a, b) => b.match.score - a.match.score);
    return {
      ok: true,
      rowsScanned: rows.length,
      matchCount: scored.length,
      matches: scored.slice(0, 10),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'WIBR lookup failed' };
  }
}

// --- Traffic Crash ----------------------------------------------------------

async function lookupTrafficCrash(ctx) {
  // Only try when the extraction gave us a hook — a raw "pull everything"
  // here would be noisy, since the dataset has no ZIP column to pre-filter on.
  if (!ctx.incidentDate && !ctx.incidentAddress) {
    return { ok: true, matchCount: 0, matches: [] };
  }
  try {
    const params = new URLSearchParams({
      resource_id: RESOURCE_TRAFFIC_CRASH,
      limit: '1000',
      sort: 'CASEDATE desc',
    });
    const res = await fetch(`${CKAN_SEARCH}?${params.toString()}`);
    if (!res.ok) return { ok: false, error: `Traffic Crash CKAN ${res.status}` };
    const data = await res.json();
    const rows = data?.result?.records || [];

    const matches = [];
    for (const row of rows) {
      const rowDate = parseLooseDate(row.CASEDATE);

      // If we have an anchor date, discard rows outside the 14-day window
      if (ctx.incidentDate && rowDate && daysBetween(rowDate, ctx.incidentDate) > 14) continue;

      let score = 0;
      const reasons = [];
      if (ctx.incidentDate && rowDate) {
        const diff = daysBetween(rowDate, ctx.incidentDate);
        if (diff === 0) {
          score += 40;
          reasons.push('same-day');
        } else if (diff <= 2) {
          score += 20;
          reasons.push(`±${diff} day${diff === 1 ? '' : 's'}`);
        }
      }
      if (ctx.incidentAddress) {
        const j = jaccard(tokenize(row.CRASHLOC), tokenize(ctx.incidentAddress));
        if (j >= 0.5) {
          score += 50;
          reasons.push(`location match (${Math.round(j * 100)}%)`);
        } else if (j >= 0.2) {
          score += 15;
          reasons.push(`location partial (${Math.round(j * 100)}%)`);
        }
      }
      if (score <= 0) continue;
      matches.push({
        caseNumber: row.CASENUMBER,
        caseDate: row.CASEDATE,
        location: row.CRASHLOC,
        match: {
          score,
          confidence: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
          reasons,
        },
      });
    }
    matches.sort((a, b) => b.match.score - a.match.score);
    return { ok: true, matchCount: matches.length, matches: matches.slice(0, 10) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Traffic crash lookup failed' };
  }
}

// --- FPC aggregate ----------------------------------------------------------
// The public CSV is redacted (no officer names, no complainant info), so this
// is strictly department-level context: how many MPD complaints exist, what
// categories dominate, how many are still open. Useful as a backdrop on
// civil-rights intakes but not a per-officer history.

async function lookupFpcAggregate() {
  try {
    const params = new URLSearchParams({
      resource_id: RESOURCE_FPC_COMPLAINTS,
      limit: '5000',
    });
    const res = await fetch(`${CKAN_SEARCH}?${params.toString()}`);
    if (!res.ok) return { ok: false, error: `FPC CKAN ${res.status}` };
    const data = await res.json();
    const rows = data?.result?.records || [];

    const cutoffIso = new Date(Date.now() - 365 * MS_PER_DAY).toISOString().slice(0, 10);
    const categoryCounts = new Map();
    let mpdTotal = 0;
    let mpdOpen = 0;
    let mpdLastYear = 0;

    for (const row of rows) {
      if (normalizeUpper(row.Department) !== 'MPD') continue;
      mpdTotal++;
      if ((row.Status || '').toString().toLowerCase() === 'open') mpdOpen++;
      const reportedIso = parseLooseDate(row.DateReported);
      if (reportedIso && reportedIso >= cutoffIso) mpdLastYear++;
      for (const raw of [row.Category1, row.Category2, row.Category3, row.Category4]) {
        const cat = (raw || '').toString().trim();
        if (!cat) continue;
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      }
    }

    const topCategories = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return { ok: true, mpdTotal, mpdOpen, mpdLastYear, topCategories };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'FPC aggregate failed' };
  }
}

// --- Main entry -------------------------------------------------------------

export function shouldRunMilwaukeeLookup(answers) {
  if (!answers) return false;
  const state = (answers.jurisdictionState || '').trim().toLowerCase();
  const county = (answers.jurisdictionCounty || '').trim().toLowerCase();
  const city = (answers.city || '').trim().toLowerCase();
  if (state && !['wi', 'wisconsin'].includes(state)) return false;
  if (county.includes('milwaukee')) return true;
  if (city === 'milwaukee') return true;
  return false;
}

export async function lookupMilwaukeeRecords(env, answers, { callGemini } = {}) {
  const extracted = await extractIncidentFromDescription(env, answers, callGemini);
  const coords = extracted?.incidentAddress
    ? await geocodeAddress(env, extracted.incidentAddress)
    : null;

  const ctx = {
    incidentDate: extracted?.incidentDate || null,
    incidentAddress: extracted?.incidentAddress || null,
    offenseCategory: extracted?.offenseCategory || null,
    officerMentioned: extracted?.officerMentioned || null,
    zip: (answers?.zip || '').trim() || null,
    coords,
  };

  const [wibr, trafficCrash, fpcContext] = await Promise.all([
    lookupWibr(ctx),
    lookupTrafficCrash(ctx),
    lookupFpcAggregate(),
  ]);

  const totalMatches =
    (wibr.matchCount || 0) + (trafficCrash.matchCount || 0);

  return {
    ok: true,
    searched: true,
    extracted: ctx,
    totalMatches,
    wibr,
    trafficCrash,
    fpcContext,
  };
}
