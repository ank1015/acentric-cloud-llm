import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LlmError } from '@acentric-llm/contracts';
import { estimateCost, parseCompletionRequest, PROVIDERS, MODELS } from '../src/index.ts';

test('every provider has a definition and a catalog', () => {
  assert.deepEqual(Object.keys(PROVIDERS), ['openai', 'fireworks', 'anthropic', 'openrouter']);
  for (const provider of ['openai', 'fireworks', 'anthropic', 'openrouter'] as const) {
    assert.equal(PROVIDERS[provider].provider, provider);
    assert.ok(MODELS[provider].length > 0);
    for (const model of MODELS[provider]) assert.equal(model.provider, provider);
    const ids = MODELS[provider].map((model) => model.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('parseCompletionRequest checks the envelope and clamps the timeout', () => {
  const ok = parseCompletionRequest({
    provider: 'openai',
    credentials: { apiKey: 'sk' },
    model: 'gpt-7-unreleased',
    messages: [{ role: 'user', content: [] }],
    timeoutMs: 999_999_999,
  });
  assert.equal(ok.model, 'gpt-7-unreleased');
  assert.equal(ok.timeoutMs, 15 * 60 * 1000);

  const bad: [unknown, RegExp][] = [
    [null, /JSON object/],
    [{ provider: 'nope' }, /provider must be one of: openai/],
    [{ provider: 'openai', model: 'm', messages: [] }, /credentials are required/],
    [{ provider: 'openai', credentials: {}, model: '', messages: [] }, /model must be/],
    [
      { provider: 'openai', credentials: {}, model: 'm', messages: [{ role: 'robot' }] },
      /known role/,
    ],
    [
      { provider: 'openai', credentials: {}, model: 'm', messages: [], providerOptions: [] },
      /providerOptions must be an object/,
    ],
  ];
  for (const [value, message] of bad) {
    assert.throws(
      () => parseCompletionRequest(value),
      (error: LlmError) => error.kind === 'invalid_request' && message.test(error.message),
    );
  }
});

test('credentials are checked without echoing values', () => {
  assert.throws(
    () => PROVIDERS.openai.credentials({ apiKey: '  ', project: 'p' }),
    (error: LlmError) => error.message === 'credentials.apiKey must be a nonempty string.',
  );
  assert.deepEqual(PROVIDERS.openai.credentials({ apiKey: ' sk ' }), { apiKey: 'sk' });
});

test('estimateCost uses the long-context tier and refuses to guess', () => {
  const pricing = {
    base: { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
    tiers: [{ aboveInputTokens: 272_000, cost: { input: 4, cacheRead: 0.2, output: 15 } }],
  };
  const long = estimateCost(
    { totalInput: 300_000, input: 300_000, output: 1000, cacheRead: 0 },
    pricing,
    1,
  );
  assert.equal(long?.input, (300_000 * 4) / 1e6);
  assert.equal(long?.output, (1000 * 15) / 1e6);
  // Cache writes above the threshold have no published rate.
  assert.equal(
    estimateCost(
      { totalInput: 300_000, input: 290_000, output: 1, cacheRead: 0, cacheWrite: 10_000 },
      pricing,
      1,
    ),
    undefined,
  );
  assert.equal(estimateCost({ totalInput: 10, output: 1 }, pricing, 1), undefined);
  assert.equal(
    estimateCost({ totalInput: 10, input: 10, output: 1 }, pricing, undefined),
    undefined,
  );
});
