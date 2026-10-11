import { LlmError } from '@acentric-llm/contracts';

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function invalidRequest(provider: string | undefined, message: string): LlmError {
  return new LlmError(message, { kind: 'invalid_request', provider });
}

export function invalidResponse(
  provider: string,
  message: string,
  nativeError?: unknown,
): LlmError {
  return new LlmError(message, { kind: 'invalid_response', provider, nativeError });
}

/** Refuses `fields` keys that the adapter itself sets on the same object. */
export function refuseOwned(
  provider: string,
  fields: unknown,
  owned: readonly string[],
  where: string,
): JsonRecord {
  if (fields === undefined) return {};
  if (!isRecord(fields))
    throw invalidRequest(provider, `${where}.providerOptions must be an object.`);
  for (const key of owned) {
    if (key in fields) {
      throw invalidRequest(
        provider,
        `${where}.providerOptions.${key} is set by the request; set it there.`,
      );
    }
  }
  return fields;
}

/** A nonnegative safe integer, or undefined. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Reads caller credentials as an object. Messages name fields, never values. */
export function credentialFields(provider: string, label: string, value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw invalidRequest(provider, `credentials must be an object with your ${label} API key.`);
  }
  return value;
}

export function requiredCredential(provider: string, fields: JsonRecord, name: string): string {
  const value = fields[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidRequest(provider, `credentials.${name} must be a nonempty string.`);
  }
  return value.trim();
}

export function optionalCredential(
  provider: string,
  fields: JsonRecord,
  name: string,
): string | undefined {
  return fields[name] === undefined ? undefined : requiredCredential(provider, fields, name);
}
