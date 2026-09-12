// Backend Unit Test Suite for Groq AI Integration (Mocked responses, zero quota usage)
const assert = require('assert');
const http = require('http');

// Setup mock env BEFORE requiring index.js
process.env.GROQ_API_KEY = 'mock_groq_api_key_test_only';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';

const { buildSystemPrompt, callGroq, GroqError, server } = require('./index.js');

let testsPassed = 0;
let testsFailed = 0;

function runAssert(condition, testName) {
  if (condition) {
    console.log(`✓ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${testName}`);
    testsFailed++;
  }
}

// Global fetch override helper
const originalFetch = global.fetch;

function mockFetch(mockFn) {
  global.fetch = mockFn;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

async function runTests() {
  console.log('--- Starting Groq Backend Unit Tests (Mocked) ---\n');

  // Test 1: Missing API key handling
  process.env.GROQ_API_KEY = '';
  try {
    await callGroq('test message', {});
    runAssert(false, '1. Missing GROQ_API_KEY should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_AUTH_ERROR',
      '1. Missing GROQ_API_KEY throws PROVIDER_AUTH_ERROR'
    );
  }
  process.env.GROQ_API_KEY = 'mock_groq_api_key_test_only';

  // Test 2: Successful Groq response
  mockFetch(async (url, options) => {
    assert.strictEqual(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.strictEqual(options.headers['Authorization'], 'Bearer mock_groq_api_key_test_only');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.model, 'openai/gpt-oss-120b');

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                actions: [
                  {
                    type: 'create_task',
                    payload: { title: 'Anatomy', durationMinutes: 60, priority: 'high', date: '2026-09-13' },
                  },
                ],
              }),
            },
          },
        ],
      }),
    };
  });

  try {
    const actions = await callGroq('Study anatomy tomorrow for 1 hour', { currentDate: '2026-09-12' });
    runAssert(
      Array.isArray(actions) && actions.length === 1 && actions[0].payload.title === 'Anatomy',
      '2. Successful Groq response returns valid AIAction array'
    );
  } catch (err) {
    runAssert(false, `2. Successful Groq response threw error: ${err.message}`);
  }

  // Test 3: HTTP 429 Rate Limited Error
  mockFetch(async () => ({
    ok: false,
    status: 429,
    text: async () => 'Rate limit exceeded',
  }));

  try {
    await callGroq('Test 429', {});
    runAssert(false, '3. HTTP 429 should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_RATE_LIMITED',
      '3. HTTP 429 is normalized to PROVIDER_RATE_LIMITED'
    );
  }

  // Test 4: HTTP 401 Auth Error
  mockFetch(async () => ({
    ok: false,
    status: 401,
    text: async () => 'Invalid API key',
  }));

  try {
    await callGroq('Test 401', {});
    runAssert(false, '4. HTTP 401 should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_AUTH_ERROR',
      '4. HTTP 401 is normalized to PROVIDER_AUTH_ERROR'
    );
  }

  // Test 5: HTTP 500 Server Error
  mockFetch(async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal server error',
  }));

  try {
    await callGroq('Test 500', {});
    runAssert(false, '5. HTTP 500 should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_UNAVAILABLE',
      '5. HTTP 500 is normalized to PROVIDER_UNAVAILABLE'
    );
  }

  // Test 6: Timeout Error
  mockFetch(async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  });

  try {
    await callGroq('Test Timeout', {});
    runAssert(false, '6. AbortError should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_TIMEOUT',
      '6. Timeout is normalized to PROVIDER_TIMEOUT'
    );
  }

  // Test 7: Malformed JSON output from Groq
  mockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Invalid Non-JSON response' } }],
    }),
  }));

  try {
    await callGroq('Test Bad JSON', {});
    runAssert(false, '7. Bad JSON response should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_BAD_RESPONSE',
      '7. Malformed JSON response is normalized to PROVIDER_BAD_RESPONSE'
    );
  }

  // Test 8: Missing "actions" key in output JSON
  mockFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ wrongKey: [] }) } }],
    }),
  }));

  try {
    await callGroq('Test Missing Actions', {});
    runAssert(false, '8. Missing actions array should throw error');
  } catch (err) {
    runAssert(
      err instanceof GroqError && err.code === 'PROVIDER_BAD_RESPONSE',
      '8. Missing actions key is normalized to PROVIDER_BAD_RESPONSE'
    );
  }

  restoreFetch();

  // Test 9: HTTP Server GET /health
  const PORT = 3999;
  await new Promise((resolve) => server.listen(PORT, resolve));

  await new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}/health`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          runAssert(
            res.statusCode === 200 && json.ok === true && json.provider === 'groq' && json.model === 'openai/gpt-oss-120b',
            '9. GET /health endpoint returns correct Groq configuration status'
          );
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  server.close();

  console.log(`\n--- GROQ BACKEND TEST RESULTS: ${testsPassed} Passed, ${testsFailed} Failed ---`);
  if (testsFailed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
