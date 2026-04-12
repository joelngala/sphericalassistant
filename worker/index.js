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
        { ok: true, configured: Boolean(env.GEMINI_API_KEY) },
        200,
        allowedOrigin
      );
    }

    if (!allowedOrigin) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, null);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, allowedOrigin);
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

      if (url.pathname === '/analyze') {
        const result = await analyzeAppointment(env.GEMINI_API_KEY, body);
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
  'bestContact',
  'matterType',
  'description',
  'jurisdictionState',
  'jurisdictionCounty',
  'urgent',
  'preferredTimes',
  'howHeard',
];

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

  const systemPrompt = `You are a warm, professional legal intake assistant for ${firmName}. Your job is to collect enough information from a prospective client so the attorney can evaluate the matter and schedule a free consultation.

CRITICAL RULES:
- You are NOT an attorney. Never give legal advice, opinions on the merits of the case, likelihood of success, or dollar estimates.
- If the client asks for advice, politely say the attorney will discuss it during the consultation.
- Be warm and empathetic, especially for sensitive matters (family, criminal, domestic violence, immigration enforcement).
- Ask ONE question at a time. Keep replies short — 1-3 sentences. Sound human, not like a form.
- Adapt follow-ups to the matter type. For a PI case, ask about the incident date and injuries. For family, ask whether anything has been filed. For criminal, ask what stage they're at. Do NOT use a rigid checklist.
- If the client mentions urgency (hearing, arrest, restraining order, hard deadline), set urgent="yes" and probe briefly for the deadline.
- When extracting the matterType field, use one of: family, criminal, personal-injury, immigration, estate, business, employment, other.
- When extracting urgent, use "yes" or "no".
- Do NOT ask about opposing party / jurisdictionCounty / howHeard until the core matter is understood.
- If the client gives a vague answer, ask a gentle follow-up before moving on.
- You may offer quick-reply chips for common-answer questions (matter type, urgency yes/no, contact method, how they heard about us). For free-text questions (description, name, phone), return an empty quickReplies array.

REQUIRED FIELDS (you must collect ALL of these before setting done=true):
${INTAKE_REQUIRED_FIELDS.map((f) => `- ${f}`).join('\n')}

OPTIONAL (nice to have, ask only if naturally relevant):
- matterDetail: subtype of the matter (e.g., "divorce", "car accident")
- opposingParty: name of the other side (if applicable)
- urgencyReason: what the deadline is (only if urgent="yes")

CURRENT STATE OF COLLECTED ANSWERS:
${answersJson}

STILL MISSING: ${missing.length ? missing.join(', ') : '(none — you can wrap up)'}

CONVERSATION SO FAR:
${transcript || '(no messages yet — this is your opening message)'}

OUTPUT INSTRUCTIONS:
Return a JSON object with EXACTLY this shape:
{
  "reply": "Your next message to the client. Warm, short, one question at a time. If this is the first message (no conversation yet), greet them and ask for their full name.",
  "quickReplies": ["optional", "array", "of", "suggested", "replies"],
  "updatedAnswers": { ...full answers object with any new info extracted from the most recent client message merged in. Preserve existing values unless the client corrected them. },
  "done": false,
  "summary": "(only when done=true) A 2-3 sentence summary of the matter for the attorney."
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
  // Enforce server-side truth about done: only done if every required field is filled
  const stillMissing = INTAKE_REQUIRED_FIELDS.filter((f) => {
    const v = updatedAnswers?.[f];
    return v === undefined || v === null || v === '';
  });
  const serverDone = stillMissing.length === 0 && parsed.done === true;

  return {
    reply: parsed.reply || 'Sorry, could you say that again?',
    quickReplies: Array.isArray(parsed.quickReplies) ? parsed.quickReplies : [],
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

  const accessToken = await exchangeRefreshToken(env, refreshToken);

  const conflictHit = await checkContactConflict(accessToken, answers.opposingParty);

  const event = buildCalendarEventPayload({ answers, transcript, summary, firmId, conflictHit });

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
    receivedAt: new Date().toISOString(),
  };
}

function buildCalendarEventPayload({ answers, transcript, summary, firmId, conflictHit }) {
  const urgent = answers.urgent === 'yes';
  const matterLabel = formatMatterLabel(answers.matterType);

  const summaryText = `${urgent ? '[URGENT] ' : ''}New Lead — ${answers.fullName} (${matterLabel})`;

  const now = new Date();
  const { start, end } = pickTentativeSlot(answers.preferredTimes, urgent, now);

  const descriptionLines = [];
  if (conflictHit) {
    descriptionLines.push(`⚠️ POSSIBLE CONFLICT: matched existing contact "${conflictHit}". Verify before proceeding.`);
    descriptionLines.push('');
  }
  descriptionLines.push('=== NEW INTAKE LEAD ===');
  descriptionLines.push(`Source: intake-chatbot`);
  if (firmId) descriptionLines.push(`Firm ID: ${firmId}`);
  descriptionLines.push(`Received: ${now.toISOString()}`);
  descriptionLines.push('');
  if (summary) {
    descriptionLines.push('--- Summary ---');
    descriptionLines.push(summary);
    descriptionLines.push('');
  }
  descriptionLines.push('--- Client ---');
  descriptionLines.push(`Name: ${answers.fullName}`);
  descriptionLines.push(`Phone: ${answers.phone || '(not provided)'}`);
  descriptionLines.push(`Email: ${answers.email}`);
  descriptionLines.push(`Preferred contact: ${answers.bestContact || '(not specified)'}`);
  descriptionLines.push('');
  descriptionLines.push('--- Matter ---');
  descriptionLines.push(`Type: ${matterLabel}`);
  if (answers.matterDetail) descriptionLines.push(`Detail: ${answers.matterDetail}`);
  descriptionLines.push(`Jurisdiction: ${[answers.jurisdictionCounty, answers.jurisdictionState].filter(Boolean).join(', ')}`);
  if (answers.opposingParty) descriptionLines.push(`Opposing party: ${answers.opposingParty}`);
  descriptionLines.push('');
  descriptionLines.push('--- Description ---');
  descriptionLines.push(answers.description || '(none)');
  descriptionLines.push('');
  descriptionLines.push('--- Urgency ---');
  descriptionLines.push(urgent ? `URGENT: ${answers.urgencyReason || 'yes'}` : 'Not urgent');
  descriptionLines.push('');
  descriptionLines.push('--- Scheduling ---');
  descriptionLines.push(`Preferred times: ${answers.preferredTimes || '(not specified)'}`);
  descriptionLines.push(`Source: ${answers.howHeard || '(not specified)'}`);
  descriptionLines.push('');
  if (Array.isArray(transcript) && transcript.length) {
    descriptionLines.push('--- Full conversation ---');
    for (const msg of transcript) {
      descriptionLines.push(`${msg.role === 'bot' ? 'Assistant' : 'Client'}: ${msg.text}`);
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
    description: descriptionLines.join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    colorId: urgent ? '11' : '5', // 11=tomato/red, 5=banana/yellow
    transparency: 'transparent', // doesn't block the owner's calendar
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
  return { connected: Boolean(token) };
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
