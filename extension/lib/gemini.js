// Gemini API client for the extension

export async function callCopilot(apiKey, prompt, context, schema, chatHistory = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  // Build system instruction
  const middleClause = context.middleName ? `, Middle Name: ${context.middleName}` : '';
  let systemInstruction = `You are the Spherical Assistant Copilot. Your job is to help the user by interacting with the current webpage.
You are aware of the Active Matter: ${context.matterName} (First Name: ${context.firstName}${middleClause}, Last Name: ${context.lastName}).

CRITICAL: When filling name fields, the SURNAME is "${context.lastName}". Never use the middle name as the surname.

If the user asks you to fill a form, you MUST use the fill_form tool. I will provide you with the form schema.
Map the values you know about the active matter into the schema uids.
If the user asks you to scrape a page, you MUST use the scrape_page tool.

Return helpful text.`;

  // Build the tools
  const tools = [
    {
      functionDeclarations: [
        {
          name: "fill_form",
          description: "Fills the form on the current page with the provided values.",
          parameters: {
            type: "OBJECT",
            properties: {
              fields: {
                type: "ARRAY",
                description: "A list of form fields to fill",
                items: {
                  type: "OBJECT",
                  properties: {
                    uid: { type: "STRING", description: "The uid of the input field from the schema" },
                    value: { type: "STRING", description: "The text value to fill into the input field" }
                  },
                  required: ["uid", "value"]
                }
              }
            },
            required: ["fields"]
          }
        },
        {
          name: "scrape_page",
          description: "Scrapes the current page for text content.",
          parameters: {
            type: "OBJECT",
            properties: {
              reason: {
                type: "STRING",
                description: "Why you are scraping the page"
              }
            }
          }
        }
      ]
    }
  ];

  // If we have a schema, inject it into the prompt so Gemini knows what to fill
  let finalPrompt = prompt;
  if (schema) {
    finalPrompt += `\n\nHere is the form schema for the current page:\n${JSON.stringify(schema, null, 2)}`;
  }

  // Build contents array
  const contents = [];
  
  // Add history
  for (const msg of chatHistory) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    });
  }
  
  // Add current prompt
  contents.push({
    role: "user",
    parts: [{ text: finalPrompt }]
  });

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    tools,
    toolConfig: {
      functionCallingConfig: { mode: "AUTO" }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Gemini API Error');
  }

  const candidate = data.candidates?.[0];
  if (!candidate) return { text: "No response." };

  const part = candidate.content.parts[0];
  if (part.functionCall) {
    return {
      functionCall: {
        name: part.functionCall.name,
        args: part.functionCall.args
      }
    };
  }

  return { text: part.text || "I'm not sure." };
}
