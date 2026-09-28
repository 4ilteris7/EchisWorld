# `lib/policy` - Policy Dossier detection engine

Derives the Policy "Dossier" screen's live report metadata from RSS `title +
summary` text: topic, region, severity, tags, and feed rollups.

Everything is inferred from open-source text (`provenance:
"derived_from_rss_text"`). The output is deterministic heuristic metadata, not
verified attribution.

## Pipeline

```text
analyzePolicySignals(items)
  -> detectPolicy(title, summary)          detect.ts
      -> weighted topic classification     lexicon.ts
      -> country / direct region signals   ../cyber/geoLexicon
      -> severity from escalation terms
      -> short tags from matched terms
      -> relevance gate
```

## Screen mapping

| Panel | Metric |
| --- | --- |
| Topic tabs | `items[].topic` and `topics` |
| Feed | `items: PolicyReportLive[]` |
| Detail | same render contract as `PolicyReport` |
| Most Mentioned Regions | `items[].region` and `regions` |
| Source Breakdown | `items[].sourceType` (`News` for RSS) |
| Signal Volume | `items[].minsAgo`, derived from `publishedAt` |

## Tests

No test-runner dependency is used.

```bash
tmp="$(mktemp -d)"
./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 \
  --strict --esModuleInterop --skipLibCheck --outDir "$tmp" \
  lib/policy/__tests__/policySignals.test.ts
node "$tmp/lib/policy/__tests__/policySignals.test.js"
```
