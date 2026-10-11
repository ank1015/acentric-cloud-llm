import type { OpenAiNativeResponse } from '@acentric-llm/contracts';
import { OPENAI_MODELS } from '../catalog/openai.ts';
import { dataUrl } from '../formats/responses/request.ts';
import { createResponsesProvider } from '../formats/responses/provider.ts';
import type { ResponsesProfile } from '../formats/responses/profile.ts';
import { credentialFields, optionalCredential, requiredCredential } from '../shared.ts';

/** Price multipliers for the tier that served a response. Other tiers' rates are not documented. */
const TIER_MULTIPLIERS: Readonly<Record<string, number>> = { default: 1, flex: 0.5 };

export const openAiProfile: ResponsesProfile<'openai'> = {
  provider: 'openai',
  label: 'OpenAI',
  url: 'https://api.openai.com/v1/responses',
  systemRole: 'developer',
  catalog: OPENAI_MODELS,
  fileData: dataUrl,
  fileIds: true,
  customTools: true,
  // OpenAI-only echoes of the request, beyond the format's.
  echoFields: ['prompt', 'prompt_cache_retention', 'prompt_cache_options'],

  credentials(value) {
    const fields = credentialFields('openai', 'OpenAI', value);
    const organization = optionalCredential('openai', fields, 'organization');
    const project = optionalCredential('openai', fields, 'project');
    return {
      apiKey: requiredCredential('openai', fields, 'apiKey'),
      ...(organization !== undefined ? { organization } : {}),
      ...(project !== undefined ? { project } : {}),
    };
  },

  headers({ apiKey, organization, project }) {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(organization !== undefined ? { 'openai-organization': organization } : {}),
      ...(project !== undefined ? { 'openai-project': project } : {}),
    };
  },

  priceMultiplier(native: OpenAiNativeResponse) {
    return TIER_MULTIPLIERS[native.service_tier ?? 'default'];
  },

  classifyError({ status, message }) {
    // Some context-window errors arrive without the context_length_exceeded code.
    if (
      status === 400 &&
      message &&
      /exceeds the context window|maximum context length/i.test(message)
    ) {
      return { kind: 'context_overflow' };
    }
    return undefined;
  },
};

export const openai = createResponsesProvider(openAiProfile);
