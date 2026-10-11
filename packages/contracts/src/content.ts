import type { Metadata, ProviderFields } from './json.ts';

/** Where an image or file comes from. */
export type MediaSource =
  | { readonly type: 'url'; readonly url: string }
  | {
      readonly type: 'base64';
      /** IANA media type, e.g. `image/png` or `application/pdf`. */
      readonly mediaType: string;
      readonly data: string;
    }
  | {
      /** A file in the provider's own storage. Works only with the provider that issued it. */
      readonly type: 'file_id';
      readonly id: string;
    };

interface PartBase {
  /** Merged into the provider's block for this part; see `ProviderFields`. */
  readonly providerOptions?: ProviderFields;
  readonly metadata?: Metadata;
}

export interface TextContent extends PartBase {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageContent extends PartBase {
  readonly type: 'image';
  readonly source: MediaSource;
}

/** A document such as a PDF. */
export interface FileContent extends PartBase {
  readonly type: 'file';
  readonly source: MediaSource;
  readonly filename?: string;
}

/** Content of user messages and tool results. */
export type ContentPart = TextContent | ImageContent | FileContent;
