import { FIREWORKS_MODELS } from '../catalog/fireworks.ts';
import { createResponsesProvider } from '../formats/responses/provider.ts';
import type { ResponsesProfile } from '../formats/responses/profile.ts';
import { credentialFields, requiredCredential } from '../shared.ts';

export const fireworksProfile: ResponsesProfile<'fireworks'> = {
  provider: 'fireworks',
  label: 'Fireworks',
  url: 'https://api.fireworks.ai/inference/v1/responses',
  systemRole: 'system',
  catalog: FIREWORKS_MODELS,
  // Fireworks drops `input_file` parts without an error, has no file storage,
  // and accepts custom tools that its models never call.
  fileIds: false,
  customTools: false,
  // Fireworks echoes the requested reasoning settings; it reports nothing new there.
  echoFields: ['reasoning'],
  // As for OpenAI: reported on output items, not taken back.
  outputOnlyFields: ['created_by'],
  messageModel: 'request',

  credentials(value) {
    const fields = credentialFields('fireworks', 'Fireworks', value);
    return { apiKey: requiredCredential('fireworks', fields, 'apiKey') };
  },

  headers({ apiKey }) {
    return { authorization: `Bearer ${apiKey}` };
  },

  // The response does not say which tier served it. Standard rates hold unless
  // the request asked for another tier, whose rates differ per model.
  priceMultiplier(_native, request) {
    const tier = request.providerOptions?.service_tier;
    return tier === undefined || tier === null || tier === 'default' ? 1 : undefined;
  },

  classifyError({ status, message }) {
    // An unknown, expired or unstored previous response: a bare 404 `{ detail }`.
    if (status === 404 && message && /^previous response not found/i.test(message)) {
      return { kind: 'not_found', param: 'previous_response_id' };
    }
    // "prompt is too long: N tokens exceeds maximum context length of M", code invalid_request_error.
    if (message && /prompt is too long|exceeds maximum context length/i.test(message)) {
      return { kind: 'context_overflow' };
    }
    // Plan or spending limits.
    if (status === 402) return { kind: 'quota_exceeded' };
    // A suspended account.
    if (status === 412) return { kind: 'auth' };
    return undefined;
  },
};

export const fireworks = createResponsesProvider(fireworksProfile);
