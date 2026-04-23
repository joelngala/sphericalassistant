// Orange County FL public-data lookup, fired from /intake when the matter
// is in Orange County, FL. Two parallel fan-outs:
//
//   1. OCSO daily booking PDF — netapps.ocfl.net/BestJail/PDF/bookings.pdf
//      Pulled fresh each intake (24-hour rolling window, ~100 entries/day).
//      Matched by last name with ZIP + age tiebreakers.
//
//   2. OCGIS Address Points API — public ArcGIS feature service. If the
//      intake description mentions an incident address inside Orange
//      County, this resolves it to a parcel ID + jurisdiction + DOR use
//      code (useful for premises-liability slip & fall).
//
// Anything the worker can't reach (live court case search, full property
// owner history) lands on the dashboard as a deep-link the extension picks
// up.

import { extractText, getDocumentProxy } from 'unpdf';
import { parseBookingsPdfText } from './orange-fl-pdf.js';

const BOOKINGS_URL = 'https://netapps.ocfl.net/BestJail/PDF/bookings.pdf';
const OCGIS_ADDRESS_URL =
  'https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/0/query';

// Cities that fall (entirely or partly) inside Orange County FL. Used as a
// fallback gate when the intake form's "county" field isn't specifically
// "Orange". Keep this list narrow — Kissimmee is in Osceola, not Orange.
const OC_FL_CITIES = new Set([
  'orlando',
  'winter park',
  'apopka',
  'ocoee',
  'winter garden',
  'belle isle',
  'maitland',
  'edgewood',
  'eatonville',
  'oakland',
  'windermere',
  'bay lake',
  'lake buena vista',
  'pine hills',
  'azalea park',
  'union park',
  'doctor phillips',
]);

// --- Gate -------------------------------------------------------------------

export function shouldRunOrangeFlLookup(answers) {
  if (!answers) return false;
  const state = (answers.jurisdictionState || '').trim().toLowerCase();
  if (state && !['fl', 'florida'].includes(state)) return false;
  const county = (answers.jurisdictionCounty || '').trim().toLowerCase();
  if (county.includes('orange')) return true;
  const city = (answers.city || '').trim().toLowerCase();
  if (OC_FL_CITIES.has(city)) return true;
  return false;
}

// --- Booking lookup ---------------------------------------------------------

function normUpper(s) {
  return (s || '').toString().trim().toUpperCase();
}

