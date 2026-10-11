import { ROUTES, type ModelInfo, type ModelsResponse } from '@acentric-llm/contracts';
import { complete, MODELS, parseCompletionRequest } from '@acentric-llm/providers';
import { errorResponse, HttpError, json, preflight, readJson } from './http.ts';

const MODELS_RESPONSE: ModelsResponse = {
  models: Object.values(MODELS).flat() as readonly ModelInfo[],
};

/** Stateless: nothing is stored, and request bodies (credentials, content, tools) are never logged. */
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      switch (pathname) {
        case ROUTES.complete:
          if (request.method === 'OPTIONS') return preflight('POST');
          allow(request, 'POST');
          return json(
            await complete(parseCompletionRequest(await readJson(request)), {
              signal: request.signal,
            }),
          );
        case ROUTES.models:
          if (request.method === 'OPTIONS') return preflight('GET');
          allow(request, 'GET');
          return json(MODELS_RESPONSE);
        default:
          throw new HttpError(404, `No route for ${pathname}.`);
      }
    } catch (error) {
      return errorResponse(error);
    }
  },
};

function allow(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, `${request.method} is not allowed; use ${method}.`, {
      allow: `${method}, OPTIONS`,
    });
  }
}
