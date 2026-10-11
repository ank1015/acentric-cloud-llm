import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LLM_ERROR_KINDS, LlmError, type ErrorResponse } from '../src/index.ts';

test('retryable defaults by kind and can be overridden', () => {
  assert.equal(new LlmError('slow down', { kind: 'rate_limited' }).retryable, true);
  assert.equal(new LlmError('bad key', { kind: 'auth' }).retryable, false);
  assert.equal(
    new LlmError('upstream 501', { kind: 'provider_error', retryable: false }).retryable,
    false,
  );
});

test('every kind has a default', () => {
  for (const kind of LLM_ERROR_KINDS) {
    assert.equal(typeof new LlmError(kind, { kind }).retryable, 'boolean');
  }
});

test('round-trips through JSON without native detail or the stack', () => {
  const error = new LlmError('Previous response not found.', {
    kind: 'not_found',
    provider: 'openai',
    providerParam: 'previous_response_id',
    httpStatus: 404,
    requestId: 'req_1',
    nativeError: { raw: 'body' },
  });

  const body: ErrorResponse = JSON.parse(JSON.stringify({ error }));
  assert.deepEqual(body, {
    error: {
      message: 'Previous response not found.',
      kind: 'not_found',
      retryable: false,
      provider: 'openai',
      providerParam: 'previous_response_id',
      httpStatus: 404,
      requestId: 'req_1',
    },
  });

  const restored = LlmError.fromJSON(body.error);
  assert.ok(restored instanceof LlmError);
  assert.equal(restored.name, 'LlmError');
  assert.equal(restored.nativeError, undefined);
  assert.deepEqual(restored.toJSON(), body.error);
});

test('absent options stay absent', () => {
  const error = new LlmError('x', { kind: 'timeout', provider: undefined });
  assert.equal(Object.hasOwn(error, 'provider'), false);
  assert.deepEqual(Object.keys(error.toJSON()), ['message', 'kind', 'retryable']);
});

test('an unknown kind from a newer gateway is kept and not retried', () => {
  const restored = LlmError.fromJSON({
    message: 'new',
    kind: 'brand_new' as never,
    retryable: true,
  });
  assert.equal(restored.kind, 'brand_new');
  assert.equal(restored.retryable, true);
  assert.equal(new LlmError('new', { kind: 'brand_new' as never }).retryable, false);
});

test('is() recognizes errors from another copy of the package', () => {
  const foreign = Object.assign(new Error('x'), { name: 'LlmError', kind: 'timeout' });
  assert.equal(LlmError.is(foreign), true);
  assert.equal(LlmError.is(new LlmError('x', { kind: 'timeout' })), true);
  assert.equal(LlmError.is(new Error('x')), false);
  assert.equal(LlmError.is({ name: 'LlmError', kind: 'timeout' }), false);
});
