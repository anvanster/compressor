import { createCompressorPlugin } from './hook/opencode.ts';

// OpenCode plugin entry, bundled self-contained to dist/opencode-plugin.js
// (esbuild, ESM, NO shebang banner — OpenCode imports plugin files as
// modules from .opencode/plugins/ / ~/.config/opencode/plugins/; they are
// not executables, and npm import resolution inside OpenCode's plugin
// runtime is not relied on).
//
// Plugin module format verified from https://opencode.ai/docs/plugins/ and
// the loader source (sst/opencode packages/opencode/src/plugin/index.ts),
// fetched 2026-06-12:
//
//   export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
//     return {
//       // Hook implementations
//     }
//   }
//
// The loader calls EVERY export of the module as a plugin function and
// throws TypeError("Plugin export is not a function") on anything else, so
// this module exports ONLY functions.
//
// Emitted-file anatomy — the adapter (src/adapters/opencode.ts) installs
// this bundle with a two-line prologue:
//
//   // <!-- compressor:begin mode=<mode> v=1 -->   ← ownership + mode marker
//   const COMPRESSOR_MODE = '<mode>';              ← module-scoped mode const
//   <this bundle>                                  ← reads it via typeof below
//
// The `typeof COMPRESSOR_MODE` guard reads that const when the prologue is
// present (same module scope, declared before this code runs); esbuild
// leaves the free identifier untouched, and on the raw bundle — no prologue
// — `typeof` on the undeclared name is safely 'undefined', so the default
// mode ('optimized') applies. No tail is appended: the default plugin below
// self-instantiates from the prologue const, which keeps the emitted file
// independent of esbuild's internal symbol naming.

declare const COMPRESSOR_MODE: unknown;

function prologueMode(): unknown {
  try {
    return typeof COMPRESSOR_MODE === 'string' ? COMPRESSOR_MODE : undefined;
  } catch {
    // FAIL-OPEN: any host-side evaluation surprise falls back to the default.
    return undefined;
  }
}

/** Factory export: build a plugin pinned to an explicit mode (tests, embedders). */
export { createCompressorPlugin };

/**
 * Default plugin: mode from the adapter-prepended COMPRESSOR_MODE const,
 * 'optimized' when absent or unrecognized.
 */
export const CompressorPlugin = createCompressorPlugin(prologueMode());
