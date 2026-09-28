// ---------------------------------------------------------------------------
// Sector detection — scores one item's title+summary against the sector
// lexicon and returns the sectors whose score clears the threshold.
//
// Overlap handling: patterns are tested longest-first and matched character
// spans are claimed, so a long phrase ("crypto exchange") suppresses its own
// fragments ("crypto", "exchange") and the score is not inflated.
// ---------------------------------------------------------------------------

import type { SectorHit, SignalConfidence } from "./types";
import { normalizeText, findTermSpans } from "./normalize";
import { NORMALIZED_SECTORS, SECTOR_MATCH_THRESHOLD } from "./sectorLexicon";

function scoreToConfidence(score: number): SignalConfidence {
  if (score >= 4) return "high";
  if (score >= 3) return "medium";
  return "low";
}

/** Detect sectors for a single item. Returns hits sorted by score desc. */
export function detectSectors(title: string, summary = ""): SectorHit[] {
  const text = `${normalizeText(title)} . ${normalizeText(summary)}`.trim();
  const hits: SectorHit[] = [];

  for (const sector of NORMALIZED_SECTORS) {
    let score = 0;
    let maxWeight = 0;
    const matchedTerms: string[] = [];
    const claimed: Array<{ start: number; end: number }> = [];

    for (const pattern of sector.patterns) {
      const spans = findTermSpans(text, pattern.term);
      if (spans.length === 0) continue;
      // Use the first non-overlapping occurrence; ignore fragments inside an
      // already-claimed longer phrase.
      const span = spans.find(
        (s) => !claimed.some((c) => s.start < c.end && s.end > c.start),
      );
      if (!span) continue;
      claimed.push(span);
      score += pattern.weight;
      if (pattern.weight > maxWeight) maxWeight = pattern.weight;
      matchedTerms.push(pattern.term);
    }

    // Qualify only when the threshold is met AND at least one non-weak (>=2)
    // term is present — two weak/ambiguous words alone never invent a sector.
    if (score >= SECTOR_MATCH_THRESHOLD && maxWeight >= 2) {
      hits.push({
        sectorId: sector.sectorId,
        label: sector.label,
        score,
        confidence: scoreToConfidence(score),
        matchedTerms,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score);
}
