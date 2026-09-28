export function normalizeFilterText(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/Ä±/g, "i")
    .replace(/Ã§/g, "c")
    .replace(/ÄŸ/g, "g")
    .replace(/Ã¶/g, "o")
    .replace(/ÅŸ/g, "s")
    .replace(/Ã¼/g, "u")
    .replace(/[^a-z0-9]+/g, " ");

  return normalized
    .replace(/\bgazz(e|a)(ye|de|den|nin)?\b/g, " gazze ")
    .replace(/\bgazze(ye|de|den|nin)?\b/g, " gazze ")
    .replace(/\blubnan(a|da|dan|in|nin)?\b/g, " lubnan ")
    .replace(/\bisrail(den|de|e|li|liler|in|nin)?\b/g, " israil ")
    .replace(/\bbati seria(da|dan|ya|nin)?\b/g, " bati seria ")
    .replace(/\bdso(den|de|ye|nun)?\b/g, " dso ")
    .replace(/\bbmmyk\b/g, " bmm yk ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Phrase regex cache: compiled once per unique phrase, reused on every call.
//
// Keywords are static string literals that never change at runtime. Without
// this cache, containsNormalizedPhrase creates a new RegExp object for every
// (item x keyword) pair. The cache reduces that to one compilation per unique
// keyword phrase, regardless of how many items or pipeline runs occur.
//
// Map value `false` = the phrase normalised to empty string, always false.
// ---------------------------------------------------------------------------
const _phraseRegexCache = new Map<string, RegExp | false>();

export function containsNormalizedPhrase(
  normalizedText: string,
  phrase: string,
): boolean {
  let entry = _phraseRegexCache.get(phrase);
  if (entry === undefined) {
    const normalizedPhrase = normalizeFilterText(phrase);
    if (!normalizedPhrase) {
      _phraseRegexCache.set(phrase, false);
      return false;
    }
    const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    entry = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`);
    _phraseRegexCache.set(phrase, entry);
  }
  if (entry === false) return false;
  return entry.test(normalizedText);
}
