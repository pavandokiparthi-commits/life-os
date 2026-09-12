const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Simple .env parser to avoid third-party dependencies
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        const val = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    });
  }
}

loadEnv();

const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

class GroqError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function getTomorrowFromYMD(ymdStr) {
  if (!ymdStr || !/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) return 'unknown';
  const [y, m, d] = ymdStr.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d) + 86400_000;
  const next = new Date(utcMs);
  const nextY = next.getUTCFullYear();
  const nextM = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nextD = String(next.getUTCDate()).padStart(2, '0');
  return `${nextY}-${nextM}-${nextD}`;
}

function buildSystemPrompt(userMessage, context) {
  const currentDate = context?.currentDate || 'unknown';
  const tomorrowDate = getTomorrowFromYMD(currentDate);
  const currentTime = context?.currentTime || 'unknown';
  const timezone = context?.timezone || 'Asia/Kolkata';

  const tasksSummary = context?.tasks && context.tasks.length > 0
    ? context.tasks.map((t) => `- "${t.title}" (id: ${t.id}, duration: ${t.durationMinutes}m, priority: ${t.priority}, status: ${t.status}, date: ${t.date ?? 'undated'})`).join('\n')
    : 'No tasks existing currently.';

  return `You are Life OS's conversational intent parsing agent.
Your job is to understand user natural language requests and output a JSON array of structured actions.

=== CRITICAL PRINCIPLES ===

1. You MUST NOT compute, assign, or invent schedule start/end clock times.
   The deterministic scheduler is solely responsible for deciding what time-of-day a task runs.
   You only determine the CALENDAR DATE (YYYY-MM-DD) of a task, never the clock time.

2. Output ONLY a valid JSON object with the key "actions" containing an array of AIAction objects.
   Do not include markdown code blocks, backticks, or surrounding prose.

=== DATE-AWARENESS RULES ===

The user's current date and time (in timezone ${timezone}) are provided below:
  - currentDate (TODAY): ${currentDate}
  - tomorrowDate (TOMORROW): ${tomorrowDate}
  - currentTime: ${currentTime}
  - timezone: ${timezone}

CRITICAL RULES FOR "date" FIELD IN create_task PAYLOAD:
1. When user explicitly specifies "tomorrow" -> set "date": "${tomorrowDate}".
2. When user explicitly specifies "today" or "tonight" -> set "date": "${currentDate}".
3. When user specifies another date or day of week (e.g. "Monday", "September 26", "26th September", "2026-09-26") -> set "date" to the calculated YYYY-MM-DD string.
4. When user DOES NOT specify any date (e.g. "add pathology for 2 hours", "add gym") -> DO NOT include "date" in the payload (omit it or set to null). An undated task MUST remain undated.
5. Absolute YYYY-MM-DD format MUST be used. Never output relative string literals like "tomorrow" in the date field.

=== CONVERSATION VS ACTION RULES ===

1. DO NOT create tasks for casual chat, greetings, advice questions, or past statements!
   - "Hey", "Hello", "How are you" -> return a "clarification" action with a polite response.
   - "How should I study pathology today?", "Do you think I should study anatomy tomorrow?" -> return a "clarification" action with advice/guidance, NOT a create_task.
   - "I studied anatomy yesterday", "I am tired today" -> return a "clarification" action acknowledging the statement, NOT a create_task.
2. ONLY output create_task when the user explicitly requests adding, scheduling, or creating a task/reminder!
   - "Add anatomy for 1 hour on 26th September" -> create_task
   - "I need to study anatomy tomorrow morning" -> create_task
   - "Remind me to call mom at 8 PM" -> create_task

=== SCHEDULE QUERY BEHAVIOR ===

If the user asks about a specific day's schedule ("What am I doing tomorrow?", "Show me Monday", "What's on the 15th?"):
- Return a "get_schedule" action. The client knows how to look up tasks by date.
- Do not attempt to filter tasks yourself.

=== ALLOWED AI ACTIONS & SCHEMA ===

- create_task: { "type": "create_task", "payload": { "title": string, "durationMinutes": number, "priority": "low"|"medium"|"high", "date"?: "YYYY-MM-DD" } }
  NOTE: Include "date" ONLY when the user mentions a specific day. Omit it entirely for undated tasks.

- complete_task: { "type": "complete_task", "payload": { "taskTitleQuery": string } }
- skip_task:     { "type": "skip_task",     "payload": { "taskTitleQuery": string } }
- delete_task:   { "type": "delete_task",   "payload": { "taskTitleQuery": string } }
- update_task:   { "type": "update_task",   "payload": { "taskTitleQuery": string, "title"?: string, "durationMinutes"?: number, "priority"?: "low"|"medium"|"high" } }
- replan_day:    { "type": "replan_day" }
- get_schedule:  { "type": "get_schedule" }
- get_free_time: { "type": "get_free_time" }
- clarification: { "type": "clarification", "payload": { "question": string } }

=== CLARIFICATION RULE ===

If the user's request is ambiguous (e.g. "complete medicine" and multiple tasks could match),
DO NOT GUESS. Return a "clarification" action with a polite question.

=== CURRENT APP CONTEXT ===

Today's date (user's timezone): ${currentDate}
Current time (user's timezone): ${currentTime}
Timezone: ${timezone}

Existing tasks:
${tasksSummary}

=== USER REQUEST ===

"${userMessage}"

=== OUTPUT FORMAT EXAMPLE ===

{
  "actions": [
    { "type": "create_task", "payload": { "title": "Study", "durationMinutes": 360, "priority": "medium", "date": "${tomorrowDate}" } }
  ]
}`;
}

