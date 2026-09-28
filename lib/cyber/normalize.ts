// ---------------------------------------------------------------------------
// Text normalization and boundary-aware matching for cyber signal detection.
//
// Mirrors the proven approach in data/sources/rssMarkerAdapter.ts:
//   1. lowercase
//   2. NFD-decompose accented characters
//   3. strip combining diacritics (U+0300–U+036F)
//   4. map Turkish dotless ı (U+0131) → i
//   5. normalize curly apostrophes/quotes and dashes to ASCII
//   6. collapse whitespace
//
// After normalization both the corpus and every lexicon term live in the same
// ASCII-safe form, so matching is deterministic and language-agnostic. No AI,
// no locale, no runtime configuration.
// ---------------------------------------------------------------------------

const COMBINING_DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");
const DOTLESS_I_RE = /ı/g;

/** Curly quotes / apostrophes → straight ASCII apostrophe. */
const SMART_APOSTROPHE_RE = /[‘’ʼ′]/g;
const SMART_QUOTE_RE = /[“”]/g;
/** En/em dashes and minus → hyphen. */
const SMART_DASH_RE = /[‒–—―−]/g;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(DOTLESS_I_RE, "i")
    .replace(SMART_APOSTROPHE_RE, "'")
    .replace(SMART_QUOTE_RE, '"')
    .replace(SMART_DASH_RE, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape a literal string for safe insertion into a RegExp source. */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a boundary-aware matcher for a normalized term.
 *
 * Uses negative lookbehind/lookahead on ASCII word characters so a short term
 * like "iran" does not fire inside "iranian" only where we want whole-word
 * semantics, and "us" cannot fire inside "industry". A boundary is the start /
 * end of string or any character that is not [a-z0-9]. Apostrophes count as
 * boundaries, which lets possessive/inflected forms ("china's", "iran's")
 * still match the base term.
 *
 * `flags` lets callers request a global matcher for span extraction.
 */
export function buildTermRegExp(normalizedTerm: string, flags = ""): RegExp {
  const escaped = escapeRegExp(normalizedTerm);
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, flags);
}

/** True when `term` occurs as a whole token inside `normalizedText`. */
export function containsTerm(normalizedText: string, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  return buildTermRegExp(normalizedTerm).test(normalizedText);
}

export interface TermSpan {
  start: number;
  end: number;
}

/** All non-overlapping spans where `term` occurs as a whole token. */
export function findTermSpans(normalizedText: string, normalizedTerm: string): TermSpan[] {
  if (!normalizedTerm) return [];
  const re = buildTermRegExp(normalizedTerm, "g");
  const spans: TermSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalizedText)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    if (match.index === re.lastIndex) re.lastIndex++; // guard zero-width
  }
  return spans;
}
