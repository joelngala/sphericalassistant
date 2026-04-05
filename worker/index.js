const GEMINI_MODEL = 'gemini-2.5-pro';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://joelngala.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = getAllowedOrigin(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(allowedOrigin),
      });
    }

    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
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
      const url = new URL(request.url);
      const body = await request.json();

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
  const { type, appointment, client, businessName } = payload;

  const typeInstructions = {
    confirmation:
      'Draft a confirmation email. Confirm the date, time, service, and location. Ask the client to reply if any changes are needed. Be warm and professional.',
    reminder:
      'Draft a reminder email for an appointment happening soon. Keep it brief and friendly. Include the key details: date, time, service, location.',
    followup:
      'Draft a follow-up email sent after the service was completed. Thank the client, ask if everything met their expectations, invite them to leave a review, and mention rebooking.',
  };

  const prompt = `You are a professional email assistant for an in-home service business.

Business: ${businessName || 'Our Company'}
Client: ${client?.name || 'Valued Client'} (${client?.email || ''})
Service: ${appointment?.summary || 'Service appointment'}
Date: ${appointment?.start || 'Upcoming'}
Location: ${appointment?.location || ''}

${typeInstructions[type] || typeInstructions.confirmation}

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
