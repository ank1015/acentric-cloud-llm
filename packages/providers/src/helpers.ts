// The pure part of the package: the readers over an assistant message and the
// tool-result builder. Nothing here reaches fetch, so it loads where only
// ECMAScript is available, such as a reducer.

export {
  outputText,
  refusals,
  reasoningSummary,
  toolCalls,
  pendingToolCalls,
  requestMessages,
  type TextOptions,
} from './extract.ts';
export { toolResult, type ToolResultOptions } from './tool-results.ts';
