import type { MarkerStyle, Mode } from '../engine/types.ts';
import { getAtom } from '../packs/atoms.ts';
import { atomsForMode, MODE_DESCRIPTIONS } from '../packs/modes.ts';
import { renderOutputStyle, renderOutputStyleFromAtoms } from '../packs/render.ts';
import type { AtomCategory } from '../packs/types.ts';
import type { Variant } from './types.ts';

/** Atom categories ablatable wholesale via --ablate-group. */
export const ABLATE_GROUPS: readonly AtomCategory[] = ['output', 'behavior'];

function isAblateGroup(value: string): value is AtomCategory {
  return (ABLATE_GROUPS as readonly string[]).includes(value);
}

export interface BuildVariantsOptions {
  modes: Mode[];
  /** atom ids removed one at a time from the optimized baseline */
  ablate: string[];
  /** REJECTED atom ids added one at a time to the optimized baseline */
  ablateAdd: string[];
  /** atom categories ('output' | 'behavior') removed wholesale from the optimized baseline */
  ablateGroups: string[];
  hook: boolean;
  /**
   * Extra args appended to the hook command of EVERY hook-bearing variant
   * (Variant.hookArgs), e.g. '--marker-style informative'. Whitespace-only
   * values are ignored.
   */
  hookArgs?: string;
  /**
   * Marker-style ARMS: each hook-bearing variant fans out into one variant
   * per style (id '<variant>-marker-<style>', hookArgs '--marker-style
   * <style>') so all arms coexist IN THE SAME RUN. Running arms as separate
   * `--hook-args` runs gives each its own --max-budget-usd ceiling and its
   * own truncation point — a more expensive arm loses later trials/tasks
   * while others complete, unbalancing the comparison. In-run arms share one
   * ceiling and the runner's variants-innermost, group-atomic scheduling
   * keeps every arm present on exactly the same task×trial groups.
   */
  markerStyles?: string[];
  /**
   * Generic hook-args ARMS: each hook-bearing variant fans out into one
   * variant per entry (id '<variant>-arm-<label>', the entry's args appended
   * to hookArgs; empty args = a control arm running the base configuration).
   * Same same-run/shared-ceiling rationale as markerStyles. Example, the
   * recovery-budget A/B: [{label:'budget-on', args:''},
   * {label:'budget-off', args:'--recovery-budget off'}].
   */
  hookArgArms?: Array<{ label: string; args: string }>;
  /**
   * Hook-presence ARMS: each hook-bearing variant fans out into
   * '<id>-hook-on' (hook installed) and '<id>-hook-off' (no hook, same
   * instructions) — the pure compression-hook A/B, in one run, holding the
   * instruction pack constant. Same shared-ceiling rationale as the other
   * fan-outs.
   */
  hookArms?: boolean;
  /**
   * Pre-built competitor variants (e.g. the Caveman pack) appended as-is. They
   * carry hook:false and an arbitrary styleBody, so the hook-args/marker/arm
   * fan-outs below skip them; they pass straight through to the run for a
   * head-to-head against the compressor modes.
   */
  competitors?: Variant[];
}

const MARKER_STYLES: readonly MarkerStyle[] = ['plain', 'deterrent', 'informative'];

function isMarkerStyle(value: string): value is MarkerStyle {
  return (MARKER_STYLES as readonly string[]).includes(value);
}

/** Atom ids become style/file names — dots would read as extensions. */
export function sanitizeAtomId(id: string): string {
  return id.replaceAll('.', '-');
}

function modeVariant(mode: Mode, hook: boolean): Variant {
  if (mode === 'full') {
    return { id: 'full', baseMode: 'full', styleBody: null, styleName: null, hook: false };
  }
  return {
    id: mode,
    baseMode: mode,
    styleBody: renderOutputStyle(mode).body,
    styleName: `compressor-${mode}`,
    hook,
  };
}