// Intake gives a single "fullName" string. Same loose splitter Hillsborough
// uses ("LAST, FIRST" or "FIRST [MIDDLE] LAST").
function splitName(fullName) {
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

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

// Score a parsed booking against the intake. Mirrors Hillsborough's scoring
// shape so the UI can render confidence dots the same way.
function scoreBooking(booking, intake) {
  const reasons = [];
  let score = 0;

  // Case# exact wins outright. The booking PDF contains every case attached
  // to a defendant on a single line — match against any of them.
  if (intake.caseNumber) {
    const wanted = normUpper(intake.caseNumber);
    const hit = booking.cases.find((c) => normUpper(c.caseNumber) === wanted);
    if (hit) {
      reasons.push('case-number exact');
      score += 100;
    }
  }

  const bookingLast = booking.name.split(',')[0].trim().toUpperCase();
  if (intake.lastName && bookingLast === intake.lastName) {
    reasons.push('last-name match');
    score += 50;
  }

  const bookingFirst = (booking.name.split(',')[1] || '').trim().split(/\s+/)[0];
  if (intake.firstName && bookingFirst && bookingFirst.toUpperCase() === intake.firstName) {
    reasons.push('first-name match');
    score += 25;
  }

  if (intake.age != null && booking.age != null) {
    const diff = Math.abs(booking.age - intake.age);
    if (diff === 0) {
      reasons.push('age exact');
      score += 20;
    } else if (diff <= 2) {
      reasons.push(`age ±${diff}`);
      score += 8;
    }
  }

  if (intake.zip && booking.address.zip && booking.address.zip === intake.zip) {
    reasons.push('zip match');
    score += 10;
  }

  if (intake.city && booking.address.city) {
    if (normUpper(booking.address.city) === intake.city) {
      reasons.push('city match');
      score += 5;
    }
  }

  let confidence = 'low';
  if (score >= 100) confidence = 'high';
  else if (score >= 50) confidence = 'medium';

  return { score, confidence, reasons };
}

async function fetchBookingsText() {
  const res = await fetch(BOOKINGS_URL, {
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`OCSO bookings PDF ${res.status}`);
  const buf = await res.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function lookupBookings(intake) {
  try {
    const text = await fetchBookingsText();
    const parsed = parseBookingsPdfText(text);

    // No-name intakes still get the report metadata (date + total) so the
    // UI can show "X bookings today, no match for your client".
    if (!intake.lastName && !intake.caseNumber) {
      return {
        ok: true,
        searched: false,
        reportDate: parsed.reportDate,
        totalReported: parsed.totalReported || parsed.bookings.length,
        matchCount: 0,
        matches: [],
      };
    }

    const scored = [];
    for (const b of parsed.bookings) {
      const last = b.name.split(',')[0].trim().toUpperCase();
      // Last-name pre-filter unless the intake gave us a case number to find
      // anywhere in the report.
      if (intake.lastName && last !== intake.lastName && !intake.caseNumber) continue;
      const match = scoreBooking(b, intake);
      if (match.score <= 0) continue;
      scored.push({ ...b, match });
    }
    scored.sort((a, b) => b.match.score - a.match.score);

    return {
      ok: true,
      searched: true,
      reportDate: parsed.reportDate,
      totalReported: parsed.totalReported || parsed.bookings.length,
      matchCount: scored.length,
      matches: scored.slice(0, 10),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Booking lookup failed' };
  }
}

// --- Address / parcel lookup (OCGIS) ----------------------------------------

// Pull a likely incident address out of the description. Re-uses the LLM
// callback that worker/index.js already passes to Milwaukee — keeps the
// extraction prompt small and JSON-only.
async function extractIncidentAddress(env, intake, callGemini) {
  const description = (intake?.description || '').trim();
  if (!description || typeof callGemini !== 'function') return null;

  const prompt = `Extract the most likely incident address from this client-intake description for an Orlando-area law firm. Respond ONLY with JSON: {"address": "1234 N Main St" or null, "intersection": "Main St and Oak Ave" or null}.

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
      address: (parsed.address || '').toString().trim() || null,
      intersection: (parsed.intersection || '').toString().trim() || null,
    };
  } catch {
    return null;
  }
}

// Address strings come in many shapes. For the OCGIS query we just need the
// street name (basename). Pull tokens that look like the street name —
// anything after a leading number, trimmed of common type suffixes.
function streetBasename(address) {
  if (!address) return null;
  // "1234 N Colonial Dr Orlando, FL" -> "COLONIAL"
  const tokens = address.toUpperCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  while (tokens.length && /^\d+$/.test(tokens[0])) tokens.shift();
  if (tokens[0] && /^(N|S|E|W|NE|NW|SE|SW)$/.test(tokens[0])) tokens.shift();
  const types = new Set(['DR', 'DRIVE', 'ST', 'STREET', 'AVE', 'AVENUE', 'BLVD', 'BOULEVARD', 'RD', 'ROAD', 'LN', 'LANE', 'CT', 'COURT', 'PKWY', 'PARKWAY', 'PL', 'PLACE', 'TRL', 'TRAIL', 'WAY', 'CIR', 'CIRCLE', 'HWY', 'HIGHWAY']);
  // Keep only tokens before the first street-type word — anything after is
  // a city/state/ZIP and not part of the street name.
  const typeIdx = tokens.findIndex((t) => types.has(t));
  const basenameTokens = typeIdx === -1 ? tokens : tokens.slice(0, typeIdx);
  return basenameTokens.length ? basenameTokens.join(' ') : null;
}

async function lookupParcel(intake, env, callGemini) {
  const extracted = await extractIncidentAddress(env, intake, callGemini);
  const address = extracted?.address || null;
  const basename = streetBasename(address);
  if (!basename) {
    return { ok: true, searched: false, address: null, parcels: [] };
  }

  // Filter on BASENAME (street name only). Try ZIP-narrowed first; if that
  // returns nothing, fall back to street-only — the client's ZIP is often
  // different from the incident's ZIP (slip & fall, MVA away from home).
  const escaped = basename.replace(/'/g, "''");
  const tryQuery = async (where) => {
    const params = new URLSearchParams({
      where,
      outFields:
        'COMPLETE_ADDRESS,OFFICIAL_PARCEL_ID,ZIPCODE,MUNICIPAL_JURISDICTION,LATITUDE,LONGITUDE,DOR_SHORT_DESC',
      resultRecordCount: '5',
      f: 'json',
    });
    const res = await fetch(`${OCGIS_ADDRESS_URL}?${params.toString()}`);
    if (!res.ok) throw new Error(`OCGIS ${res.status}`);
    const data = await res.json();
    return (data.features || []).map((f) => ({
      address: f.attributes.COMPLETE_ADDRESS,
      parcelId: f.attributes.OFFICIAL_PARCEL_ID,
      zip: f.attributes.ZIPCODE,
      jurisdiction: f.attributes.MUNICIPAL_JURISDICTION,
      latitude: f.attributes.LATITUDE,
      longitude: f.attributes.LONGITUDE,
      useCode: f.attributes.DOR_SHORT_DESC,
    }));
  };

  try {
    let parcels = [];
    if (intake.zip) {
      parcels = await tryQuery(`BASENAME='${escaped}' AND ZIPCODE='${intake.zip}'`);
    }
    if (parcels.length === 0) {
      parcels = await tryQuery(`BASENAME='${escaped}'`);
    }
    return { ok: true, searched: true, address, basename, parcels };
  } catch (err) {
    return { ok: false, searched: true, address, error: err instanceof Error ? err.message : 'OCGIS query failed' };
  }
}

// --- Main entry -------------------------------------------------------------

export async function lookupOrangeFlRecords(env, answers, { callGemini } = {}) {
  const { firstName, lastName } = splitName(answers?.fullName || '');
  const intake = {
    firstName: normUpper(firstName),
    lastName: normUpper(lastName),
    caseNumber: (answers?.caseNumber || '').trim() || null,
    age: ageFromDob(answers?.dob || ''),
    zip: (answers?.zip || '').trim() || null,
    city: normUpper(answers?.city || ''),
    description: answers?.description || '',
  };

  const [bookings, parcel] = await Promise.all([
    lookupBookings(intake),
    lookupParcel(intake, env, callGemini),
  ]);

  return {
    ok: true,
    searched: true,
    intake: { firstName: intake.firstName, lastName: intake.lastName, age: intake.age, zip: intake.zip },
    bookings,
    parcel,
    totalMatches: (bookings?.matchCount || 0) + (parcel?.parcels?.length || 0),
  };
}
