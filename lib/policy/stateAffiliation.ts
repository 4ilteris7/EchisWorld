// State-affiliation transparency metadata (shared client + worker).
//
// Sources publicly documented as state-owned or state-funded. Drives the
// transparency badge on Policy feed cards / detail and the Source Breakdown
// split. It flags the OUTLET, never the individual item's accuracy.
// Maintain together with the Policy screen's source list.

export const STATE_AFFILIATED_SOURCE_IDS: ReadonlySet<string> = new Set([
  "presstv-politics", // Press TV — Iranian state broadcaster
  "mehr-politics", // Mehr News — Iranian state-linked agency
  "saba-politics", // SABA — Yemeni state news agency
  "tanjug-politika", // Tanjug — Serbian state news agency
  "tass-world", // TASS — Russian state news agency
  "aljazeera-middle-east", // Al Jazeera — funded by the Qatari state
  "global-times", // Global Times — Chinese state-affiliated outlet
  "apa", // APA — Azerbaijani state-affiliated agency
]);