export function buildVariants(opts: BuildVariantsOptions): Variant[] {
  const variants: Variant[] = opts.modes.map((mode) => modeVariant(mode, opts.hook));
  // competitors are output-only (hook:false): append before the fan-outs, which
  // operate on hook-bearing variants and leave these untouched.
  if (opts.competitors !== undefined) {
    variants.push(...opts.competitors);
  }

  if (opts.ablateAdd.length > 0 && !opts.modes.includes('optimized')) {
    throw new Error(
      "--ablate-add requires 'optimized' in --modes — rejected atoms are added back to the optimized baseline",
    );
  }

  const baseline = atomsForMode('optimized', 'claude-code');
  const slimBaseline = atomsForMode('slim', 'claude-code');

  // Atoms in the optimized baseline ablate against optimized; slim-only atoms
  // (out.explanation-budget, out.code-only-default) have no optimized data
  // path, so they ablate against the slim baseline as slim-minus-<id> —
  // otherwise the per-atom gate is structurally unanswerable for them.
  for (const id of opts.ablate) {
    if (getAtom(id) === undefined) {
      throw new Error(`--ablate: unknown atom id '${id}'`);
    }
    const inOptimized = baseline.some((atom) => atom.id === id);
    const inSlim = slimBaseline.some((atom) => atom.id === id);
    if (!inOptimized && !inSlim) {
      throw new Error(
        `--ablate: atom '${id}' is not in the optimized baseline or the slim baseline — removing it would change nothing`,
      );
    }
    const baseMode = inOptimized ? ('optimized' as const) : ('slim' as const);
    if (!opts.modes.includes(baseMode)) {
      throw new Error(
        inOptimized
          ? `--ablate: atom '${id}' is measured against the optimized baseline — include 'optimized' in --modes`
          : `--ablate: atom '${id}' is not in the optimized baseline — it is slim-only; include 'slim' in --modes to measure slim-minus-${sanitizeAtomId(id)}`,
      );
    }
    const baseAtoms = inOptimized ? baseline : slimBaseline;
    const variantId = `${baseMode}-minus-${sanitizeAtomId(id)}`;
    const rendered = renderOutputStyleFromAtoms(
      baseAtoms.filter((atom) => atom.id !== id),
      `compressor-${variantId}`,
      `${MODE_DESCRIPTIONS[baseMode]} (minus ${id})`,
    );
    variants.push({
      id: variantId,
      baseMode,
      styleBody: rendered.body,
      styleName: `compressor-${variantId}`,
      hook: opts.hook,
    });
  }

  for (const group of opts.ablateGroups) {
    if (!isAblateGroup(group)) {
      throw new Error(
        `--ablate-group: unknown group '${group}' (valid groups: ${ABLATE_GROUPS.join(', ')})`,
      );
    }
    if (!opts.modes.includes('optimized')) {
      throw new Error(
        `--ablate-group: group '${group}' is measured against the optimized baseline — include 'optimized' in --modes`,
      );
    }
    const variantId = `optimized-minus-${group}-atoms`;
    const styleName = `compressor-ablate-no-${group}`;
    // No empty-result guard needed: if removing the group leaves zero atoms,
    // renderOutputStyleFromAtoms still emits frontmatter + empty sections —
    // the variant measures "style file present but says nothing of that category".
    const rendered = renderOutputStyleFromAtoms(
      baseline.filter((atom) => atom.category !== group),
      styleName,
      `${MODE_DESCRIPTIONS.optimized} (minus all ${group} atoms)`,
    );
    variants.push({
      id: variantId,
      baseMode: 'optimized',
      styleBody: rendered.body,
      styleName,
      hook: opts.hook,
    });
  }

  for (const id of opts.ablateAdd) {
    const atom = getAtom(id);
    if (atom === undefined) {
      throw new Error(`--ablate-add: unknown atom id '${id}'`);
    }
    if (atom.rejected === undefined) {
      throw new Error(
        `--ablate-add: atom '${id}' is not rejected — active atoms belong in --modes/--ablate; --ablate-add exists to test rejected atoms against data`,
      );
    }
    const variantId = `optimized-plus-${sanitizeAtomId(id)}`;
    const rendered = renderOutputStyleFromAtoms(
      [...baseline, atom],
      `compressor-${variantId}`,
      `${MODE_DESCRIPTIONS.optimized} (plus rejected ${id})`,
    );
    variants.push({
      id: variantId,
      baseMode: 'optimized',
      styleBody: rendered.body,
      styleName: `compressor-${variantId}`,
      hook: opts.hook,
    });
  }

  const hookArgs = opts.hookArgs?.trim();
  if (hookArgs !== undefined && hookArgs !== '') {
    const hooked = variants.filter((variant) => variant.hook);
    if (hooked.length === 0) {
      throw new Error(
        '--hook-args: no hook-bearing variants to apply it to — remove --no-hook and include optimized/slim in --modes',
      );
    }
    for (const variant of hooked) {
      variant.hookArgs = hookArgs;
    }
  }

  const markerStyles = opts.markerStyles ?? [];
  let expanded = variants;
  if (markerStyles.length > 0) {
    for (const style of markerStyles) {
      if (!isMarkerStyle(style)) {
        throw new Error(
          `--marker-styles: unknown style '${style}' (valid: ${MARKER_STYLES.join(', ')})`,
        );
      }
    }
    if (new Set(markerStyles).size !== markerStyles.length) {
      throw new Error('--marker-styles: duplicate style');
    }
    // The hook entries take the FIRST --marker-style on their command line;
    // a shared --hook-args value carrying the flag would silently override
    // every arm, collapsing the experiment to one style.
    if (hookArgs !== undefined && hookArgs.includes('--marker-style')) {
      throw new Error(
        '--marker-styles cannot be combined with --hook-args containing --marker-style — the shared value would override every arm',
      );
    }
    if (!variants.some((variant) => variant.hook)) {
      throw new Error(
        '--marker-styles: no hook-bearing variants to fan out — remove --no-hook and include optimized/slim in --modes',
      );
    }
    expanded = variants.flatMap((variant) =>
      variant.hook
        ? markerStyles.map(
            (style): Variant => ({
              ...variant,
              id: `${variant.id}-marker-${style}`,
              // unique style file per arm (same body): keeps the duplicate
              // checks meaningful and the installed outputStyle traceable
              styleName:
                variant.styleName === null ? null : `${variant.styleName}-marker-${style}`,
              hookArgs:
                variant.hookArgs === undefined
                  ? `--marker-style ${style}`
                  : `${variant.hookArgs} --marker-style ${style}`,
            }),
          )
        : [variant],
    );
  }

  const hookArgArms = opts.hookArgArms ?? [];
  if (hookArgArms.length > 0) {
    const labels = new Set<string>();
    for (const arm of hookArgArms) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(arm.label)) {
        throw new Error(
          `--hook-arg-arms: label '${arm.label}' must be lowercase alphanumerics/dashes (it names variants and style files)`,
        );
      }
      if (labels.has(arm.label)) {
        throw new Error(`--hook-arg-arms: duplicate label '${arm.label}'`);
      }
      labels.add(arm.label);
    }
    if (!expanded.some((variant) => variant.hook)) {
      throw new Error(
        '--hook-arg-arms: no hook-bearing variants to fan out — remove --no-hook and include optimized/slim in --modes',
      );
    }
    expanded = expanded.flatMap((variant) =>
      variant.hook
        ? hookArgArms.map((arm): Variant => {
            const extra = arm.args.trim();
            const joined =
              variant.hookArgs === undefined || variant.hookArgs === ''
                ? extra
                : extra === ''
                  ? variant.hookArgs
                  : `${variant.hookArgs} ${extra}`;
            return {
              ...variant,
              id: `${variant.id}-arm-${arm.label}`,
              // unique style file per arm (same body): keeps duplicate checks
              // meaningful and the installed outputStyle traceable per arm
              styleName:
                variant.styleName === null ? null : `${variant.styleName}-arm-${arm.label}`,
              ...(joined === '' ? {} : { hookArgs: joined }),
            };
          })
        : [variant],
    );
  }

  if (opts.hookArms === true) {
    if (!expanded.some((variant) => variant.hook)) {
      throw new Error(
        '--hook-arms: no hook-bearing variants to fan out — remove --no-hook and include optimized/slim in --modes',
      );
    }
    expanded = expanded.flatMap((variant) => {
      if (!variant.hook) {
        return [variant];
      }
      const off: Variant = {
        ...variant,
        id: `${variant.id}-hook-off`,
        styleName: variant.styleName === null ? null : `${variant.styleName}-hook-off`,
        hook: false,
      };
      delete off.hookArgs;
      return [
        {
          ...variant,
          id: `${variant.id}-hook-on`,
          styleName: variant.styleName === null ? null : `${variant.styleName}-hook-on`,
        },
        off,
      ];
    });
  }

  const seenIds = new Set<string>();
  const seenStyles = new Set<string>();
  for (const variant of expanded) {
    if (seenIds.has(variant.id)) {
      throw new Error(`duplicate variant id '${variant.id}' (repeated mode or atom id?)`);
    }
    seenIds.add(variant.id);
    if (variant.styleName !== null) {
      if (seenStyles.has(variant.styleName)) {
        throw new Error(`duplicate variant style name '${variant.styleName}'`);
      }
      seenStyles.add(variant.styleName);
    }
  }
  return expanded;
}
