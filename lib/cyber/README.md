# `lib/cyber` — Region & Sector signal engine

Derives **Most Mentioned Regions** and **Affected Sectors** for the Cyber News
screen from the live RSS `title + summary` text. Everything it returns is
**inferred from open-source text** (`provenance: "derived_from_rss_text"`) — it
is a deterministic, heuristic signal, not a verified attribution.

## Why this is not a keyword counter

A naive country counter mis-reads `"Chinese hackers target Taiwan"`: it records
China and Taiwan identically. This engine reads the sentence context around
every geographic mention and assigns a **role**:

| Role     | Meaning            | Example trigger                                  |
|----------|--------------------|--------------------------------------------------|
| `origin` | attacker home      | `Chinese hackers`, `Volt Typhoon`, `attributed to Russia`, `targeted by Iran` |
| `target` | victim / affected  | `target Taiwan`, `Taiwanese firms`, `Ukraine was breached`, `against US banks` |
| `neutral`| mentioned, unclear | bare country name with no attack context         |

So `"Chinese hackers target Taiwan"` →  China = **origin**, Taiwan = **target**.
Both roll up to *East Asia*, which is counted **once** for the item but tagged
with **both** roles (`roleBreakdown.origin = 1`, `roleBreakdown.target = 1`).

## Pipeline

```
analyzeCyberSignals(items)
 ├─ detectGeoSignals(title, summary)   regionDetection.ts
 │   ├─ country/demonym mentions  → role attribution (origin/target/neutral)
 │   ├─ threat actors (APT→nation) → origin signal (nation-state only)
 │   └─ direct macro-region words  → role attribution
 └─ detectSectors(title, summary)  sectorDetection.ts
     └─ weighted, context-aware keyword model
```

| File                  | Responsibility                                           |
|-----------------------|----------------------------------------------------------|
| `types.ts`            | Public types + provenance contract                       |
| `normalize.ts`        | NFD/dotless-ı normalization + boundary-aware matching    |
| `geoLexicon.ts`       | Macro-regions, country→region map, demonyms, region words|
| `threatActors.ts`     | APT → attributed nation (nation-state only carries origin)|
| `sectorLexicon.ts`    | Sectors with `[term, weight]` patterns + disambiguation  |
| `regionDetection.ts`  | Role attribution (the attacker/victim logic)             |
| `sectorDetection.ts`  | Sector scoring (threshold + ≥1 non-weak term)            |
| `analyzeCyberSignals.ts` | Rollup → `RegionMetric[]` / `SectorMetric[]`          |

## Precision policy

- Only **nation-state** APTs with established public attribution add an origin
  region. Ransomware/hacktivist brands (LockBit, ALPHV, KillNet…) carry **no**
  country — they appear mostly in victim stories and would pollute the signal.
- `"US"`/`"U.S."` are resolved by **letter case before normalization**, so the
  pronoun `"us"` never matches the country.
- A sector needs the score threshold **and** at least one non-weak (`≥2`) term,
  so two ambiguous words (`software` + `app`) cannot invent a sector.
- Disambiguation lives in the lexicon: `crypto exchange` → Finance,
  `Exchange Server` → Enterprise Infra, bare `exchange` → neither.

## Tests

No test-runner dependency is used. The harness runs as a plain script:

```bash
# from the repo root
tmp="$(mktemp -d)"
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 \
  --strict --esModuleInterop --skipLibCheck \
  --outDir "$tmp" lib/cyber/__tests__/cyberSignals.test.ts
node "$tmp/__tests__/cyberSignals.test.js"
```

It exits non-zero on any failed assertion. Coverage: role attribution
(attacker vs victim, passive voice, APT-only attribution, `-linked` tails),
false-positive guards (vendor names, the `us` pronoun, no-attack-context
neutrals), sector mapping + disambiguation, and rollup/share semantics.
