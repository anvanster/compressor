import type { TierResult } from './structural.ts';

// Lossless JSON minify tier. A STRING-AWARE whitespace stripper: it removes the
// insignificant whitespace BETWEEN JSON tokens and copies every other byte —
// numbers, strings, structural punctuation — verbatim. It deliberately does NOT
// JSON.parse → JSON.stringify, because that round-trip mangles number tokens
// (big ints > 2^53 lose precision, 1e10 / 1.0 / trailing zeros / -0 are
// rewritten). Only whitespace is touched; the emitted text is the byte-exact
// original minus inter-token whitespace.

const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;
const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \

/** True for the four JSON insignificant-whitespace code units. */
function isJsonWhitespace(code: number): boolean {
  return code === SPACE || code === TAB || code === CR || code === LF;
}

/**
 * Remove insignificant whitespace that lies OUTSIDE string literals. Inside a
 * string literal every byte is copied verbatim and escapes are tracked (a
 * backslash escapes the next char, so a `\"` does not close the string). No
 * token other than whitespace is ever altered, so numbers and strings survive
 * byte-exact.
 */
export function minifyJsonText(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const ch = text[i] as string;
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (code === BACKSLASH) {
        escaped = true;
      } else if (code === QUOTE) {
        inString = false;
      }
      continue;
    }
    // Outside a string literal.
    if (isJsonWhitespace(code)) {
      continue; // insignificant — drop it
    }
    out += ch;
    if (code === QUOTE) {
      inString = true;
    }
  }
  return out;
}

/**
 * Tier entry. Runs the string-aware minify, then a LOSSLESS SAFETY NET: both
 * the original and the minified text must JSON.parse, and their canonical
 * JSON.stringify forms must be identical (semantic equality — minify never
 * reorders keys, so key order is preserved too). The check uses the parsed
 * VALUES only to confirm equality; the EMITTED text is always the byte-exact
 * minified ORIGINAL, so big-int digits survive in the output even though a JS
 * Number cannot hold them.
 *
 * Returns the tier result when the net passes AND the minified text is shorter.
 * Returns null = FAIL OPEN on ANY failure (parse error, mismatch, exception, or
 * no size gain): the caller then leaves the content unchanged. Never throws.
 */
export function minifyJson(text: string): TierResult | null {
  try {
    const minified = minifyJsonText(text);
    if (minified.length >= text.length) {
      return null; // no gain — nothing to do
    }
    const original: unknown = JSON.parse(text);
    const round: unknown = JSON.parse(minified);
    if (JSON.stringify(original) !== JSON.stringify(round)) {
      return null; // safety net failed — leave content unchanged
    }
    return {
      content: minified,
      transform: { id: 'json-minify', charsSaved: text.length - minified.length },
    };
  } catch {
    // FAIL-OPEN: any parse error / unexpected throw → leave content unchanged.
    return null;
  }
}
