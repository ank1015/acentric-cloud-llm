/** A JSON value, as carried by requests, responses and tool arguments. */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

export type JsonArray = readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * Fields merged as is into the provider's own block for a shared shape, such as
 * Anthropic `cache_control` on a content part or OpenAI `detail` on an image.
 * Documented per provider; the adapter never interprets them.
 */
export type ProviderFields = Readonly<Record<string, unknown>>;

/** The application's own attributes. Never sent to a provider. */
export type Metadata = Readonly<Record<string, unknown>>;
