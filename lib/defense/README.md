# `lib/defense` — Defense Industry detection engine

Derives the **Defense Industry** screen's live signals from defense RSS text
(`title + summary`): ranked industry **segments**, **supply-chain pressure**,
and per-item **enrichment** (activity type, organization, program, segment,
supply-chain area, buyer/supplier country roles, confidence, impact, priority).

Everything is **inferred from open-source text** (`provenance:
"derived_from_rss_text"`) — heuristic, not verified attribution. Reuses the
cyber module's normalization + country/region gazetteer (`../cyber/*`).

## Screen mapping

| Panel | Metric |
|-------|--------|
| Key Segments | `segments: DefenseSegmentMetric[]` (count + within-feed momentum) |
| Supply Chain Pressure | `supplyChain: DefenseSupplyChainMetric[]` (stress-weighted 0–100) |
| Defense Industry Feed | `items: DefenseFeedItemLive[]` (activity type + priority) |
| Industry Context | `items[].context` (org, program, segment, country role, confidence, impact) |

## What's defense-specific

- **Buyer / supplier roles** (the defense analogue of cyber's attacker/victim):
  `"Poland to buy K2 tanks from South Korea"` → Poland = **buyer**, South Korea
  = **supplier**; the context reads `South Korea → Poland`.
- **Supply-chain pressure = stress-weighted**: a commodity's score rises with
  mentions **and** stress signals near them (shortage, export ban, sanction,
  lead time, bottleneck…), not popularity alone.
- **Segment momentum**: `change` is the recent-vs-older share shift *within the
  current feed*, so it is an honest trend, not a fabricated period-over-period.
- **Relevance gate**: non-defense items (e.g. a bakery contest) are filtered
  out; segment / contractor / platform / activity / core-military hits qualify.
- **Contractors → country + segment** (Lockheed, BAE, Baykar, ASELSAN, Hanwha…)
  and **platforms/programs** (F-35, Bayraktar TB2, K2, Type 26…) drive
  organization/program enrichment and boost segment detection.

## Pipeline

```
analyzeDefenseSignals(items)
 └─ detectDefense(title, summary)         detect.ts
     ├─ segments (+ platform boost)        lexicon.ts
     ├─ supply-chain commodities + stress
     ├─ activity type classification
     ├─ contractors + platforms
     ├─ relevance gate
     └─ countries → buyer/supplier roles   (../cyber/geoLexicon)
```

## Data flow

`useDefenseIndustryFeed` fetches the 4 defense RSS sources via
`/api/sources/rss-preview` (allowlisted), merges/dedupes/sorts, runs
`analyzeDefenseSignals`, and feeds the panels. The screen is fully live:
panels render only feed-derived data plus empty/loading/error states
(the old `data/defenseIndustryMockData` fallback was removed).

## Tests (dependency-free)

```bash
tmp="$(mktemp -d)"
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 \
  --strict --esModuleInterop --skipLibCheck --outDir "$tmp" \
  lib/defense/__tests__/defenseSignals.test.ts
node "$tmp/defense/__tests__/defenseSignals.test.js"
```

Covers segment detection, activity classification, contractor/program,
buyer/supplier roles, supply-chain + stress, the relevance gate, and rollup
metrics. 27 assertions.
