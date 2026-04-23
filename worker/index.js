import { lookupHillsboroughRecords } from './hillsborough-lookup.js';
import {
  lookupMilwaukeeRecords,
  shouldRunMilwaukeeLookup,
} from './milwaukee-lookup.js';
import {
  lookupOrangeFlRecords,
  shouldRunOrangeFlLookup,
} from './orange-fl-lookup.js';

const GEMINI_MODEL = 'gemini-2.5-pro';
const GEMINI_INTAKE_MODEL = 'gemini-2.5-flash';
// Claude fallback — used automatically when a Gemini request fails and
// ANTHROPIC_API_KEY is configured. Sonnet handles the same JSON-producing
// prompts well enough to keep the demo running if Gemini is down.
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 4096;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://joelngala.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
// Origins that can hit these routes without being in ALLOWED_ORIGINS.
// Intake routes are public because the form is meant to be embedded anywhere.
// /calendars/ingest is a machine-to-machine endpoint (GitHub Actions cron)
// protected by a Bearer token — it has no browser origin.
const PUBLIC_INTAKE_ROUTES = new Set(['/intake-chat', '/intake', '/calendars/ingest']);

// Single-tenant refresh token key — the firm deploys one worker per office.
const REFRESH_TOKEN_KEY = 'google:refresh_token';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    const isPublicIntake = PUBLIC_INTAKE_ROUTES.has(url.pathname);
    const allowedOrigin = isPublicIntake
      ? origin || '*'
      : getAllowedOrigin(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(allowedOrigin),
      });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(
        {
          ok: true,
          configured: Boolean(env.GEMINI_API_KEY) || Boolean(env.ANTHROPIC_API_KEY),
          gemini: Boolean(env.GEMINI_API_KEY),
          claude: Boolean(env.ANTHROPIC_API_KEY),
          stripe: Boolean(env.STRIPE_SECRET_KEY),
        },
        200,
        allowedOrigin
      );
    }

    // Read-only billing sync runs as GET and doesn't need GEMINI_API_KEY.
    if (request.method === 'GET' && url.pathname === '/billing/subscription') {
      if (!allowedOrigin) return jsonResponse({ error: 'Origin not allowed' }, 403, null);
      try {
        const result = await getBillingSubscription(env, url.searchParams);
        return jsonResponse(result, 200, allowedOrigin);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Billing sync failed';
        return jsonResponse({ error: message }, 500, allowedOrigin);
      }
    }

    if (!allowedOrigin) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, null);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, allowedOrigin);
    }

    // Billing endpoints are gated on STRIPE_SECRET_KEY, not GEMINI_API_KEY —
    // let them through even when the AI key isn't configured.
    if (url.pathname === '/billing/checkout' || url.pathname === '/billing/action') {
      try {
        const body = await request.json();
        if (url.pathname === '/billing/checkout') {
          const result = await createBillingCheckout(env, body);
          return jsonResponse(result, 200, allowedOrigin);
        }
        const result = await billingAction(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Billing request failed';
        return jsonResponse({ error: message }, 500, allowedOrigin);
      }
    }

    if (request.method === 'POST' && url.pathname === '/calendars/ingest') {
      try {
        const result = await ingestCalendars(request, env);
        return jsonResponse(result, 200, allowedOrigin);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Calendar ingest failed';
        const status = /unauthorized/i.test(message) ? 401 : 400;
        return jsonResponse({ error: message }, status, allowedOrigin);
      }
    }

    if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: 'No AI provider configured — set GEMINI_API_KEY or ANTHROPIC_API_KEY' },
        500,
        allowedOrigin
      );
    }

    try {
      const body = await request.json();

      if (url.pathname === '/intake-chat') {
        const result = await intakeChat(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/intake') {
        const result = await submitIntake(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/oauth/exchange') {
        const result = await oauthExchange(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/oauth/status') {
        const result = await oauthStatus(env);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/oauth/disconnect') {
        const result = await oauthDisconnect(env);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/analyze') {
        const result = await analyzeAppointment(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/slides-outline') {
        const result = await generateSlidesOutline(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/doc-outline') {
        const result = await generateDocOutline(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/draft') {
        const result = await generateDraft(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/estimate') {
        const result = await generateEstimate(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/refine-draft') {
        const result = await refineDraft(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/business-insights') {
        const result = await generateBusinessInsights(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/morning-brief') {
        const result = await generateMorningBrief(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/case-chat') {
        const result = await caseChatHandler(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/categorize-document') {
        const result = await categorizeDocument(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/summarize-document') {
        const result = await summarizeDocument(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/suggest-tasks') {
        const result = await suggestTasks(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/task-email') {
        const result = await generateTaskEmail(env, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/court-lookup') {
        const result = await handleCourtLookup(body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      return jsonResponse({ error: 'Not found' }, 404, allowedOrigin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected worker error';
      return jsonResponse({ error: message }, 500, allowedOrigin);
    }
  },
};

// --- CORS & Utility (same as SphericalAnalyzer) ---

function getAllowedOrigin(origin, allowedOriginsValue) {
  if (!origin) return null;

  const allowedOrigins = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(allowedOriginsValue || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ];

  return allowedOrigins.includes(origin) ? origin : null;
}

function buildCorsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(origin) },
  });
}

function stripJsonFences(text) {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

async function callGemini(env, model, body) {
  const geminiKey = env?.GEMINI_API_KEY;
  const claudeKey = env?.ANTHROPIC_API_KEY;

  if (geminiKey) {
    try {
      return await callGeminiDirect(geminiKey, model, body);
    } catch (error) {
      if (!claudeKey) throw error;
      console.warn(`[ai-fallback] Gemini failed (${error.message}) — falling back to Claude`);
      // Fall through to Claude. Surface Gemini's failure only if Claude also fails.
    }
  }

  if (claudeKey) {
    return await callClaude(claudeKey, body);
  }

  throw new Error('No AI provider configured');
}

async function callGeminiDirect(apiKey, model, body) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.status || 'Gemini request failed';
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

// Translate a Gemini-style body (contents + generationConfig) into an Anthropic
// Messages API call so every existing handler keeps its prompt shape and JSON-mode
// expectation — we just route to Claude when Gemini is unavailable.
async function callClaude(apiKey, body) {
  const rawContents = Array.isArray(body?.contents) ? body.contents : [];
  const messages = [];
  for (const entry of rawContents) {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    const content = (entry?.parts || [])
      .map((part) => part?.text || '')
      .join('')
      .trim();
    if (!content) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content += `\n\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }
  while (messages.length && messages[0].role !== 'user') {
    messages.shift();
  }
  if (messages.length === 0) {
    throw new Error('Claude request has no user content');
  }

  const wantsJson = body?.generationConfig?.responseMimeType === 'application/json';
  const temperature =
    typeof body?.generationConfig?.temperature === 'number'
      ? body.generationConfig.temperature
      : 0.3;

  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    temperature,
    messages,
  };
  if (wantsJson) {
    requestBody.system =
      'Respond with ONLY a valid JSON value matching the schema the user asked for. No markdown fences, no commentary, no text before or after the JSON.';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || 'Claude request failed';
    throw new Error(message);
  }

  const text = (payload?.content || [])
    .map((part) => part?.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Claude returned an empty response');
  return text;
}

// --- Handlers ---

async function analyzeAppointment(env, payload) {
  const { appointment, client, businessContext } = payload;

  const prompt = `You are an AI assistant for in-home service businesses. Analyze this upcoming appointment and client information, then suggest specific actions the business owner should take.

Appointment:
- Service: ${appointment?.summary || 'Unknown'}
- Date/Time: ${appointment?.start || 'Unknown'} to ${appointment?.end || 'Unknown'}
- Location: ${appointment?.location || 'Not specified'}
- Notes: ${appointment?.description || 'None'}

Client Information:
- Name: ${client?.name || 'Unknown'}
- Email: ${client?.email || 'Unknown'}
- Phone: ${client?.phone || 'Not on file'}
- Address: ${client?.address || 'Not on file'}
- Previous notes: ${client?.notes || 'None'}

Business context: ${businessContext || 'In-home service business'}

Return a JSON object with this exact structure:
{
  "clientSummary": "Brief summary of what we know about this client",
  "appointmentNotes": "Key things to prepare for this appointment",
  "prepChecklist": ["Item 1", "Item 2", "Item 3"],
  "suggestedActions": [
    {
      "id": "confirm",
      "type": "confirm",
      "label": "Send Confirmation",
      "description": "Why this action is recommended",
      "priority": "high"
    }
  ]
}

Valid action types: confirm, reminder, followup, estimate, contact, custom.
Valid priorities: high, medium, low.
Prioritize actions based on how soon the appointment is. Always suggest confirmation if not yet confirmed. Include specific, actionable advice based on the service type and client notes.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid analysis JSON');
  }
}

async function generateSlidesOutline(env, payload) {
  const { appointment, client, analysis, businessContext, feedback, caseContext } = payload || {};

  const prompt = `You are a helpful assistant that produces a Google Slides outline for a professional. The user could be in any profession — lawyer, realtor, therapist, consultant, contractor, teacher, founder, account manager, etc. Do not assume any industry.

YOUR JOB: figure out what KIND of deck best serves the goal, then produce it.

Common deck types to pick from (but use judgment — these aren't the only options):
- Pitch / proposal deck — problem → solution → pricing → call to action
- Client-facing update / status deck — progress, blockers, next steps
- Agenda / kickoff deck — what we'll cover, who owns what
- Teaching / explainer deck — concept breakdown with examples
- Recommendation / options deck — situation, options, pick, rationale
- Recap / debrief deck — what happened, what we learned, what's next
- Workshop deck — sectioned exercises or discussion prompts

Decide the type from:
1. The user's stated goal / revision request (HIGHEST PRIORITY if present)
2. The appointment summary and notes
3. Any uploaded documents

OUTPUT CONTRACT — return ONLY this JSON:
{
  "title": "Deck title — specific to this presentation (file-name-friendly)",
  "subtitle": "One-line thesis / what this deck is for",
  "slides": [
    {
      "title": "Slide headline — ideally a takeaway, not a topic label",
      "bullets": ["Concrete point (≤20 words)", "..."],
      "speakerNotes": "2–4 sentence talk track for the presenter. Substantive, not a restatement of bullets."
    }
  ]
}

STRUCTURAL REQUIREMENTS:
- 4–8 slides, shaped by the deck type. A quick update might be 4; a pitch might be 7–8.
- The slide order and headings should fit the chosen deck type, not a generic strategy-consulting template.
- Title slide first, then body slides, then a clear closing (next steps / call to action / Q&A — whatever fits).
- Each bullet ≤20 words, concrete, ideally numeric or named.
- Speaker notes are the presenter's script — what to emphasize and why.

GROUNDING:
- Appointment matter: ${appointment?.summary || 'Consultation'}
- Date/Time: ${appointment?.start || 'Unknown'} → ${appointment?.end || 'Unknown'}
- Location: ${appointment?.location || 'Not specified'}
- Event notes: ${appointment?.description || 'None'}

Client / audience:
- Name: ${client?.name || 'Client'}
- Organization: ${client?.organization || 'N/A'}
- Email: ${client?.email || 'N/A'}
- Phone: ${client?.phone || 'N/A'}
- Address: ${client?.address || 'N/A'}
- Notes: ${client?.notes || 'None'}

AI analysis (may be empty):
- Client summary: ${analysis?.clientSummary || 'None'}
- Appointment notes: ${analysis?.appointmentNotes || 'None'}
- Prep checklist: ${(analysis?.prepChecklist || []).join(' | ') || 'None'}

Task list (what the user is working on):
${formatTasks(caseContext?.tasks)}

Uploaded documents — ground content in these where relevant:
${formatDocuments(caseContext?.documents)}

Business context:
${businessContext || 'Not provided'}

User goal / revision request (THIS DRIVES THE DECK TYPE if present):
${feedback || 'No specific goal — produce a general prep/briefing deck for the appointment.'}

STYLE GUARDRAILS:
- Never invent specifics. If a number, date, or party name is not in the source, omit it or flag "[to be confirmed]".
- Match the tone to the deck type (persuasive for pitches, neutral for updates, didactic for teaching).
- No markdown, no emojis, no prose outside the JSON object.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, responseMimeType: 'application/json' },
  });

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid slides outline JSON');
  }

  const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const normalizedSlides = slides
    .slice(0, 8)
    .map((slide, index) => ({
      title: String(slide?.title || `Slide ${index + 1}`).slice(0, 160),
      bullets: Array.isArray(slide?.bullets)
        ? slide.bullets
            .map((b) => String(b).trim())
            .filter(Boolean)
            .slice(0, 6)
        : [],
      speakerNotes: slide?.speakerNotes ? String(slide.speakerNotes).trim().slice(0, 1200) : '',
    }))
    .filter((slide) => slide.title || slide.bullets.length > 0);

  if (normalizedSlides.length === 0) {
    const fallbackTitle = appointment?.summary || 'Client Presentation';
    return {
      title: fallbackTitle,
      subtitle: `Prepared for ${client?.name || 'Client'}`,
      slides: [
        {
          title: 'Matter Overview',
          bullets: [
            appointment?.summary || 'Consultation details',
            appointment?.description || 'No additional notes provided',
            `Client: ${client?.name || 'Client'}`,
          ],
        },
        {
          title: 'Recommended Next Steps',
          bullets: [
            'Confirm goals, timeline, and communication cadence',
            'Collect missing documents and supporting facts',
            'Prepare follow-up summary and action checklist',
          ],
        },
      ],
    };
  }

  return {
    title: String(parsed?.title || appointment?.summary || 'Client Presentation').slice(0, 180),
    subtitle: String(parsed?.subtitle || `Prepared for ${client?.name || 'Client'}`).slice(0, 180),
    slides: normalizedSlides,
  };
}

async function generateDocOutline(env, payload) {
  const { appointment, client, analysis, businessContext, feedback, caseContext } = payload || {};

  const prompt = `You are a helpful assistant that writes a Google Doc for a professional to use for a specific appointment and goal. The user could be in any profession — lawyer, realtor, therapist, consultant, contractor, teacher, founder, account manager, etc. Do not assume any industry.

YOUR JOB: figure out what KIND of document best serves the goal, then produce it.

Common document types to pick from (but you are not limited to these — use judgment):
- Contract / agreement — paragraph clauses, parties, scope, terms, signatures placeholder
- Meeting notes / recap — attendees, topics, decisions, action items
- Agenda — timed sections with topics and owners
- Proposal / statement of work — scope, deliverables, timeline, pricing
- Letter — salutation, body paragraphs, closing
- Memo / briefing — summary, background, analysis, recommendation
- Plan / outline — objectives, steps, owners, dates
- Script / talking points — ordered speaking notes
- Checklist — actionable items grouped by phase
- Questionnaire / intake form — grouped questions
- Brief — executive summary + supporting sections

Decide the type from:
1. The user's stated goal / revision request (HIGHEST PRIORITY if present)
2. The appointment summary and notes
3. Any uploaded case documents

OUTPUT CONTRACT — return ONLY this JSON:
{
  "title": "File-name-friendly title specific to this document (what you'd call it in Drive)",
  "subtitle": "One-line description of what this document is for",
  "executiveSummary": "Optional 2–4 sentence opener. For docs where it doesn't fit (e.g. an agenda, checklist, contract), return an empty string.",
  "sections": [
    {
      "heading": "Section heading",
      "bullets": ["Body content for this section. Each entry may be a short bullet OR a full paragraph, whichever fits the document type. For a contract, these are clauses/paragraphs. For an agenda, these are timed items. For notes, these are decisions or discussion points."]
    }
  ]
}

STRUCTURAL REQUIREMENTS:
- 3–8 sections total, shaped by the document type (a short letter might be 2–3 sections; a full contract might be 6–8).
- Section headings must fit the chosen document type, not a generic brief template.
- Each entry in "bullets" should carry real information. No filler.
- Ground specifics (names, dates, dollar figures, addresses) in the appointment notes and uploaded documents. If something isn't in the sources, omit it or use a placeholder like "[to be confirmed]".

GROUNDING:
- Matter: ${appointment?.summary || 'Consultation'}
- Date/Time: ${appointment?.start || 'Unknown'} → ${appointment?.end || 'Unknown'}
- Location: ${appointment?.location || 'Not specified'}
- Event notes: ${appointment?.description || 'None'}

Client / counterparty:
- Name: ${client?.name || 'Client'}
- Organization: ${client?.organization || 'N/A'}
- Email: ${client?.email || 'N/A'}
- Phone: ${client?.phone || 'N/A'}
- Address: ${client?.address || 'N/A'}
- Notes: ${client?.notes || 'None'}

AI analysis (may be empty):
- Client summary: ${analysis?.clientSummary || 'None'}
- Appointment notes: ${analysis?.appointmentNotes || 'None'}
- Prep checklist: ${(analysis?.prepChecklist || []).join(' | ') || 'None'}

Task list (what the user is working on):
${formatTasks(caseContext?.tasks)}

Uploaded documents — ground the content in these where relevant:
${formatDocuments(caseContext?.documents)}

Business context:
${businessContext || 'Not provided'}

User goal / revision request (THIS DRIVES THE DOCUMENT TYPE if present):
${feedback || 'No specific goal — produce a general prep/briefing document for the appointment.'}

STYLE GUARDRAILS:
- Never fabricate specifics. If a number, date, or party name is not in the source, omit it or label "[to be confirmed]".
- Match the tone to the document type (formal for contracts, neutral for notes, warm for letters).
- No markdown, no emojis, no text outside the JSON object.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid doc outline JSON');
  }

  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const normalizedSections = sections
    .slice(0, 8)
    .map((section, index) => ({
      heading: String(section?.heading || `Section ${index + 1}`).slice(0, 120),
      bullets: Array.isArray(section?.bullets)
        ? section.bullets
            .map((b) => String(b).trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
    }))
    .filter((section) => section.bullets.length > 0);

  if (normalizedSections.length === 0) {
    return {
      title: String(appointment?.summary || 'Case Notes').slice(0, 180),
      subtitle: `Prepared for ${client?.name || 'Client'}`,
      sections: [
        {
          heading: 'Matter Overview',
          bullets: [
            appointment?.summary || 'Consultation details',
            appointment?.description || 'No additional notes provided',
            `Client: ${client?.name || 'Client'}`,
          ],
        },
        {
          heading: 'Next Steps',
          bullets: [
            'Confirm facts, objectives, and timeline',
            'Collect missing documents and supporting records',
            'Send follow-up summary with action items',
          ],
        },
      ],
    };
  }

  return {
    title: String(parsed?.title || appointment?.summary || 'Case Notes').slice(0, 180),
    subtitle: String(parsed?.subtitle || `Prepared for ${client?.name || 'Client'}`).slice(0, 220),
    executiveSummary: parsed?.executiveSummary ? String(parsed.executiveSummary).trim().slice(0, 1500) : '',
    sections: normalizedSections,
  };
}

function formatTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'None';
  return tasks
    .slice(0, 40)
    .map((t) => `- [${t.done ? 'x' : ' '}] ${String(t.label || '').slice(0, 200)}`)
    .join('\n');
}

function formatDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) return 'None uploaded yet — rely on appointment notes and analysis.';
  return documents
    .slice(0, 10)
    .map((d, i) => {
      const excerpt = String(d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      return `Doc ${i + 1}: "${d.name || 'Untitled'}" (category: ${d.category || 'other'})\n  Excerpt: ${excerpt || '(no text extracted)'}`;
    })
    .join('\n\n');
}

async function generateDraft(env, payload) {
  const { type, appointment, client, preferences } = payload;

  const typeInstructions = {
    confirmation:
      'Draft a confirmation email. Confirm the date, time, service, and location. Ask the client to reply if any changes are needed. Be warm and professional.',
    reminder:
      'Draft a reminder email for an appointment happening soon. Keep it brief and friendly. Include the key details: date, time, service, location.',
    followup:
      'Draft a follow-up email sent after the service was completed. Thank the client, ask if everything met their expectations, invite them to leave a review, and mention rebooking.',
  };

  const prompt = `You are a professional email assistant for an in-home service business.

Business: ${preferences?.businessName || 'Our Company'}
Sender: ${preferences?.senderName || 'Business owner'}
Preferred tone: ${preferences?.writingTone || 'Warm and professional'}
Client: ${client?.name || 'Valued Client'} (${client?.email || ''})
Service: ${appointment?.summary || 'Service appointment'}
Date: ${appointment?.start || 'Upcoming'}
Location: ${appointment?.location || ''}

${typeInstructions[type] || typeInstructions.confirmation}
General email instructions: ${preferences?.generalInstructions || 'None'}
Type-specific instructions: ${
    type === 'confirmation'
      ? preferences?.confirmationInstructions || 'None'
      : type === 'reminder'
        ? preferences?.reminderInstructions || 'None'
        : preferences?.followupInstructions || 'None'
  }
Default signature: ${preferences?.signature || preferences?.senderName || preferences?.businessName || 'Our Company'}

Return a JSON object:
{
  "subject": "Email subject line",
  "body": "Full email body text. Use plain text, no HTML. Be professional yet friendly. Sign off with the business name."
}`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid draft JSON');
  }
}

async function generateTaskEmail(env, payload) {
  const { taskGoal, appointment, client, preferences } = payload || {};

  const prompt = `You are a helpful assistant drafting a professional email on behalf of the user. The user could be in any profession — lawyer, realtor, therapist, consultant, contractor, teacher, founder, account manager, etc. Do not assume any industry.

YOUR JOB: read the task goal and the appointment context, then produce a complete, ready-to-send email.

Task goal (what the user is trying to accomplish with this email):
"${taskGoal || 'Send a professional email related to this appointment'}"

Appointment context:
- Title: ${appointment?.summary || 'Appointment'}
- Date/Time: ${appointment?.start || 'Upcoming'} → ${appointment?.end || ''}
- Location: ${appointment?.location || 'Not specified'}
- Notes: ${appointment?.description || 'None'}

Recipient:
- Name: ${client?.name || 'the recipient'}
- Email: ${client?.email || ''}

Sender preferences:
- Business/org name: ${preferences?.businessName || '(none provided)'}
- Sender name: ${preferences?.senderName || '(none provided)'}
- Preferred tone: ${preferences?.writingTone || 'Warm and professional'}
- General email instructions: ${preferences?.generalInstructions || 'None'}
- Default signature: ${preferences?.signature || preferences?.senderName || preferences?.businessName || '(none)'}

GUIDELINES:
- Infer the email TYPE from the task goal (confirmation, follow-up, request for info, scheduling, proposal cover, introduction, thank-you, contract delivery, invoice, etc.).
- Keep the subject line specific and under 80 characters.
- Body should be plain text (no HTML, no markdown), friendly but appropriate to the task type.
- Include a clear call to action or ask when relevant.
- If the task implies attachments that aren't yet in context, reference them generically ("please find the attached proposal") rather than inventing specifics.
- Do not fabricate dates, dollar figures, or names that aren't in the appointment/client context — use placeholders like [to be confirmed] instead.
- Sign off with the sender name or business name above (use the signature verbatim if provided).

Return ONLY a JSON object:
{
  "subject": "Email subject line",
  "body": "Full email body text."
}`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid task email JSON');
  }
}

async function generateEstimate(env, payload) {
  const { serviceType, details, client } = payload;

  const prompt = `You are a professional estimator for an in-home service business.

Service requested: ${serviceType || 'General service'}
Details: ${details || 'Standard service'}
Client: ${client?.name || 'Client'}
Location: ${client?.address || 'Not specified'}

Generate a professional service estimate. Return a JSON object:
{
  "estimateText": "A formatted plain-text estimate suitable for emailing",
  "lineItems": [
    { "item": "Description of service", "price": "$XX-XX" }
  ],
  "total": "$XX-XX",
  "notes": "Any disclaimers or notes about the estimate"
}

Use realistic price ranges for the service type. Include a disclaimer that final pricing may vary based on actual conditions.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid estimate JSON');
  }
}

async function refineDraft(env, payload) {
  const { instruction, draft, appointment, client, preferences } = payload;

  const prompt = `You are a professional email assistant for an in-home service business.

Revise the draft below based on the user's refinement request. Preserve factual appointment details unless the user explicitly asks to change them. Keep the output plain text and ready to send.

Refinement request:
${instruction || 'Improve the draft'}

Appointment context:
- Service: ${appointment?.summary || 'Service appointment'}
- Date: ${appointment?.start || 'Upcoming'}
- Location: ${appointment?.location || ''}

Client:
- Name: ${client?.name || 'Valued Client'}
- Email: ${client?.email || draft?.to || ''}

Saved email preferences:
- Business: ${preferences?.businessName || 'Our Company'}
- Sender: ${preferences?.senderName || 'Business owner'}
- Tone: ${preferences?.writingTone || 'Warm and professional'}
- General instructions: ${preferences?.generalInstructions || 'None'}
- Signature: ${preferences?.signature || 'Use the business name'}

Current draft subject:
${draft?.subject || ''}

Current draft body:
${draft?.body || ''}

Return a JSON object:
{
  "subject": "Updated subject line",
  "body": "Updated plain-text email body"
}`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid refined draft JSON');
  }
}

async function generateBusinessInsights(env, payload) {
  const { events, preferences } = payload;

  const prompt = `You are an AI chief of staff for a small service business. Review the upcoming calendar activity and produce concise business patterns, operational risks, and recommended automations.

Business profile:
- Business type: ${preferences?.businessType || 'Small service business'}
- Business name: ${preferences?.businessName || 'The business'}
- Service areas: ${preferences?.serviceAreas || 'Not specified'}
- Working hours: ${preferences?.workingHours || 'Not specified'}
- Lead goals: ${preferences?.leadGoals || 'Not specified'}
- Repeat business goals: ${preferences?.repeatBusinessGoals || 'Not specified'}
- No-show policy: ${preferences?.noShowPolicy || 'Not specified'}
- Estimate policy: ${preferences?.estimatePolicy || 'Not specified'}
- Review link available: ${preferences?.reviewLink ? 'Yes' : 'No'}

Upcoming schedule:
${(events || []).map((event, index) => `${index + 1}. ${event.summary} | ${event.start} | ${event.location || 'No location'} | attendee emails: ${(event.attendees || []).map((a) => a.email).join(', ') || 'none'} | notes: ${event.description || 'none'}`).join('\n')}

Return a JSON object:
{
  "overview": "2-3 sentence executive summary",
  "patterns": [
    {
      "title": "Short pattern label",
      "insight": "What you noticed and why it matters",
      "impact": "growth"
    }
  ],
  "recommendedAutomations": ["Automation idea 1", "Automation idea 2"],
  "opportunities": ["Actionable growth or retention opportunity 1", "Opportunity 2"]
}

Valid impact values: growth, risk, ops.
Keep the response practical and tied to small business outcomes.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid business insights JSON');
  }
}

async function generateMorningBrief(env, payload) {
  const { events, preferences } = payload;

  const prompt = `You are an AI operations chief of staff. Create a morning brief for today's schedule for the business owner.

Business profile:
- Business type: ${preferences?.businessType || 'Small service business'}
- Business name: ${preferences?.businessName || 'The business'}
- Working hours: ${preferences?.workingHours || 'Not specified'}
- Lead goals: ${preferences?.leadGoals || 'Not specified'}
- Repeat business goals: ${preferences?.repeatBusinessGoals || 'Not specified'}
- No-show policy: ${preferences?.noShowPolicy || 'Not specified'}
- Estimate policy: ${preferences?.estimatePolicy || 'Not specified'}

Today's schedule:
${(events || []).map((event, index) => `${index + 1}. ${event.summary} | ${event.start} | ${event.location || 'No location'} | attendee emails: ${(event.attendees || []).map((a) => a.email).join(', ') || 'none'} | notes: ${event.description || 'none'}`).join('\n')}

Return a JSON object:
{
  "headline": "Short one-line brief",
  "summary": "2-3 sentence daily summary",
  "priorities": ["Priority 1", "Priority 2"],
  "risks": ["Risk 1", "Risk 2"],
  "suggestedFocus": "A short focus recommendation for the owner"
}

Be specific, operational, and concise.`;

  const text = await callGemini(env, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid morning brief JSON');
  }
}

// --- Legal intake chatbot ---

const INTAKE_REQUIRED_FIELDS = [
  'fullName',
  'phone',
  'email',
  'matterType',
  'description',
  'jurisdictionState',
  'urgent',
  'preferredTimes',
];

const INTAKE_CONTACT_PRIORITY_FIELDS = ['fullName', 'phone', 'email'];

async function intakeChat(env, payload) {
  const { messages = [], answers = {}, firmName = 'the firm' } = payload || {};

  const transcript = messages
    .map((m) => `${m.role === 'bot' ? 'Assistant' : 'Client'}: ${m.text}`)
    .join('\n');

  const answersJson = JSON.stringify(answers, null, 2);
  const missing = INTAKE_REQUIRED_FIELDS.filter((f) => {
    const v = answers?.[f];
    return v === undefined || v === null || v === '';
  });
  const contactMissing = INTAKE_CONTACT_PRIORITY_FIELDS.filter((f) => {
    const v = answers?.[f];
    return v === undefined || v === null || v === '';
  });

  const systemPrompt = `You are a warm, professional legal intake assistant for ${firmName}. Your job is to collect enough information from a prospective client so the attorney can evaluate the matter and schedule a free consultation.

CRITICAL RULES:
- You are NOT an attorney. Never give legal advice, opinions on the merits of the case, likelihood of success, or dollar estimates.
- If the client asks for advice, politely say the attorney will discuss it during the consultation.
- Be warm and empathetic, especially for sensitive matters (family, criminal, domestic violence, immigration enforcement).
- Ask ONE question at a time. Keep replies short — 1-3 sentences. Sound human, not like a form.
- Keep the conversation efficient and client-friendly. Aim to complete intake in ~6-8 questions total.
- Start with contact recovery first. Until fullName, phone, and email are all captured, ask ONLY for the next missing field in this exact order: fullName, then phone, then email. Mention this is so the firm can follow up if chat disconnects.
- Adapt follow-ups to the matter type. For a PI case, ask about the incident date and injuries. For family, ask whether anything has been filed. For criminal, ask what stage they're at.
- If the client mentions urgency (hearing, arrest, restraining order, hard deadline), set urgent="yes" and probe briefly for the deadline.
- When extracting the matterType field, use one of: family, criminal, personal-injury, immigration, estate, business, employment, other.
- When extracting urgent, use "yes" or "no".
- Do NOT ask about optional fields unless naturally useful.
- If the client gives a vague answer, ask a gentle follow-up before moving on.
- You may offer quick-reply chips for common-answer questions (matter type, urgency yes/no, contact method, how they heard about us). For free-text questions (description, name, phone), return an empty quickReplies array.

TONE & LANGUAGE:
- NEVER start two consecutive replies with the same phrase. Vary your acknowledgments — use the client's name sometimes, a brief empathetic remark other times, or jump straight to the next question. Avoid "Thank you for sharing that" more than once in the entire conversation.
- Match the client's energy. If they give short answers, keep your replies equally concise. If they share a lot, acknowledge it briefly before moving on.
- When the matter is serious (arrest, custody, protection order), lead with empathy first ("That sounds stressful — let's get you connected with someone who can help.") rather than a generic thank-you.
- Use the client's first name occasionally (not every message) to keep it personal without sounding robotic.

REQUIRED FIELDS (you must collect ALL of these before setting done=true):
${INTAKE_REQUIRED_FIELDS.map((f) => `- ${f}`).join('\n')}

OPTIONAL (nice to have, ask only if naturally relevant):
- matterDetail: subtype of the matter (e.g., "divorce", "car accident")
- opposingParty: name of the other side (if applicable)
- urgencyReason: what the deadline is (only if urgent="yes")

CURRENT STATE OF COLLECTED ANSWERS:
${answersJson}

STILL MISSING: ${missing.length ? missing.join(', ') : '(none — you can wrap up)'}
CONTACT PRIORITY MISSING: ${contactMissing.length ? contactMissing.join(', ') : '(none)'}

CONVERSATION SO FAR:
${transcript || '(no messages yet — this is your opening message)'}

OUTPUT INSTRUCTIONS:
Return a JSON object with EXACTLY this shape:
{
  "reply": "Your next message to the client. Warm, short, one question at a time. If this is the first message (no conversation yet), greet them and ask for their full name first for reconnect safety.",
  "quickReplies": ["optional", "array", "of", "suggested", "replies"],
  "updatedAnswers": { ...full answers object with any new info extracted from the most recent client message merged in. Preserve existing values unless the client corrected them. },
  "done": false,
  "summary": "(only when done=true) A 2-3 sentence attorney handoff summary including matter, urgency/deadline, and immediate follow-up recommendation."
}

Set done=true ONLY when every required field has a non-empty value. When done=true, the reply should be a brief acknowledgment like "Thanks, I've got everything I need. Let me recap…" followed by a short recap, and include the summary field.`;

  const text = await callGemini(env, GEMINI_INTAKE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
  });

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid intake JSON');
  }

  // Safety: normalize and ensure we always return a well-formed response
  const updatedAnswers = { ...answers, ...(parsed.updatedAnswers || {}) };
  // Normalize key contact fields.
  updatedAnswers.fullName = String(updatedAnswers.fullName || '').trim();
  updatedAnswers.phone = String(updatedAnswers.phone || '').trim();
  updatedAnswers.email = String(updatedAnswers.email || '').trim();

  // Enforce server-side truth about done: only done if every required field is filled
  const stillMissing = INTAKE_REQUIRED_FIELDS.filter((f) => {
    const v = updatedAnswers?.[f];
    return v === undefined || v === null || v === '';
  });
  const stillMissingContact = INTAKE_CONTACT_PRIORITY_FIELDS.filter((f) => {
    const v = updatedAnswers?.[f];
    return v === undefined || v === null || v === '';
  });
  const serverDone = stillMissing.length === 0 && parsed.done === true;
  const firstName = (updatedAnswers.fullName || '').trim().split(/\s+/)[0] || 'there';

  let forcedReply = '';
  if (stillMissingContact.length > 0) {
    const nextContactField = stillMissingContact[0];
    if (nextContactField === 'fullName') {
      forcedReply =
        'Welcome. Before we begin, if this chat disconnects we want to be able to follow up quickly. What is your full name?';
    } else if (nextContactField === 'phone') {
      forcedReply = `Thank you, ${firstName}. What is the best phone number to reach you if we get disconnected?`;
    } else if (nextContactField === 'email') {
      forcedReply = 'Great, and what is the best email address for follow-up?';
    }
  }

  return {
    reply: forcedReply || parsed.reply || 'Sorry, could you say that again?',
    quickReplies: forcedReply ? [] : Array.isArray(parsed.quickReplies) ? parsed.quickReplies : [],
    updatedAnswers,
    done: serverDone,
    summary: serverDone ? parsed.summary || '' : '',
  };
}

async function submitIntake(env, payload) {
  const { answers, transcript, summary, firmId } = payload || {};

  if (!answers || !answers.fullName || !answers.email) {
    throw new Error('Intake is missing required fields');
  }

  if (!env.INTAKE_STORE) {
    throw new Error('INTAKE_STORE KV namespace is not bound — run wrangler kv namespace create INTAKE_STORE');
  }

  const refreshToken = await env.INTAKE_STORE.get(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    throw new Error(
      'Intake is not connected to a calendar yet. The firm owner needs to click "Connect intake to calendar" in the dashboard.'
    );
  }

  let accessToken;
  try {
    accessToken = await exchangeRefreshToken(env, refreshToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (isInvalidRefreshTokenError(message)) {
      await env.INTAKE_STORE.delete(REFRESH_TOKEN_KEY);
      throw new Error(
        'Google Calendar connection expired. Click "Reconnect" in the dashboard to continue receiving intake events.'
      );
    }
    throw error;
  }

  // Run contact conflict check, Perplexity research, and Hillsborough
  // court-records lookup in parallel. The court lookup only fires for
  // Florida/Hillsborough criminal matters; elsewhere it resolves to null.
  const courtLookupPromise = shouldRunHillsboroughLookup(answers)
    ? lookupHillsboroughRecords(answers).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : Promise.resolve(null);

  const upcomingHearingsPromise = shouldRunHillsboroughLookup(answers)
    ? lookupUpcomingHillsboroughHearings(env, answers).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : Promise.resolve(null);

  const milwaukeeLookupPromise = shouldRunMilwaukeeLookup(answers)
    ? lookupMilwaukeeRecords(env, answers, { callGemini }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : Promise.resolve(null);

  const orangeFlLookupPromise = shouldRunOrangeFlLookup(answers)
    ? lookupOrangeFlRecords(env, answers, { callGemini }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    : Promise.resolve(null);

  const [conflictHit, research, courtLookup, upcomingHearings, milwaukeeLookup, orangeFlLookup] =
    await Promise.all([
      checkContactConflict(accessToken, answers.opposingParty),
      researchCase(env.PERPLEXITY_API_KEY, answers),
      courtLookupPromise,
      upcomingHearingsPromise,
      milwaukeeLookupPromise,
      orangeFlLookupPromise,
    ]);

  const event = buildCalendarEventPayload({
    answers,
    transcript,
    summary,
    firmId,
    conflictHit,
    research,
    courtLookup,
    upcomingHearings,
    milwaukeeLookup,
    orangeFlLookup,
  });

  const calendarResponse = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!calendarResponse.ok) {
    const errorPayload = await calendarResponse.json().catch(() => null);
    const message = errorPayload?.error?.message || `Calendar API failed (${calendarResponse.status})`;
    throw new Error(message);
  }

  const createdEvent = await calendarResponse.json();

  // Best-effort matter folder provisioning. Drive failures (missing scope,
  // quota, transient 5xx) must not fail the intake — surface the error so
  // the dashboard can prompt the lawyer to reconnect if needed.
  let matterFolder = null;
  let matterFolderError = null;
  try {
    matterFolder = await ensureMatterFolderInDrive(accessToken, {
      clientName: answers.fullName,
      caseNumber: answers.caseNumber,
      matterCode: answers.matterType,
    });
  } catch (error) {
    matterFolderError = error instanceof Error ? error.message : String(error);
  }

  // Best-effort: push Milwaukee portal matches to the Case Database sheet.
  // A Sheets failure must never block intake — the matches are already in
  // the calendar event description as the primary surface.
  let milwaukeeSheetSync = null;
  let milwaukeeSheetError = null;
  if (milwaukeeLookup?.ok && (milwaukeeLookup.totalMatches > 0 || milwaukeeLookup.fpcContext?.ok)) {
    try {
      milwaukeeSheetSync = await syncMilwaukeeLookupToSheet({
        env,
        accessToken,
        eventId: createdEvent.id,
        clientName: answers.fullName,
        lookup: milwaukeeLookup,
      });
    } catch (error) {
      milwaukeeSheetError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: true,
    eventId: createdEvent.id,
    eventLink: createdEvent.htmlLink,
    urgent: answers?.urgent === 'yes',
    conflictFlagged: Boolean(conflictHit),
    researchFound: Boolean(research?.text),
    courtMatches: courtLookup?.ok ? courtLookup.matchCount || 0 : 0,
    upcomingHearingMatches: upcomingHearings?.ok ? upcomingHearings.matchCount || 0 : 0,
    milwaukeeMatches: milwaukeeLookup?.ok ? milwaukeeLookup.totalMatches || 0 : 0,
    milwaukeeSheetSynced: Boolean(milwaukeeSheetSync?.synced),
    milwaukeeSheetError,
    orangeFlBookingMatches: orangeFlLookup?.ok ? orangeFlLookup.bookings?.matchCount || 0 : 0,
    orangeFlParcelHits: orangeFlLookup?.ok ? orangeFlLookup.parcel?.parcels?.length || 0 : 0,
    matterFolderId: matterFolder?.id || null,
    matterFolderUrl: matterFolder?.url || null,
    matterFolderError,
    receivedAt: new Date().toISOString(),
  };
}

// --- Drive matter folder provisioning ---
// Mirrors src/lib/docs.ts so folder names stay aligned between the intake
// submission path (here) and the dashboard's on-demand folder creation.
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_ROOT_FOLDER_NAME = 'Spherical Assistant';

function slugifyMatterPart(input) {
  return (input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function deriveMatterCaseToken(caseNumber, matterCode) {
  const explicit = slugifyMatterPart(matterCode || '');
  if (explicit) return explicit.slice(0, 12);
  const raw = (caseNumber || '').toLowerCase();
  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const alphaTokens = tokens.filter((token) => /[a-z]/.test(token) && token.length <= 12);
  if (alphaTokens.length > 0) {
    return [...alphaTokens].sort((a, b) => b.length - a.length)[0];
  }
  return 'gen';
}

function buildMatterFolderName(clientName, caseNumber, matterCode) {
  const clientSlug = slugifyMatterPart(clientName || '') || 'unknown-client';
  const caseToken = deriveMatterCaseToken(caseNumber, matterCode);
  return `${clientSlug}-case-${caseToken}`;
}

function buildLegacyMatterFolderName(clientName, caseNumber) {
  const client = (clientName || 'Unknown Client').trim().replace(/[\\/:*?"<>|]/g, '-');
  const caseRef = (caseNumber || '').trim().replace(/[\\/:*?"<>|]/g, '-');
  return caseRef ? `${client} — ${caseRef}` : client;
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFetch(accessToken, path, init) {
  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google Drive error: ${response.status}`);
  }
  return response.json();
}

async function findDriveFolderByName(accessToken, name, parentId) {
  const parentClause = parentId ? ` and '${escapeDriveQuery(parentId)}' in parents` : '';
  const q = `name = '${escapeDriveQuery(name)}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  const file = Array.isArray(data?.files) && data.files[0];
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    url: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
  };
}

async function createDriveFolder(accessToken, name, parentId) {
  const body = { name, mimeType: DRIVE_FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const data = await driveFetch(accessToken, '/files?fields=id,name,webViewLink', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    id: data.id,
    name: data.name,
    url: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
  };
}

async function ensureDriveFolder(accessToken, name, parentId) {
  const existing = await findDriveFolderByName(accessToken, name, parentId);
  if (existing) return existing;
  return createDriveFolder(accessToken, name, parentId);
}

async function ensureMatterFolderInDrive(accessToken, { clientName, caseNumber, matterCode }) {
  const root = await ensureDriveFolder(accessToken, DRIVE_ROOT_FOLDER_NAME);
  const canonical = buildMatterFolderName(clientName, caseNumber, matterCode);

  const existingCanonical = await findDriveFolderByName(accessToken, canonical, root.id);
  if (existingCanonical) return existingCanonical;

  const legacy = buildLegacyMatterFolderName(clientName, caseNumber);
  const existingLegacy = await findDriveFolderByName(accessToken, legacy, root.id);
  if (existingLegacy) return existingLegacy;

  return ensureDriveFolder(accessToken, canonical, root.id);
}

// --- Case Database sheet sync ---
// The dashboard creates a "Case Database" spreadsheet in the Drive root
// folder (see src/lib/caseSheet.ts). The worker writes to it directly so
// portal-lookup results (Milwaukee, future jurisdictions) land in the same
// backend-of-record the lawyer already uses. Uses the `drive.file` scope,
// which grants Sheets access to files the app created — no extra scope.

const CASE_SHEET_NAME = 'Case Database';
const MILWAUKEE_TAB = 'Milwaukee Intel';
const MILWAUKEE_TAB_HEADERS = [
  'LookupRun',
  'EventID',
  'Client',
  'Source',
  'RecordID',
  'Date',
  'Location',
  'ZIP',
  'Detail',
  'Score',
  'Confidence',
  'Reasons',
];
const CASE_SHEET_ID_KEY = 'google:case_sheet_id';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsFetch(accessToken, path, init) {
  const response = await fetch(`${SHEETS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Sheets API ${response.status}`);
  }
  return response.json();
}

async function findCaseSpreadsheet(accessToken) {
  const root = await findDriveFolderByName(accessToken, DRIVE_ROOT_FOLDER_NAME);
  if (!root) return null;
  const q = `name = '${escapeDriveQuery(CASE_SHEET_NAME)}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and '${escapeDriveQuery(root.id)}' in parents`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });
  const data = await driveFetch(accessToken, `/files?${params.toString()}`);
  const file = Array.isArray(data?.files) && data.files[0];
  if (!file) return null;
  return { id: file.id, url: file.webViewLink };
}

async function resolveCaseSpreadsheetId(env, accessToken) {
  if (env.INTAKE_STORE) {
    const cached = await env.INTAKE_STORE.get(CASE_SHEET_ID_KEY);
    if (cached) {
      try {
        await sheetsFetch(accessToken, `/${cached}?fields=spreadsheetId`);
        return cached;
      } catch {
        // Cached ID is no longer accessible (sheet deleted, permission
        // revoked). Drop and rediscover.
        await env.INTAKE_STORE.delete(CASE_SHEET_ID_KEY);
      }
    }
  }
  const found = await findCaseSpreadsheet(accessToken);
  if (!found) return null;
  if (env.INTAKE_STORE) {
    await env.INTAKE_STORE.put(CASE_SHEET_ID_KEY, found.id);
  }
  return found.id;
}

async function ensureMilwaukeeTab(accessToken, spreadsheetId) {
  const meta = await sheetsFetch(
    accessToken,
    `/${spreadsheetId}?fields=sheets(properties(title))`
  );
  const titles = new Set(
    (meta.sheets || []).map((s) => s?.properties?.title).filter(Boolean)
  );
  if (!titles.has(MILWAUKEE_TAB)) {
    await sheetsFetch(accessToken, `/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: MILWAUKEE_TAB } } }],
      }),
    });
  }
  // Idempotent header write — overwrites row 1 each run so a hand-edited
  // sheet repairs itself on the next intake.
  await sheetsFetch(accessToken, `/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [{ range: `${MILWAUKEE_TAB}!A1:L1`, values: [MILWAUKEE_TAB_HEADERS] }],
    }),
  });
}

async function appendMilwaukeeRows(accessToken, spreadsheetId, rows) {
  if (!rows.length) return;
  const range = encodeURIComponent(`${MILWAUKEE_TAB}!A:A`);
  await sheetsFetch(
    accessToken,
    `/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    }
  );
}

function buildMilwaukeeSheetRows({ eventId, clientName, lookup }) {
  const lookupRun = new Date().toISOString();
  const rows = [];

  for (const m of lookup?.wibr?.matches || []) {
    rows.push([
      lookupRun,
      eventId || '',
      clientName || '',
      'WIBR',
      m.incidentNum || '',
      m.reportedAt || '',
      m.location || '',
      m.zip || '',
      [m.offenses?.length ? m.offenses.join(', ') : '', m.weapon ? `weapon: ${m.weapon}` : '']
        .filter(Boolean)
        .join(' — '),
      String(m.match?.score ?? ''),
      m.match?.confidence || '',
      (m.match?.reasons || []).join(', '),
    ]);
  }

  for (const m of lookup?.trafficCrash?.matches || []) {
    rows.push([
      lookupRun,
      eventId || '',
      clientName || '',
      'TrafficCrash',
      m.caseNumber || '',
      m.caseDate || '',
      m.location || '',
      '',
      '',
      String(m.match?.score ?? ''),
      m.match?.confidence || '',
      (m.match?.reasons || []).join(', '),
    ]);
  }

  const fpc = lookup?.fpcContext;
  if (fpc?.ok && (fpc.mpdTotal || fpc.mpdOpen)) {
    const topCats = (fpc.topCategories || [])
      .map((c) => `${c.category} (${c.count})`)
      .join('; ');
    rows.push([
      lookupRun,
      eventId || '',
      clientName || '',
      'FPCContext',
      '',
      '',
      '',
      '',
      `MPD complaints — total ${fpc.mpdTotal}, open ${fpc.mpdOpen}, last 12mo ${fpc.mpdLastYear}. Top: ${topCats}`,
      '',
      '',
      '',
    ]);
  }

  return rows;
}

async function syncMilwaukeeLookupToSheet({ env, accessToken, eventId, clientName, lookup }) {
  const rows = buildMilwaukeeSheetRows({ eventId, clientName, lookup });
  if (!rows.length) return { synced: false, reason: 'no rows to write' };
  const spreadsheetId = await resolveCaseSpreadsheetId(env, accessToken);
  if (!spreadsheetId) {
    return {
      synced: false,
      reason: 'Case Database sheet not found — open the dashboard once to create it',
    };
  }
  await ensureMilwaukeeTab(accessToken, spreadsheetId);
  await appendMilwaukeeRows(accessToken, spreadsheetId, rows);
  return { synced: true, rowCount: rows.length, spreadsheetId };
}

// --- Hillsborough court-calendar ingest ---
// GitHub Actions runs the Node scraper nightly and POSTs parsed calendar
// sessions here. We verify a shared-secret Bearer token, validate shape,
// and write per-session JSON to CALENDAR_STORE KV so /intake can read it.
//
// Expected body shape matches scraper's fetchCalendarsForDate output:
//   { type: "felony"|"misd"|"traffic", date: "YYYY-MM-DD",
//     sessions: [ { pdf, url, session, caseCount, cases } ] }
const CALENDAR_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ALLOWED_CALENDAR_TYPES = new Set(['felony', 'misd', 'traffic']);
const UPCOMING_CALENDAR_TYPES = ['felony', 'misd', 'traffic'];
const UPCOMING_LOOKAHEAD_DAYS = 14;
const CALENDAR_MS_PER_DAY = 24 * 60 * 60 * 1000;

async function ingestCalendars(request, env) {
  const expected = env.INGEST_SECRET;
  if (!expected) {
    throw new Error('INGEST_SECRET is not configured on the worker');
  }

  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!bearer || bearer !== expected) {
    throw new Error('Unauthorized');
  }

  if (!env.CALENDAR_STORE) {
    throw new Error(
      'CALENDAR_STORE KV namespace is not bound — run wrangler kv namespace create CALENDAR_STORE'
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error('Body must be a JSON object');
  }

  const type = String(body.type || '').toLowerCase();
  const date = String(body.date || '').trim();
  const sessions = Array.isArray(body.sessions) ? body.sessions : null;

  if (!ALLOWED_CALENDAR_TYPES.has(type)) {
    throw new Error(`Invalid type "${body.type}" — expected felony|misd|traffic`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${body.date}" — expected YYYY-MM-DD`);
  }
  if (!sessions) {
    throw new Error('sessions array is required');
  }

  const ingestedAt = new Date().toISOString();
  let written = 0;
  let caseTotal = 0;
  const errors = [];

  for (const session of sessions) {
    const pdfName = session?.pdf;
    if (!pdfName || typeof pdfName !== 'string') {
      errors.push({ pdf: pdfName || '(missing)', error: 'missing pdf name' });
      continue;
    }
    if (session.error) {
      // Scraper failed on this PDF — preserve the error in KV so the
      // lawyer-side UI can surface it instead of silently missing cases.
      const key = buildSessionKey(type, date, pdfName);
      await env.CALENDAR_STORE.put(
        key,
        JSON.stringify({ type, date, pdf: pdfName, error: session.error, ingestedAt }),
        { expirationTtl: CALENDAR_SESSION_TTL_SECONDS }
      );
      written++;
      continue;
    }

    const cases = Array.isArray(session.cases) ? session.cases : [];
    const payload = {
      type,
      date,
      pdf: pdfName,
      url: session.url || null,
      session: session.session || null,
      caseCount: cases.length,
      cases,
      ingestedAt,
    };

    const key = buildSessionKey(type, date, pdfName);
    await env.CALENDAR_STORE.put(key, JSON.stringify(payload), {
      expirationTtl: CALENDAR_SESSION_TTL_SECONDS,
    });
    written++;
    caseTotal += cases.length;
  }

  return {
    ok: true,
    type,
    date,
    sessionsWritten: written,
    caseTotal,
    errors,
    ingestedAt,
  };
}

// KV key: calendar:session:<type>:<court-date>:<pdf-filename>
// Lets us list by prefix "calendar:session:" to get everything, or
// "calendar:session:felony:2026-04-21:" to scope tightly.
function buildSessionKey(type, date, pdfName) {
  const safePdf = String(pdfName).replace(/[^A-Za-z0-9._-]/g, '_');
  return `calendar:session:${type}:${date}:${safePdf}`;
}

async function lookupUpcomingHillsboroughHearings(
  env,
  intake,
  { daysAhead = UPCOMING_LOOKAHEAD_DAYS } = {}
) {
  const { firstName, lastName } = splitIntakeName(intake?.fullName || '');
  const caseNumberNeedle = normText(intake?.caseNumber || '');
  if (!lastName && !caseNumberNeedle) {
    return { ok: true, searched: false, reason: 'no last name or case number provided', matches: [] };
  }

  const store = env?.CALENDAR_STORE;
  if (!store || typeof store.list !== 'function' || typeof store.get !== 'function') {
    return { ok: false, searched: false, reason: 'CALENDAR_STORE not bound', matches: [] };
  }

  const dates = upcomingDateWindow(daysAhead);
  const results = [];
  const ingestErrors = [];
  let sessionsScanned = 0;

  const intakeCtx = {
    firstName,
    caseNumber: caseNumberNeedle,
    dob: normalizeDateToIso(intake?.dob || ''),
    city: normText(intake?.city || ''),
    zip: normalizeZip(intake?.zip || ''),
  };

  for (const type of UPCOMING_CALENDAR_TYPES) {
    for (const date of dates) {
      const prefix = `calendar:session:${type}:${date}:`;
      let cursor;
      do {
        const listed = await store.list({ prefix, cursor, limit: 1000 });
        const keys = Array.isArray(listed?.keys) ? listed.keys : [];

        const payloads = await Promise.all(
          keys.map(async (k) => {
            const keyName = k?.name;
            if (!keyName) return null;
            const raw = await store.get(keyName);
            if (!raw) return null;
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })
        );

        for (const payload of payloads) {
          if (!payload || typeof payload !== 'object') continue;
          sessionsScanned++;

          if (payload.error) {
            ingestErrors.push({ date: payload.date || date, type: payload.type || type, pdf: payload.pdf || null, error: String(payload.error) });
            continue;
          }

          const cases = Array.isArray(payload.cases) ? payload.cases : [];
          for (const c of cases) {
            const caseNumber = String(c?.caseNumber || '').trim();
            const caseMatch = Boolean(caseNumberNeedle) && normText(caseNumber) === caseNumberNeedle;

            const defendant = c?.defendant || {};
            const defendantLast = normText(defendant.lastName || '');
            const lastNameMatch = Boolean(lastName) && defendantLast === lastName;

            if (!caseMatch && !lastNameMatch) continue;

            const { city, zip } = parseCityZipFromAddress(c?.address || '');
            const normalized = {
              source: 'calendar',
              calendarType: payload.type || type,
              date: payload.date || date,
              pdf: payload.pdf || null,
              url: payload.url || null,
              caseNumber,
              defendant: {
                firstName: String(defendant.firstName || '').trim(),
                middleName: String(defendant.middleName || '').trim(),
                lastName: String(defendant.lastName || '').trim(),
              },
              dob: normalizeDateToIso(c?.dob || ''),
              address: String(c?.address || '').trim(),
              city,
              zip,
              hearing: c?.hearing || null,
              rawCharges: c?.rawCharges || null,
              futureHearings: Array.isArray(c?.futureHearings) ? c.futureHearings : [],
            };

            results.push({
              ...normalized,
              match: scoreCalendarMatch(normalized, intakeCtx),
            });
          }
        }

        if (listed?.list_complete) {
          cursor = undefined;
        } else {
          cursor = listed?.cursor;
        }
      } while (cursor);
    }
  }

  results.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return compareHearingDates(a, b);
  });

  return {
    ok: true,
    searched: true,
    windowDays: daysAhead,
    sessionsScanned,
    matchCount: results.length,
    matches: results.slice(0, 25),
    ingestErrors: ingestErrors.slice(0, 25),
  };
}

function splitIntakeName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return { firstName: '', lastName: '' };
  if (s.includes(',')) {
    const [last, rest] = s.split(',').map((p) => p.trim());
    const [first] = (rest || '').split(/\s+/);
    return { firstName: normText(first || ''), lastName: normText(last || '') };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: normText(parts[0]) };
  return { firstName: normText(parts[0]), lastName: normText(parts[parts.length - 1]) };
}

function normText(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeZip(zip) {
  const m = String(zip || '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

function normalizeDateToIso(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!mdy) return '';
  return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
}

function parseCityZipFromAddress(raw) {
  const parts = String(raw || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return { city: '', zip: '' };
  const city = normText(parts[parts.length - 2] || '');
  const zip = normalizeZip(parts[parts.length - 1] || '');
  return { city, zip };
}

function scoreCalendarMatch(record, intakeCtx) {
  const reasons = [];
  let score = 0;

  if (intakeCtx.caseNumber && normText(record.caseNumber) === intakeCtx.caseNumber) {
    reasons.push('case-number exact');
    score += 100;
  }
  if (intakeCtx.dob && record.dob && normalizeDateToIso(record.dob) === intakeCtx.dob) {
    reasons.push('DOB exact');
    score += 60;
  }
  if (intakeCtx.firstName && normText(record.defendant?.firstName || '') === intakeCtx.firstName) {
    reasons.push('first-name match');
    score += 20;
  }
  if (intakeCtx.city && record.city && normText(record.city) === intakeCtx.city) {
    reasons.push('city match');
    score += 10;
  }
  if (intakeCtx.zip && record.zip && normalizeZip(record.zip) === intakeCtx.zip) {
    reasons.push('zip match');
    score += 10;
  }

  let confidence = 'low';
  if (score >= 60) confidence = 'high';
  else if (score >= 20) confidence = 'medium';

  return { score, confidence, reasons };
}

function upcomingDateWindow(daysAhead) {
  const count = Math.max(1, Number(daysAhead) || UPCOMING_LOOKAHEAD_DAYS);
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  const dates = [];
  for (let i = -1; i < count; i++) {
    const d = new Date(base.getTime() + i * CALENDAR_MS_PER_DAY);
    dates.push(formatIsoDate(d));
  }
  return dates;
}

function formatIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function compareHearingDates(a, b) {
  const aIso = normalizeDateToIso(a?.hearing?.courtDate || '');
  const bIso = normalizeDateToIso(b?.hearing?.courtDate || '');
  if (aIso && bIso && aIso !== bIso) return aIso < bIso ? -1 : 1;
  if (aIso && !bIso) return -1;
  if (!aIso && bIso) return 1;
  return 0;
}

// Only run the Hillsborough court-records lookup when the matter is a
// criminal case in Florida (Hillsborough-specific feeds). Outside that
// scope the lookup would produce irrelevant or no matches.
async function handleCourtLookup(body) {
  const jurisdiction = (body?.jurisdiction || '').toString().toLowerCase();
  if (jurisdiction !== 'hillsborough') {
    return {
      ok: false,
      error: `Live lookup is only wired for Hillsborough right now. Wisconsin uses the WCCA deep link + CLI scraper.`,
    };
  }
  const caseNumber = (body?.caseNumber || '').toString().trim();
  const lastName = (body?.lastName || '').toString().trim();
  const firstName = (body?.firstName || '').toString().trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (!caseNumber && !lastName) {
    return { ok: false, error: 'Provide a case number or a last name.' };
  }
  try {
    return await lookupHillsboroughRecords({
      caseNumber,
      fullName,
      dob: body?.dob || null,
      city: body?.city || null,
      zip: body?.zip || null,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Court lookup failed' };
  }
}

function shouldRunHillsboroughLookup(answers) {
  if (!answers) return false;
  if (answers.matterType !== 'criminal') return false;
  const state = (answers.jurisdictionState || '').trim().toLowerCase();
  const county = (answers.jurisdictionCounty || '').trim().toLowerCase();
  if (state && !['fl', 'florida'].includes(state)) return false;
  if (county && !county.includes('hillsborough')) return false;
  return true;
}

async function researchCase(apiKey, answers) {
  if (!apiKey) return { text: '(Perplexity API key not configured)', citations: [] };

  const matterLabel = formatMatterLabel(answers.matterType);
  const jurisdiction = [answers.jurisdictionCounty, answers.jurisdictionState].filter(Boolean).join(', ');

  const prompt = `You are a legal research assistant. A prospective client just submitted an intake form to a law firm. Research publicly available information relevant to this matter and provide a brief for the attorney.

Client: ${answers.fullName}
Matter type: ${matterLabel}${answers.matterDetail ? ' — ' + answers.matterDetail : ''}
Jurisdiction: ${jurisdiction || 'Unknown'}
Description: ${answers.description || 'Not provided'}
${answers.urgent === 'yes' ? 'URGENT: ' + (answers.urgencyReason || 'Yes') : ''}
${answers.opposingParty && !/^(none|n\/a|no)$/i.test(answers.opposingParty) ? 'Opposing party: ' + answers.opposingParty : ''}

Search for:
1. Recent public court records or filings related to this matter or parties in this jurisdiction
2. Relevant local statutes, penalties, or procedural rules for this matter type in ${answers.jurisdictionState || 'the jurisdiction'}
3. Any recent news involving the parties or similar cases in the area

Return a concise research brief (under 300 words). Lead with the most actionable findings. If you find nothing specific, provide relevant statutory context for this matter type in the jurisdiction. Label each section clearly.`;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a legal research assistant. Be factual, cite sources when available, and note when information could not be verified. Never fabricate case details.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return { text: `(Perplexity error ${response.status}: ${errBody.slice(0, 200)})`, citations: [] };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: '(Perplexity returned empty response)', citations: [] };

    const citations = data?.citations || [];
    return { text, citations };
  } catch (err) {
    return { text: `(Perplexity fetch failed: ${err instanceof Error ? err.message : 'unknown'})`, citations: [] };
  }
}

function buildCalendarEventPayload({
  answers,
  transcript,
  summary,
  firmId,
  conflictHit,
  research,
  courtLookup,
  upcomingHearings,
  milwaukeeLookup,
  orangeFlLookup,
}) {
  const urgent = answers.urgent === 'yes';
  const matterLabel = formatMatterLabel(answers.matterType);

  const summaryText = `${urgent ? '[URGENT] ' : ''}New Lead — ${answers.fullName} (${matterLabel})`;

  const now = new Date();
  const { start, end } = pickTentativeSlot(answers.preferredTimes, urgent, now);
  const receivedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const esc = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Deep-link into HOVER case summary — the lawyer's own browser passes the
  // PerimeterX gate normally on first visit, so this is ground truth with
  // one click. Used to cross-check bulk PDF / CSV matches against the
  // Clerk's live case detail.
  const hoverCaseLink = (caseNumber) => {
    const num = (caseNumber || '').trim();
    if (!num) return '';
    const url = `https://hover.hillsclerk.com/html/case/caseSummary.html?caseNumber=${encodeURIComponent(num)}`;
    return ` <a href="${esc(url)}">🔗 view on HOVER</a>`;
  };
  const phoneLink = answers.phone ? `<a href="tel:${esc(answers.phone.replace(/\D/g, ''))}">${esc(answers.phone)}</a>` : '—';
  const emailLink = answers.email ? `<a href="mailto:${esc(answers.email)}">${esc(answers.email)}</a>` : '—';
  const jurisdiction = [answers.jurisdictionCounty, answers.jurisdictionState].filter(Boolean).join(', ') || '—';

  const html = [];

  // Conflict banner
  if (conflictHit) {
    html.push(`<b>⚠️ CONFLICT FLAG:</b> "${esc(conflictHit)}" matches an existing contact.<br><br>`);
  }

  // Urgency banner
  if (urgent) {
    html.push(`<b>🔴 URGENT</b> — ${esc(answers.urgencyReason || 'Client flagged as urgent')}<br><br>`);
  }

  // AI Summary
  if (summary) {
    html.push(`<i>${esc(summary)}</i><br><br>`);
  }

  // Client section
  html.push(`<b>📋 CLIENT</b><br>`);
  html.push(`<b>${esc(answers.fullName)}</b><br>`);
  html.push(`📞 ${phoneLink}<br>`);
  html.push(`✉️ ${emailLink}<br>`);
  if (answers.bestContact) {
    html.push(`Preferred contact: ${esc(answers.bestContact)}<br>`);
  }
  html.push(`<br>`);

  // Matter section
  html.push(`<b>⚖️ MATTER</b><br>`);
  html.push(`${esc(matterLabel)}${answers.matterDetail ? ' — ' + esc(answers.matterDetail) : ''}<br>`);
  html.push(`📍 ${esc(jurisdiction)}<br>`);
  if (answers.opposingParty && !/^(none|n\/a|no)$/i.test(answers.opposingParty)) {
    html.push(`Opposing party: ${esc(answers.opposingParty)}<br>`);
  }
  html.push(`<br>`);

  // Description
  html.push(`<b>📝 DESCRIPTION</b><br>`);
  html.push(`${esc(answers.description || '—')}<br><br>`);

  // Schedule & meta
  html.push(`<b>📅 SCHEDULING</b><br>`);
  html.push(`Preferred times: ${esc(answers.preferredTimes || '—')}<br>`);
  html.push(`Referral: ${esc(answers.howHeard || '—')}<br>`);
  html.push(`Received: ${esc(receivedDate)}<br>`);

  // Hillsborough public-records lookup
  if (courtLookup?.ok && Array.isArray(courtLookup.matches) && courtLookup.matches.length > 0) {
    html.push(`<br><b>🏛️ HILLSBOROUGH COURT RECORDS</b><br>`);
    html.push(
      `${courtLookup.matchCount} match${courtLookup.matchCount === 1 ? '' : 'es'} in the last ${courtLookup.windowDays} days — ranked by confidence<br><br>`
    );
    for (const m of courtLookup.matches.slice(0, 5)) {
      const def = m.defendant || {};
      const name = [def.firstName, def.middleName, def.lastName].filter(Boolean).join(' ');
      const typeBadge = m.source === 'citation' ? '🚗 CITATION' : '⚖️ FILING';
      const conf = m.match?.confidence || 'low';
      const confBadge = conf === 'high' ? '🟢' : conf === 'medium' ? '🟡' : '⚪';

      html.push(`${confBadge} <b>${esc(m.caseNumber)}</b>${hoverCaseLink(m.caseNumber)} — ${typeBadge}<br>`);
      const idLine = [name || '(no name)', def.dob ? `DOB ${def.dob}` : null, def.city ? def.city : null]
        .filter(Boolean)
        .join(' • ');
      html.push(`${esc(idLine)}<br>`);
      if (m.caseType) html.push(`<i>${esc(m.caseType)}</i><br>`);
      if (Array.isArray(m.charges) && m.charges.length) {
        const first = m.charges[0];
        const chargeText = first.description || first.statute || '';
        if (chargeText) html.push(`${esc(chargeText)}<br>`);
        if (m.charges.length > 1) {
          html.push(`<i>+${m.charges.length - 1} more charge${m.charges.length > 2 ? 's' : ''}</i><br>`);
        }
      }
      if (m.attorney) {
        const unrep = m.attorney.toLowerCase().includes('no attorney');
        html.push(
          `Attorney: ${unrep ? '<b>No attorney (unrepresented)</b>' : esc(m.attorney)}<br>`
        );
      }
      const reasonText = m.match?.reasons?.length
        ? m.match.reasons.join(', ')
        : 'last-name match only';
      html.push(
        `<span style="color:#666">Filed ${esc(m.filingDate || '—')} • Match: ${esc(reasonText)}</span><br><br>`
      );
    }
  }

  // Upcoming hearings pulled from pre-parsed calendar PDFs in CALENDAR_STORE.
  if (upcomingHearings?.ok && Array.isArray(upcomingHearings.matches) && upcomingHearings.matches.length > 0) {
    html.push(`<br><b>🗓️ UPCOMING HEARINGS</b><br>`);
    html.push(
      `${upcomingHearings.matchCount} potential hearing match${upcomingHearings.matchCount === 1 ? '' : 'es'} in next ${upcomingHearings.windowDays} days<br>`
    );
    html.push(
      `<span style="color:#666"><i>From published court calendar PDFs — may miss last-minute additions or reassignments. Click 🔗 to verify on HOVER.</i></span><br><br>`
    );
    for (const h of upcomingHearings.matches.slice(0, 5)) {
      const conf = h.match?.confidence || 'low';
      const confBadge = conf === 'high' ? '🟢' : conf === 'medium' ? '🟡' : '⚪';
      const hearing = h.hearing || {};
      const def = h.defendant || {};
      const name = [def.firstName, def.middleName, def.lastName].filter(Boolean).join(' ');
      const docket = [hearing.courtDate, hearing.session, hearing.courtRoom].filter(Boolean).join(' • ');
      const sourceLine = h.url
        ? `<a href="${esc(h.url)}">${esc(h.pdf || 'calendar PDF')}</a>`
        : esc(h.pdf || 'calendar PDF');

      html.push(`${confBadge} <b>${esc(h.caseNumber)}</b>${hoverCaseLink(h.caseNumber)} — 🏛️ ${esc((h.calendarType || 'calendar').toUpperCase())}<br>`);
      html.push(`${esc(name || '(no name)')}${h.dob ? ` • DOB ${esc(h.dob)}` : ''}<br>`);
      if (docket) html.push(`${esc(docket)}<br>`);
      if (hearing.setFor) html.push(`<i>${esc(hearing.setFor)}</i><br>`);
      if (h.rawCharges) {
        const firstCharge = String(h.rawCharges).split(/\n+/).find((line) => line.trim());
        if (firstCharge) html.push(`${esc(firstCharge)}<br>`);
      }
      if (Array.isArray(h.futureHearings) && h.futureHearings.length > 0) {
        const f = h.futureHearings[0];
        const nextFuture = [f.type, f.date, f.time].filter(Boolean).join(' • ');
        if (nextFuture) html.push(`Next setting: ${esc(nextFuture)}<br>`);
      }
      const reasonText = h.match?.reasons?.length ? h.match.reasons.join(', ') : 'last-name match only';
      html.push(
        `<span style="color:#666">Source: ${sourceLine} • Match: ${esc(reasonText)}</span><br><br>`
      );
    }
  }

  // Milwaukee Open Data Portal — WIBR + Traffic Crash + FPC aggregate.
  // Mirrors Hillsborough styling but uses address/date scoring since WIBR
  // has no party names.
  if (milwaukeeLookup?.ok) {
    const wibrMatches = milwaukeeLookup.wibr?.matches || [];
    const crashMatches = milwaukeeLookup.trafficCrash?.matches || [];
    const fpc = milwaukeeLookup.fpcContext;
    const extracted = milwaukeeLookup.extracted || {};
    const anyMatches = wibrMatches.length + crashMatches.length > 0;
    const hasFpc = fpc?.ok && (fpc.mpdTotal || fpc.mpdOpen);

    if (anyMatches || hasFpc) {
      html.push(`<br><b>🏛️ MILWAUKEE PORTAL</b><br>`);
      const anchorBits = [];
      if (extracted.incidentDate) anchorBits.push(`date ${extracted.incidentDate}`);
      if (extracted.incidentAddress) anchorBits.push(`addr "${extracted.incidentAddress}"`);
      if (extracted.offenseCategory) anchorBits.push(`type ${extracted.offenseCategory}`);
      if (anchorBits.length) {
        html.push(
          `<span style="color:#666"><i>Anchored on ${esc(anchorBits.join(' • '))}${extracted.officerMentioned ? ` • officer mentioned: ${esc(extracted.officerMentioned)}` : ''}</i></span><br><br>`
        );
      }

      if (wibrMatches.length > 0) {
        html.push(
          `<b>WIBR crime incidents</b> — ${wibrMatches.length} match${wibrMatches.length === 1 ? '' : 'es'}<br>`
        );
        for (const m of wibrMatches.slice(0, 5)) {
          const conf = m.match?.confidence || 'low';
          const confBadge = conf === 'high' ? '🟢' : conf === 'medium' ? '🟡' : '⚪';
          html.push(
            `${confBadge} <b>${esc(m.incidentNum || '—')}</b> — ${esc(m.reportedAt || '—')}<br>`
          );
          html.push(`${esc(m.location || '—')}${m.zip ? ` • ZIP ${esc(m.zip)}` : ''}${m.policeDistrict ? ` • District ${esc(m.policeDistrict)}` : ''}<br>`);
          if (m.offenses?.length) {
            html.push(`Offenses: ${esc(m.offenses.join(', '))}${m.weapon ? ` • weapon: ${esc(m.weapon)}` : ''}<br>`);
          }
          const reasonText = m.match?.reasons?.length ? m.match.reasons.join(', ') : '';
          html.push(
            `<span style="color:#666">Match: ${esc(reasonText || '—')}</span><br><br>`
          );
        }
      }

      if (crashMatches.length > 0) {
        html.push(
          `<b>Traffic crashes</b> — ${crashMatches.length} match${crashMatches.length === 1 ? '' : 'es'}<br>`
        );
        for (const m of crashMatches.slice(0, 5)) {
          const conf = m.match?.confidence || 'low';
          const confBadge = conf === 'high' ? '🟢' : conf === 'medium' ? '🟡' : '⚪';
          html.push(
            `${confBadge} <b>${esc(m.caseNumber || '—')}</b> — ${esc(m.caseDate || '—')}<br>`
          );
          html.push(`${esc(m.location || '—')}<br>`);
          const reasonText = m.match?.reasons?.length ? m.match.reasons.join(', ') : '';
          html.push(
            `<span style="color:#666">Match: ${esc(reasonText || '—')}</span><br><br>`
          );
        }
      }

      if (hasFpc) {
        const topCats = (fpc.topCategories || [])
          .map((c) => `${c.category} (${c.count})`)
          .join(' • ');
        html.push(
          `<b>FPC complaint context</b> <span style="color:#666"><i>(dataset redacts officer names — department totals only)</i></span><br>`
        );
        html.push(
          `MPD: ${fpc.mpdTotal} total • ${fpc.mpdOpen} open • ${fpc.mpdLastYear} in last 12 months<br>`
        );
        if (topCats) html.push(`Top categories: ${esc(topCats)}<br>`);
        html.push(`<br>`);
      }
    } else if (extracted.incidentAddress || extracted.incidentDate) {
      html.push(
        `<br><b>🏛️ MILWAUKEE PORTAL</b> — no matches for ${esc(extracted.incidentAddress || extracted.incidentDate || 'the extracted incident')}<br><br>`
      );
    }
  }

  // Orange County FL — OCSO daily booking PDF + OCGIS parcel lookup. The
  // worker does both server-side; the extension handles the case-search
  // deep dive (myorangeclerk.com) since that portal requires a CAPTCHA.
  if (orangeFlLookup?.ok) {
    const bookings = orangeFlLookup.bookings;
    const parcel = orangeFlLookup.parcel;
    const bookingMatches = bookings?.matches || [];
    const parcelHits = parcel?.parcels || [];
    const anyHits = bookingMatches.length > 0 || parcelHits.length > 0;

    if (anyHits) {
      html.push(`<br><b>🍊 ORANGE COUNTY FL</b><br>`);
      if (bookings?.reportDate) {
        html.push(
          `<span style="color:#666"><i>Booking report ${esc(bookings.reportDate)} • ${bookings.totalReported || 0} entries scanned</i></span><br><br>`
        );
      }

      if (bookingMatches.length > 0) {
        html.push(
          `<b>OCSO bookings</b> — ${bookingMatches.length} match${bookingMatches.length === 1 ? '' : 'es'} in last 24h<br>`
        );
        for (const m of bookingMatches.slice(0, 5)) {
          const conf = m.match?.confidence || 'low';
          const confBadge = conf === 'high' ? '🟢' : conf === 'medium' ? '🟡' : '⚪';
          const status = m.releaseAt ? `released ${m.releaseAt}` : `in custody (cell ${m.cell || '—'})`;
          html.push(
            `${confBadge} <b>${esc(m.name)}</b> — booking #${esc(m.bookingNumber)} • ${esc(status)}<br>`
          );
          const topCase = m.cases?.[0];
          if (topCase) {
            const caseLabel = topCase.caseNumber || '(no case#)';
            html.push(`Case ${esc(caseLabel)} — ${esc(topCase.agency || '—')}<br>`);
            for (const ch of (topCase.charges || []).slice(0, 3)) {
              html.push(`• ${esc(ch.level)} / ${esc(ch.degree)} — ${esc(ch.description || ch.statute)}<br>`);
            }
          }
          const reasonText = m.match?.reasons?.length ? m.match.reasons.join(', ') : '';
          html.push(
            `<span style="color:#666">Match: ${esc(reasonText || '—')}</span><br><br>`
          );
        }
      }

      if (parcelHits.length > 0) {
        html.push(
          `<b>OCGIS parcels</b> — ${parcelHits.length} hit${parcelHits.length === 1 ? '' : 's'} for ${esc(parcel.address || parcel.basename || 'incident address')}<br>`
        );
        for (const p of parcelHits.slice(0, 5)) {
          html.push(
            `📍 <b>${esc(p.address)}</b> • ${esc(p.jurisdiction || '—')} ${esc(p.zip || '')}<br>`
          );
          html.push(
            `<span style="color:#666">Parcel ${esc(p.parcelId || '—')} • use: ${esc(p.useCode || '—')}</span><br><br>`
          );
        }
      }
    } else if (parcel?.address) {
      html.push(
        `<br><b>🍊 ORANGE COUNTY FL</b> — no booking match, no parcel found for ${esc(parcel.address)}<br><br>`
      );
    }
  }

  // Research section
  if (research?.text) {
    html.push(`<br><b>🔍 RESEARCH</b><br>`);
    html.push(`${esc(research.text).replace(/\n/g, '<br>')}<br>`);
    if (research.citations?.length) {
      html.push(`<br><b>Sources:</b><br>`);
      for (const cite of research.citations.slice(0, 5)) {
        const url = String(cite).trim();
        if (/^https?:\/\//.test(url)) {
          html.push(`• <a href="${esc(url)}">${esc(url)}</a><br>`);
        } else {
          html.push(`• ${esc(url)}<br>`);
        }
      }
    }
  }

  const workflow = {
    status: 'new',
    source: 'intake-chatbot',
    urgent,
    conflictFlagged: Boolean(conflictHit),
    receivedAt: now.toISOString(),
  };

  // Compact structured court data so the frontend can render a typed card
  // without parsing HTML. Capped at 1024 chars per extendedProperty value.
  const compactRecords = (courtLookup?.ok && Array.isArray(courtLookup.matches) ? courtLookup.matches : [])
    .slice(0, 3)
    .map((m) => {
      const def = m.defendant || {};
      const name = [def.firstName, def.middleName, def.lastName].filter(Boolean).join(' ');
      const firstCharge = Array.isArray(m.charges) && m.charges[0]
        ? (m.charges[0].description || m.charges[0].statute || '')
        : '';
      return {
        caseNumber: m.caseNumber || '',
        source: m.source || '',
        name,
        dob: def.dob || '',
        caseType: m.caseType || '',
        charge: String(firstCharge).slice(0, 140),
        chargeCount: Array.isArray(m.charges) ? m.charges.length : 0,
        attorney: m.attorney || '',
        filingDate: m.filingDate || '',
        confidence: m.match?.confidence || 'low',
      };
    });

  const compactHearings = (upcomingHearings?.ok && Array.isArray(upcomingHearings.matches) ? upcomingHearings.matches : [])
    .slice(0, 3)
    .map((h) => {
      const def = h.defendant || {};
      const name = [def.firstName, def.middleName, def.lastName].filter(Boolean).join(' ');
      const hearing = h.hearing || {};
      const nextFuture = Array.isArray(h.futureHearings) && h.futureHearings[0]
        ? [h.futureHearings[0].type, h.futureHearings[0].date, h.futureHearings[0].time].filter(Boolean).join(' ')
        : '';
      return {
        caseNumber: h.caseNumber || '',
        calendarType: h.calendarType || '',
        name,
        dob: h.dob || '',
        courtDate: hearing.courtDate || '',
        session: hearing.session || '',
        room: hearing.courtRoom || '',
        setFor: String(hearing.setFor || '').slice(0, 120),
        nextFuture,
        url: h.url || '',
        confidence: h.match?.confidence || 'low',
      };
    });

  const courtPayload = JSON.stringify({
    records: compactRecords,
    hearings: compactHearings,
    recordsWindow: courtLookup?.windowDays || 0,
    hearingsWindow: upcomingHearings?.windowDays || 0,
    recordsCount: courtLookup?.matchCount || 0,
    hearingsCount: upcomingHearings?.matchCount || 0,
  });

  // Compact Milwaukee payload so the dashboard can render typed cards.
  // Capped at 1024 chars per extendedProperty — slice aggressively on overflow.
  const compactWibr = (milwaukeeLookup?.wibr?.matches || []).slice(0, 3).map((m) => ({
    incidentNum: m.incidentNum || '',
    reportedAt: String(m.reportedAt || '').slice(0, 20),
    location: String(m.location || '').slice(0, 80),
    zip: m.zip || '',
    district: m.policeDistrict || '',
    offenses: (m.offenses || []).slice(0, 3),
    confidence: m.match?.confidence || 'low',
  }));
  const compactCrashes = (milwaukeeLookup?.trafficCrash?.matches || []).slice(0, 3).map((m) => ({
    caseNumber: m.caseNumber || '',
    caseDate: String(m.caseDate || '').slice(0, 20),
    location: String(m.location || '').slice(0, 80),
    confidence: m.match?.confidence || 'low',
  }));
  const milwaukeeBase = {
    anchor: milwaukeeLookup?.extracted
      ? {
          date: milwaukeeLookup.extracted.incidentDate || '',
          address: String(milwaukeeLookup.extracted.incidentAddress || '').slice(0, 80),
          offense: milwaukeeLookup.extracted.offenseCategory || '',
        }
      : null,
    wibr: compactWibr,
    crashes: compactCrashes,
    fpc: milwaukeeLookup?.fpcContext?.ok
      ? {
          mpdTotal: milwaukeeLookup.fpcContext.mpdTotal || 0,
          mpdOpen: milwaukeeLookup.fpcContext.mpdOpen || 0,
          mpdLastYear: milwaukeeLookup.fpcContext.mpdLastYear || 0,
          topCategories: (milwaukeeLookup.fpcContext.topCategories || []).slice(0, 3),
        }
      : null,
  };
  let milwaukeePayload = milwaukeeLookup?.ok ? JSON.stringify(milwaukeeBase) : '';
  if (milwaukeePayload.length > 1024) {
    milwaukeePayload = JSON.stringify({
      ...milwaukeeBase,
      wibr: compactWibr.slice(0, 1),
      crashes: compactCrashes.slice(0, 1),
    });
  }

  // Compact Orange County FL payload — top 3 booking matches + top 3 parcels.
  // Same 1024-char extendedProperty cap; trim aggressively on overflow.
  const compactOrangeBookings = (orangeFlLookup?.bookings?.matches || []).slice(0, 3).map((m) => ({
    name: m.name || '',
    bookingNumber: m.bookingNumber || '',
    cell: m.cell || '',
    age: m.age || null,
    releaseAt: m.releaseAt || '',
    address: {
      city: m.address?.city || '',
      zip: m.address?.zip || '',
    },
    topCase: m.cases?.[0]
      ? {
          caseNumber: m.cases[0].caseNumber || '',
          agency: String(m.cases[0].agency || '').slice(0, 60),
          topCharge: m.cases[0].charges?.[0]
            ? {
                level: m.cases[0].charges[0].level || '',
                degree: m.cases[0].charges[0].degree || '',
                statute: m.cases[0].charges[0].statute || '',
                description: String(m.cases[0].charges[0].description || '').slice(0, 100),
              }
            : null,
          chargeCount: m.cases[0].charges?.length || 0,
        }
      : null,
    confidence: m.match?.confidence || 'low',
  }));
  const compactOrangeParcels = (orangeFlLookup?.parcel?.parcels || []).slice(0, 3).map((p) => ({
    address: String(p.address || '').slice(0, 80),
    parcelId: p.parcelId || '',
    zip: p.zip || '',
    jurisdiction: p.jurisdiction || '',
    useCode: String(p.useCode || '').slice(0, 40),
  }));
  const orangeFlBase = {
    reportDate: orangeFlLookup?.bookings?.reportDate || '',
    totalReported: orangeFlLookup?.bookings?.totalReported || 0,
    bookings: compactOrangeBookings,
    parcelAddress: String(orangeFlLookup?.parcel?.address || '').slice(0, 80),
    parcels: compactOrangeParcels,
  };
  let orangeFlPayload = orangeFlLookup?.ok ? JSON.stringify(orangeFlBase) : '';
  if (orangeFlPayload.length > 1024) {
    orangeFlPayload = JSON.stringify({
      ...orangeFlBase,
      bookings: compactOrangeBookings.slice(0, 1),
      parcels: compactOrangeParcels.slice(0, 1),
    });
  }

  return {
    summary: summaryText,
    description: html.join(''),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: urgent ? '11' : '5',
    transparency: 'transparent',
    attendees: [{ email: answers.email, displayName: answers.fullName }],
    extendedProperties: {
      private: {
        sphericalAssistant: JSON.stringify(workflow),
        intakeSource: 'chatbot',
        intakeFirmId: firmId || '',
        sphericalCaseNumber: (answers.caseNumber || '').toString().trim(),
        sphericalClientName: (answers.fullName || '').toString().trim(),
        sphericalMatterType: (answers.matterType || '').toString().trim(),
        sphericalCourt: courtPayload.length <= 1024 ? courtPayload : JSON.stringify({
          records: compactRecords.slice(0, 2),
          hearings: compactHearings.slice(0, 2),
          recordsWindow: courtLookup?.windowDays || 0,
          hearingsWindow: upcomingHearings?.windowDays || 0,
          recordsCount: courtLookup?.matchCount || 0,
          hearingsCount: upcomingHearings?.matchCount || 0,
        }),
        ...(milwaukeePayload ? { sphericalMilwaukee: milwaukeePayload } : {}),
        ...(orangeFlPayload ? { sphericalOrangeFl: orangeFlPayload } : {}),
      },
    },
  };
}

function formatMatterLabel(matterType) {
  const labels = {
    family: 'Family / Divorce',
    criminal: 'Criminal Defense',
    'personal-injury': 'Personal Injury',
    immigration: 'Immigration',
    estate: 'Estate / Probate',
    business: 'Business / Contracts',
    employment: 'Employment',
    other: 'Other',
  };
  return labels[matterType] || 'Consultation';
}

function pickTentativeSlot(preferredTimes, urgent, now) {
  // The LLM-collected preferredTimes field is free-form ("Thursday after 3pm").
  // Rather than parse natural language, drop a tentative placeholder that the
  // attorney confirms from the dashboard. Urgent intakes land sooner.
  const minutesFromNow = urgent ? 60 : 60 * 24; // 1h for urgent, 24h otherwise
  const start = new Date(now.getTime() + minutesFromNow * 60 * 1000);
  // Round up to the next quarter hour so it doesn't look like a random stamp
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  void preferredTimes;
  return { start, end };
}

async function checkContactConflict(accessToken, opposingParty) {
  const name = (opposingParty || '').trim();
  if (!name || /^(none|n\/a|no)$/i.test(name)) return null;

  try {
    const url = new URL('https://people.googleapis.com/v1/people:searchContacts');
    url.searchParams.set('query', name);
    url.searchParams.set('readMask', 'names');
    url.searchParams.set('pageSize', '5');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const results = payload?.results || [];
    if (!results.length) return null;

    // Loose contains match — the attorney gets final judgment from the banner.
    const lowerName = name.toLowerCase();
    for (const result of results) {
      const displayName = result?.person?.names?.[0]?.displayName || '';
      if (displayName && displayName.toLowerCase().includes(lowerName.split(' ')[0])) {
        return displayName;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- Google OAuth offline flow (refresh-token minting) ---

async function oauthExchange(env, payload) {
  const { code, redirectUri } = payload || {};
  if (!code || !redirectUri) {
    throw new Error('Missing code or redirectUri');
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Worker secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  if (!env.INTAKE_STORE) {
    throw new Error('INTAKE_STORE KV namespace is not bound');
  }

  const params = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.refresh_token) {
    const message = data?.error_description || data?.error || 'Token exchange failed (no refresh_token returned — make sure prompt=consent and access_type=offline)';
    throw new Error(message);
  }

  await env.INTAKE_STORE.put(REFRESH_TOKEN_KEY, data.refresh_token);

  return { ok: true, connectedAt: new Date().toISOString() };
}

async function oauthStatus(env) {
  if (!env.INTAKE_STORE) return { connected: false, reason: 'KV not bound' };
  const token = await env.INTAKE_STORE.get(REFRESH_TOKEN_KEY);
  if (!token) return { connected: false };

  try {
    await exchangeRefreshToken(env, token);
    return { connected: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (isInvalidRefreshTokenError(message)) {
      await env.INTAKE_STORE.delete(REFRESH_TOKEN_KEY);
      return {
        connected: false,
        reason: 'Google connection expired and was cleared. Please reconnect.',
      };
    }
    // Keep current state on transient OAuth/provider issues so the UI doesn't flap.
    return { connected: true, warning: message || 'Could not validate token' };
  }
}

async function oauthDisconnect(env) {
  if (!env.INTAKE_STORE) return { ok: false, connected: false, reason: 'KV not bound' };
  await env.INTAKE_STORE.delete(REFRESH_TOKEN_KEY);
  return { ok: true, connected: false, disconnectedAt: new Date().toISOString() };
}

async function exchangeRefreshToken(env, refreshToken) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Worker secrets GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const message = data?.error_description || data?.error || 'Refresh token exchange failed';
    throw new Error(message);
  }
  return data.access_token;
}

function isInvalidRefreshTokenError(message) {
  return /invalid_grant|expired|revoked/i.test(message || '');
}

// --- Case management endpoints ---

async function caseChatHandler(env, payload) {
  const { message, history = [], documents = [], caseContext = {}, industry = 'legal' } = payload || {};

  if (!message) throw new Error('Missing message');

  const industryLabel = industry === 'realestate' ? 'real estate' : 'legal';

  const docSummary = documents.length
    ? documents.map((d, i) => `[Document ${i + 1}: ${d.name} (${d.category})]\n${(d.textContent || '').slice(0, 3000)}`).join('\n\n---\n\n')
    : '(No documents uploaded yet)';

  const systemPrompt = `You are Spherical Assistant, an AI case management assistant for ${industryLabel} professionals built by SphereLabs.

CASE CONTEXT:
- Case: ${caseContext.title || 'Unknown'}
- Client: ${caseContext.clientName || 'Unknown'}
- Industry: ${industryLabel}
- Tasks pending: ${caseContext.pendingTasks || 0}
- Documents on file: ${documents.length}

DOCUMENTS ON FILE:
${docSummary}

YOUR CAPABILITIES:
- Answer questions about any uploaded documents accurately, citing which document you're referencing
- Summarize case status, documents, and pending tasks
- Help draft correspondence based on document content
- Flag potential issues, deadlines, or missing information
- ${industry === 'realestate' ? 'Analyze property details, compare offers, review inspection reports, and summarize financial terms' : 'Identify legal issues, check for conflicts, summarize depositions, and flag statute of limitations concerns'}

RULES:
- Be concise and professional
- If something is not in the documents, say so — never fabricate
- When referencing document content, mention which document by name
- ${industry === 'legal' ? 'You are NOT an attorney. Never give legal advice or opinions on case merits.' : 'You are NOT a licensed agent. Never guarantee property values or transaction outcomes.'}`;

  const contents = [];

  contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
  contents.push({ role: 'model', parts: [{ text: 'Understood. I\'m ready to help with this case. What would you like to know?' }] });

  for (const msg of history.slice(-20)) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    });
  }

  contents.push({ role: 'user', parts: [{ text: message }] });

  const text = await callGemini(env, GEMINI_MODEL, {
    contents,
    generationConfig: { temperature: 0.4 },
  });

  return { reply: text };
}

async function categorizeDocument(env, payload) {
  const { fileName, textPreview, industry = 'legal' } = payload || {};

  if (!fileName) throw new Error('Missing fileName');

  const legalCategories = 'intake, court, medical, correspondence, financial, evidence, discovery, other';
  const realestateCategories = 'intake, contracts, property, correspondence, financial, inspections, title, other';
  const categories = industry === 'realestate' ? realestateCategories : legalCategories;

  const prompt = `Classify this document into ONE category. Return ONLY the category key, nothing else.

Categories: ${categories}

File name: ${fileName}
Content preview (first 500 chars):
${(textPreview || '').slice(0, 500)}

Return ONLY the category key (e.g. "court" or "contracts"). No punctuation, no explanation.`;

  const text = await callGemini(env, GEMINI_INTAKE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1 },
  });

  const category = text.trim().toLowerCase().replace(/[^a-z-]/g, '');
  const validCategories = categories.split(',').map((c) => c.trim());

  return { category: validCategories.includes(category) ? category : 'other' };
}

async function summarizeDocument(env, payload) {
  const { fileName, textPreview, industry = 'legal' } = payload || {};
  if (!fileName) throw new Error('Missing fileName');

  const prompt = `You are reading a single document from a ${industry === 'realestate' ? 'real estate transaction' : 'legal matter'}. In ONE short sentence (max 18 words), describe what this document actually IS — include the specific document type and the single most important fact (a date, party, case number, amount, etc.).

File name: ${fileName}
Content (first 1500 chars):
${(textPreview || '').slice(0, 1500)}

Good examples:
- "Tampa PD arrest affidavit — DUI stop on 2026-02-14, driver Smith."
- "State Farm medical lien letter — $4,820 outstanding on auto-claim #A87-223."
- "Purchase agreement — 1812 Oak Ave, buyer Ramirez, $425k, close date 2026-05-01."

Return ONLY the sentence. No quotes, no prefix, no explanation.`;

  const text = await callGemini(env, GEMINI_INTAKE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  });

  const summary = (text || '').trim().replace(/^["']+|["']+$/g, '').slice(0, 240);
  return { summary };
}

async function suggestTasks(env, payload) {
  const { caseTitle, caseDescription, existingTasks = [] } = payload || {};

  const prompt = `You are a helpful assistant that turns a calendar appointment into a concrete prep/follow-up task list for the person hosting the meeting.

Read the appointment title and description carefully and infer what the meeting is about. Do not assume any specific profession or industry — the user could be a lawyer, realtor, therapist, contractor, consultant, teacher, founder, or anything else. Tailor the tasks to whatever the description actually says.

Appointment title: ${caseTitle || 'Untitled'}
Appointment description: ${caseDescription || '(no description provided)'}
Tasks already tracked: ${existingTasks.length ? existingTasks.join(', ') : 'None yet'}

Suggest 3-6 specific, actionable next steps. Each task should be short (under 8 words), start with a verb, and be directly useful for preparing for or following up on this specific appointment. Do not duplicate tasks that are already tracked. If the description is sparse, suggest reasonable generic prep tasks any professional would do before a client-facing meeting.

Return ONLY a JSON array of task strings, e.g. ["Confirm meeting time", "Draft agenda", "Send prep materials"].`;

  const text = await callGemini(env, GEMINI_INTAKE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    const tasks = JSON.parse(stripJsonFences(text));
    return { tasks: Array.isArray(tasks) ? tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

// --- Stripe billing (test-mode subscription checkout) ---

const STRIPE_INTERVAL_MAP = {
  weekly: { interval: 'week', interval_count: 1 },
  biweekly: { interval: 'week', interval_count: 2 },
  monthly: { interval: 'month', interval_count: 1 },
  quarterly: { interval: 'month', interval_count: 3 },
};

async function stripeRequest(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Worker secret STRIPE_SECRET_KEY is not set');
  }

  const init = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  };

  let url = `https://api.stripe.com${path}`;
  if (params && Object.keys(params).length > 0) {
    const body = encodeStripeForm(params);
    if (method === 'GET') {
      url += `?${body}`;
    } else {
      init.body = body;
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function encodeStripeForm(obj, prefix) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    // Keep empty-string values so callers can explicitly unset Stripe fields
    // (for example: pause_collection="").
    if (value === undefined || value === null) continue;
    const fieldName = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === 'object') {
          parts.push(encodeStripeForm(item, `${fieldName}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fieldName}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(encodeStripeForm(value, fieldName));
    } else {
      parts.push(`${encodeURIComponent(fieldName)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function createBillingCheckout(env, payload) {
  const {
    clientName,
    clientEmail,
    amountCents,
    currency = 'usd',
    interval,
    upfrontRetainerCents,
    eventId,
    successUrl,
    cancelUrl,
    notes,
  } = payload || {};

  if (!clientName) throw new Error('clientName is required');
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  const recurring = STRIPE_INTERVAL_MAP[interval];
  if (!recurring) throw new Error(`Unsupported interval: ${interval}`);

  // 1. Create customer (Stripe dedupes by email on its end — no local cache needed for demo)
  const customer = await stripeRequest(env, 'POST', '/v1/customers', {
    name: clientName,
    email: clientEmail || undefined,
    metadata: {
      sphericalEventId: eventId || '',
      sphericalNotes: (notes || '').slice(0, 450),
    },
  });

  // 2. Create a dedicated product for this client's retainer so Stripe records
  //    per-client billing cleanly in the dashboard.
  const product = await stripeRequest(env, 'POST', '/v1/products', {
    name: `Retainer — ${clientName}`,
    metadata: { sphericalEventId: eventId || '' },
  });

  // 3. Recurring price for the subscription.
  const price = await stripeRequest(env, 'POST', '/v1/prices', {
    product: product.id,
    unit_amount: amountCents,
    currency,
    recurring,
    metadata: {
      sphericalEventId: eventId || '',
      sphericalPriceType: 'recurring',
    },
  });

  // 4. Optional one-time retainer price (billed alongside first subscription invoice).
  let retainerPriceId;
  if (Number.isFinite(upfrontRetainerCents) && upfrontRetainerCents > 0) {
    const retainerPrice = await stripeRequest(env, 'POST', '/v1/prices', {
      product: product.id,
      unit_amount: upfrontRetainerCents,
      currency,
      metadata: {
        sphericalEventId: eventId || '',
        sphericalPriceType: 'retainer',
      },
    });
    retainerPriceId = retainerPrice.id;
  }

  const lineItems = [{ price: price.id, quantity: 1 }];
  if (retainerPriceId) lineItems.push({ price: retainerPriceId, quantity: 1 });

  // 5. Hosted Checkout session in subscription mode.
  const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    customer: customer.id,
    line_items: lineItems,
    success_url: successUrl || 'https://joelngala.github.io/sphericalassistant/?billing=success',
    cancel_url: cancelUrl || 'https://joelngala.github.io/sphericalassistant/?billing=canceled',
    metadata: { sphericalEventId: eventId || '' },
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    customerId: customer.id,
    productId: product.id,
    priceId: price.id,
    retainerPriceId: retainerPriceId || null,
  };
}

async function getBillingSubscription(env, searchParams) {
  const sessionId = searchParams.get('session_id');
  const subscriptionId = searchParams.get('subscription_id');
  const customerId = searchParams.get('customer_id');

  let subId = subscriptionId;

  // If the caller only has the Checkout session ID (the common case before first
  // payment completes), resolve the subscription from there.
  if (!subId && sessionId) {
    const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
    subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) {
      return {
        status: session.payment_status === 'paid' ? 'processing' : 'awaiting_payment',
        checkoutStatus: session.status,
        paymentStatus: session.payment_status,
        subscriptionId: null,
        customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        invoices: [],
      };
    }
  }

  if (!subId) throw new Error('Provide session_id, subscription_id, or customer_id');

  const subscription = await stripeRequest(env, 'GET', `/v1/subscriptions/${subId}`);

  const invoicesPayload = await stripeRequest(env, 'GET', '/v1/invoices', {
    subscription: subId,
    limit: 10,
    expand: ['data.lines.data.price'],
  });

  const invoices = (invoicesPayload?.data || []).map((inv) => {
    const lines = Array.isArray(inv?.lines?.data) ? inv.lines.data : [];
    const retainerLine = lines.find((line) => {
      const price = line?.price;
      if (!price || typeof price !== 'object') return false;
      return price.metadata?.sphericalPriceType === 'retainer';
    });
    const retainerAmount = Number.isFinite(retainerLine?.amount) ? retainerLine.amount : 0;
    return {
      id: inv.id,
      amountPaid: inv.amount_paid,
      amountDue: inv.amount_due,
      currency: inv.currency,
      status: inv.status, // paid | open | uncollectible | void | draft
      includesRetainer: Boolean(retainerLine),
      retainerAmount,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      attempted: inv.attempted,
      attemptCount: inv.attempt_count,
      description: inv.description,
    };
  });

  const retainerInvoices = invoices.filter((inv) => inv.includesRetainer && inv.retainerAmount > 0);
  const retainerRequiredCents = retainerInvoices.reduce((max, inv) => Math.max(max, inv.retainerAmount), 0);
  const retainerPaidCents = retainerInvoices
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.retainerAmount, 0);
  const retainerFailed = retainerInvoices.some((inv) => inv.status === 'uncollectible');
  const retainerOpen = retainerInvoices.some((inv) => inv.status === 'open' || inv.status === 'draft');

  let retainerStatus = 'not_required';
  if (retainerRequiredCents > 0) {
    if (retainerPaidCents >= retainerRequiredCents) {
      retainerStatus = 'paid';
    } else if (retainerFailed) {
      retainerStatus = 'failed';
    } else if (retainerOpen) {
      retainerStatus = 'awaiting_payment';
    } else {
      retainerStatus = 'awaiting_payment';
    }
  }

  return {
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    status: subscription.status, // active | past_due | canceled | unpaid | incomplete | trialing | paused
    currentPeriodEnd: subscription.current_period_end,
    cancelAt: subscription.cancel_at,
    pauseCollection: subscription.pause_collection?.behavior || null,
    latestInvoiceId: subscription.latest_invoice,
    retainer: {
      requiredCents: retainerRequiredCents,
      paidCents: retainerPaidCents,
      status: retainerStatus,
    },
    invoices,
  };
}

async function billingAction(env, payload) {
  const { action, subscriptionId } = payload || {};
  if (!subscriptionId) throw new Error('subscriptionId required');
  if (action === 'cancel') {
    return stripeRequest(env, 'DELETE', `/v1/subscriptions/${subscriptionId}`);
  }
  if (action === 'pause') {
    return stripeRequest(env, 'POST', `/v1/subscriptions/${subscriptionId}`, {
      pause_collection: { behavior: 'mark_uncollectible' },
    });
  }
  if (action === 'resume') {
    return stripeRequest(env, 'POST', `/v1/subscriptions/${subscriptionId}`, {
      pause_collection: '',
    });
  }
  throw new Error(`Unknown billing action: ${action}`);
}
