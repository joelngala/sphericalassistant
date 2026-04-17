const GEMINI_MODEL = 'gemini-2.5-pro';
const GEMINI_INTAKE_MODEL = 'gemini-2.5-flash';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://joelngala.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
// Origins that can hit /intake-chat and /intake without being in ALLOWED_ORIGINS —
// always allowed because the intake form is public and meant to be embedded anywhere.
const PUBLIC_INTAKE_ROUTES = new Set(['/intake-chat', '/intake']);

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
        { ok: true, configured: Boolean(env.GEMINI_API_KEY), stripe: Boolean(env.STRIPE_SECRET_KEY) },
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

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: 'Worker secret GEMINI_API_KEY is not set' }, 500, allowedOrigin);
    }

    try {
      const body = await request.json();

      if (url.pathname === '/intake-chat') {
        const result = await intakeChat(env.GEMINI_API_KEY, body);
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
        const result = await analyzeAppointment(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/slides-outline') {
        const result = await generateSlidesOutline(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/doc-outline') {
        const result = await generateDocOutline(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/draft') {
        const result = await generateDraft(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/estimate') {
        const result = await generateEstimate(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/refine-draft') {
        const result = await refineDraft(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/business-insights') {
        const result = await generateBusinessInsights(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/morning-brief') {
        const result = await generateMorningBrief(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/case-chat') {
        const result = await caseChatHandler(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/categorize-document') {
        const result = await categorizeDocument(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/suggest-tasks') {
        const result = await suggestTasks(env.GEMINI_API_KEY, body);
        return jsonResponse(result, 200, allowedOrigin);
      }

      if (url.pathname === '/task-email') {
        const result = await generateTaskEmail(env.GEMINI_API_KEY, body);
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

async function callGemini(apiKey, model, body) {
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

// --- Handlers ---

async function analyzeAppointment(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid analysis JSON');
  }
}

async function generateSlidesOutline(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
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

async function generateDocOutline(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
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

async function generateDraft(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid draft JSON');
  }
}

async function generateTaskEmail(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid task email JSON');
  }
}

async function generateEstimate(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid estimate JSON');
  }
}

async function refineDraft(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid refined draft JSON');
  }
}

async function generateBusinessInsights(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  try {
    return JSON.parse(stripJsonFences(text));
  } catch {
    throw new Error('Gemini returned invalid business insights JSON');
  }
}

async function generateMorningBrief(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
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

async function intakeChat(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_INTAKE_MODEL, {
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

  // Run contact conflict check and Perplexity research in parallel
  const [conflictHit, research] = await Promise.all([
    checkContactConflict(accessToken, answers.opposingParty),
    researchCase(env.PERPLEXITY_API_KEY, answers),
  ]);

  const event = buildCalendarEventPayload({ answers, transcript, summary, firmId, conflictHit, research });

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

  return {
    ok: true,
    eventId: createdEvent.id,
    eventLink: createdEvent.htmlLink,
    urgent: answers?.urgent === 'yes',
    conflictFlagged: Boolean(conflictHit),
    researchFound: Boolean(research?.text),
    receivedAt: new Date().toISOString(),
  };
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

function buildCalendarEventPayload({ answers, transcript, summary, firmId, conflictHit, research }) {
  const urgent = answers.urgent === 'yes';
  const matterLabel = formatMatterLabel(answers.matterType);

  const summaryText = `${urgent ? '[URGENT] ' : ''}New Lead — ${answers.fullName} (${matterLabel})`;

  const now = new Date();
  const { start, end } = pickTentativeSlot(answers.preferredTimes, urgent, now);
  const receivedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const esc = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

async function caseChatHandler(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_MODEL, {
    contents,
    generationConfig: { temperature: 0.4 },
  });

  return { reply: text };
}

async function categorizeDocument(apiKey, payload) {
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

  const text = await callGemini(apiKey, GEMINI_INTAKE_MODEL, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1 },
  });

  const category = text.trim().toLowerCase().replace(/[^a-z-]/g, '');
  const validCategories = categories.split(',').map((c) => c.trim());

  return { category: validCategories.includes(category) ? category : 'other' };
}

async function suggestTasks(apiKey, payload) {
  const { caseTitle, caseDescription, existingTasks = [] } = payload || {};

  const prompt = `You are a helpful assistant that turns a calendar appointment into a concrete prep/follow-up task list for the person hosting the meeting.

Read the appointment title and description carefully and infer what the meeting is about. Do not assume any specific profession or industry — the user could be a lawyer, realtor, therapist, contractor, consultant, teacher, founder, or anything else. Tailor the tasks to whatever the description actually says.

Appointment title: ${caseTitle || 'Untitled'}
Appointment description: ${caseDescription || '(no description provided)'}
Tasks already tracked: ${existingTasks.length ? existingTasks.join(', ') : 'None yet'}

Suggest 3-6 specific, actionable next steps. Each task should be short (under 8 words), start with a verb, and be directly useful for preparing for or following up on this specific appointment. Do not duplicate tasks that are already tracked. If the description is sparse, suggest reasonable generic prep tasks any professional would do before a client-facing meeting.

Return ONLY a JSON array of task strings, e.g. ["Confirm meeting time", "Draft agenda", "Send prep materials"].`;

  const text = await callGemini(apiKey, GEMINI_INTAKE_MODEL, {
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
