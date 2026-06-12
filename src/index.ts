// engine
export { compress, policyFor, OMISSION_MARKER } from './engine/index.ts';
export type {
  AppliedTransform,
  CompressMeta,
  CompressResult,
  CompressStats,
  ContentKind,
  Estimator,
  Mode,
  Policy,
  ToolKind,
} from './engine/index.ts';

// tokens
export { cheapEstimator, estimateTokens, tiktokenEstimator } from './tokens/estimate.ts';
export { countTokensExact } from './tokens/exact.ts';

// transcripts
export {
  addUsage,
  aggregateUsage,
  encodeProjectDir,
  findTranscripts,
  readSessionUsage,
} from './claude/transcripts.ts';
export type { SessionUsage, UsageTotals } from './claude/transcripts.ts';

// packs
export { ATOMS, getAtom } from './packs/atoms.ts';
export { atomsForMode, MODE_DESCRIPTIONS } from './packs/modes.ts';
export {
  atomManifest,
  markerBegin,
  MARKER_BEGIN_PREFIX,
  MARKER_END,
  parseAtomManifest,
  renderCursorRules,
  renderMarkedSection,
  renderOutputStyle,
} from './packs/render.ts';
export type {
  AgentName,
  Atom,
  AtomCategory,
  PackMode,
  RenderedArtifact,
} from './packs/types.ts';

// adapters
export {
  adapters,
  getAdapter,
  applyChanges,
  renderChanges,
  claudeCodeAdapter,
  copilotAdapter,
  cursorAdapter,
  agentsMdAdapter,
  createOpencodeAdapter,
  opencodeAdapter,
} from './adapters/index.ts';
export type {
  Adapter,
  AdapterContext,
  AdapterStatus,
  FileChange,
  ModeArg,
} from './adapters/index.ts';

// hook
export { handlePostToolUse } from './hook/post-tool-use.ts';
export type { HookResult } from './hook/post-tool-use.ts';
export { detectHookCommandStyle, resolveHookCommand } from './paths.ts';
export type { HookCommandStyle } from './paths.ts';