async function callGroq(userMessage, context) {
  if (!GROQ_API_KEY) {
    throw new GroqError('PROVIDER_AUTH_ERROR', 'GROQ_API_KEY is not set in environment or .env file.');
  }

  const promptText = buildSystemPrompt(userMessage, context);
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const requestPayload = {
    model: GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are Life OS\'s conversational intent parsing agent. Output ONLY a valid JSON object with key "actions" containing an array of AIAction objects.',
      },
      {
        role: 'user',
        content: promptText,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify(requestPayload),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new GroqError('PROVIDER_TIMEOUT', 'Groq API request timed out.');
    }
    throw new GroqError('PROVIDER_UNAVAILABLE', `Network error connecting to Groq: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const status = response.status;
    let errorDetail = '';
    try {
      errorDetail = await response.text();
    } catch (_) {}

    if (status === 429) {
      throw new GroqError('PROVIDER_RATE_LIMITED', 'Groq AI provider rate limit reached.');
    } else if (status === 401 || status === 403) {
      throw new GroqError('PROVIDER_AUTH_ERROR', 'Groq AI provider authentication failed. Please check your GROQ_API_KEY.');
    } else if (status >= 500) {
      throw new GroqError('PROVIDER_UNAVAILABLE', `Groq AI provider service unavailable (HTTP ${status}).`);
    } else {
      throw new GroqError('PROVIDER_UNAVAILABLE', `Groq API returned HTTP ${status}.`);
    }
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new GroqError('PROVIDER_BAD_RESPONSE', `Failed to parse Groq response JSON: ${err.message}`);
  }

  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new GroqError('PROVIDER_BAD_RESPONSE', 'Empty response content received from Groq.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new GroqError('PROVIDER_BAD_RESPONSE', `Failed to parse structured JSON from Groq: ${err.message}`);
  }

  if (!parsed || !Array.isArray(parsed.actions)) {
    throw new GroqError('PROVIDER_BAD_RESPONSE', 'Invalid JSON structure returned by Groq: missing "actions" array.');
  }

  return parsed.actions;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Development Health Check Endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      provider: 'groq',
      model: GROQ_MODEL,
      hasApiKey: Boolean(GROQ_API_KEY),
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/parse-intent') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const userMessage = payload.userMessage;
        const context = payload.context;

        if (!userMessage || typeof userMessage !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing userMessage parameter.' }));
          return;
        }

        const actions = await callGroq(userMessage, context);
        console.log(`[AI] Groq succeeded for request: "${userMessage.substring(0, 40)}..."`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          actions,
          provider: 'groq',
          mode: 'real_ai',
        }));
      } catch (error) {
        const errorCode = error.code || 'PROVIDER_UNAVAILABLE';
        const httpStatus = errorCode === 'PROVIDER_RATE_LIMITED' ? 429 : (errorCode === 'PROVIDER_AUTH_ERROR' ? 401 : 500);

        console.warn(`[AI] Groq failed (${errorCode}): ${error.message}`);
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: {
            code: errorCode,
            provider: 'groq',
            message: error.message || 'Groq provider error',
          },
        }));
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'Endpoint not found.' }));
});

// Export helper logic for testing
module.exports = {
  buildSystemPrompt,
  callGroq,
  GroqError,
  server,
};

// Start listening if executed directly
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIps = getLocalIpAddresses();
    console.log(`\n==================================================`);
    console.log(`[Life OS AI Backend] Server running on port ${PORT}`);
    console.log(`[Life OS AI Backend] Active Provider: Groq`);
    console.log(`[Life OS AI Backend] Configured Model: ${GROQ_MODEL}`);
    console.log(`[Life OS AI Backend] API Key Set: ${GROQ_API_KEY ? 'YES' : 'NO (Set GROQ_API_KEY in .env)'}`);
    console.log(`[Life OS AI Backend] Health check: http://localhost:${PORT}/health`);
    console.log(`--------------------------------------------------`);
    console.log(`Reachable IP Addresses for Physical Device Testing:`);
    console.log(`- Localhost / Emulator: http://10.0.2.2:${PORT}`);
    localIps.forEach((ip) => {
      console.log(`- LAN (Physical Device): http://${ip}:${PORT}`);
    });
    console.log(`==================================================\n`);
  });
}
