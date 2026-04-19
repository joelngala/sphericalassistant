// Exercises the exact callClaude translation the worker uses.
// Feeds it a Gemini-style body and confirms Claude returns parseable JSON.
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY first');
  process.exit(1);
}

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 4096;

async function callClaude(apiKey, body) {
  const rawContents = Array.isArray(body?.contents) ? body.contents : [];
  const messages = [];
  for (const entry of rawContents) {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    const content = (entry?.parts || []).map((p) => p?.text || '').join('').trim();
    if (!content) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const wantsJson = body?.generationConfig?.responseMimeType === 'application/json';
  const temperature =
    typeof body?.generationConfig?.temperature === 'number' ? body.generationConfig.temperature : 0.3;

  const requestBody = { model: CLAUDE_MODEL, max_tokens: CLAUDE_MAX_TOKENS, temperature, messages };
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
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude failed');
  return (payload?.content || []).map((p) => p?.text || '').join('').trim();
}

// Simulates what suggestTasks sends to callGemini
const geminiStyleBody = {
  contents: [
    {
      role: 'user',
      parts: [
        {
          text:
            'Suggest 3 specific tasks for preparing for a client appointment titled "Contract review with Acme Corp". ' +
            'Return ONLY a JSON array of task strings, e.g. ["Confirm meeting time", "Draft agenda"].',
        },
      ],
    },
  ],
  generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
};

const started = Date.now();
const text = await callClaude(apiKey, geminiStyleBody);
const elapsed = Date.now() - started;

console.log(`[ok] Claude responded in ${elapsed}ms`);
console.log(`[ok] Raw text: ${text}`);

const stripped = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
const parsed = JSON.parse(stripped);
if (!Array.isArray(parsed)) throw new Error('Expected an array');
console.log(`[ok] Parsed ${parsed.length} tasks:`, parsed);
console.log('[pass] Fallback translation layer works end-to-end.');
