import { ANTHROPIC_DEFAULT_MAX_TOKENS, ANTHROPIC_MODELS } from '../catalog/anthropic.ts';
import type { MessagesProfile } from '../formats/anthropic/profile.ts';
import { createMessagesProvider } from '../formats/anthropic/provider.ts';
import { credentialFields, optionalCredential, requiredCredential } from '../shared.ts';

export const anthropicProfile: MessagesProfile<'anthropic'> = {
  provider: 'anthropic',
  label: 'Anthropic',
  url: 'https://api.anthropic.com/v1/messages',
  catalog: ANTHROPIC_MODELS,
  defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,

  credentials(value) {
    const fields = credentialFields('anthropic', 'Anthropic', value);
    const workspaceId = optionalCredential('anthropic', fields, 'workspaceId');
    return {
      apiKey: requiredCredential('anthropic', fields, 'apiKey'),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
  },

  headers({ apiKey, workspaceId }) {
    return {
      'x-api-key': apiKey,
      ...(workspaceId !== undefined ? { 'anthropic-workspace-id': workspaceId } : {}),
    };
  },
};

export const anthropic = createMessagesProvider(anthropicProfile);
