/** Modes that render instructions. 'full' renders nothing — it is the absence of artifacts. */
export type PackMode = 'optimized' | 'slim';

export type AtomCategory = 'output' | 'behavior';

export type AgentName = 'claude-code' | 'copilot' | 'cursor' | 'agents-md';

/**
 * One independently ablatable instruction. Rendered artifacts embed the atom
 * IDs as a manifest comment so `status` and the benchmark can read what is
 * installed.
 */
export interface Atom {
  /** namespaced id, e.g. 'out.no-preamble', 'beh.targeted-reads' */
  id: string;
  category: AtomCategory;
  /** markdown bullet line(s), no trailing newline, no timestamps (cache-stable) */
  text: string;
  modes: PackMode[];
  /** undefined = applies to all agents */
  agents?: AgentName[];
  /**
   * Rejected atoms are never rendered; they exist so nobody re-adds them and
   * so the benchmark can demonstrate the rejection with data (--ablate-add).
   */
  rejected?: { reason: string };
}

export interface RenderedArtifact {
  /** complete file body or marked section, byte-deterministic */
  body: string;
  /** atoms included, in render order */
  atomIds: string[];
}
