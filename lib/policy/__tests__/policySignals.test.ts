/* ---------------------------------------------------------------------------
 * Self-contained test harness for the Policy Dossier engine.
 * ------------------------------------------------------------------------- */

import { analyzePolicySignals } from "../analyzePolicySignals";
import { detectPolicy } from "../detect";
import type { PolicyTopic } from "../../../types/policy";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else failures.push(`x ${name}${detail ? ` - ${detail}` : ""}`);
}

const topicCases: Array<[PolicyTopic, string, string?]> = [
  ["Diplomacy", "Foreign ministers open bilateral talks before summit"],
  ["Defense & Security", "Defense ministry announces new border security exercise"],
  ["Economy & Sanctions", "New sanctions package expands export controls"],
  ["Intl. Organizations", "UN Security Council schedules emergency session"],
  ["Official Statements", "Government spokesperson issues official statement"],
  ["Energy", "Energy ministers discuss gas pipeline transit"],
  ["Crisis & Conflict", "Border clash sparks evacuation amid crisis"],
];

for (const [topic, title, summary] of topicCases) {
  const result = detectPolicy(title, summary);
  check(`[topic] ${topic}`, result.topic === topic, result.topic);
}

(() => {
  const result = detectPolicy("Syria agrees to reopen border talks after diplomatic visit");
  check("[region] single country can dominate", result.region === "Syria", result.region);
})();

(() => {
  const result = detectPolicy("Middle East coalition urges renewed dialogue");
  check("[region] direct macro-region", result.region === "Middle East", result.region);
})();

(() => {
  const escalated = detectPolicy(
    "Emergency session follows missile strike and nationwide mobilization",
  );
  const deescalated = detectPolicy(
    "Ceasefire agreement reached as peace talks resume after border clash",
  );
  check("[severity] escalation can be critical", escalated.sev === "critical", escalated.sev);
  check("[severity] de-escalation lowers severity", deescalated.sev !== "critical", deescalated.sev);
})();

(() => {
  const gated = analyzePolicySignals([
    { id: "1", title: "Foreign minister opens bilateral talks with France", publishedAt: "2026-07-04T09:00:00Z" },
    { id: "2", title: "Local bakery wins regional dessert award", publishedAt: "2026-07-04T08:00:00Z" },
  ]);
  check("[gate] non-policy item filtered", gated.relevantItems === 1, `got ${gated.relevantItems}`);
  check("[rollup] topic counts present", gated.topics.some((t) => t.topic === "Diplomacy" && t.count === 1));
})();

(() => {
  const result = detectPolicy("Sanctions package targets oil pipeline exports");
  check("[tags] produces 2-4 tags", result.tags.length >= 2 && result.tags.length <= 4, result.tags.join(", "));
  check("[tags] includes matched term", result.tags.some((tag) => /Sanctions|Pipeline|Oil/.test(tag)), result.tags.join(", "));
})();

(() => {
  const result = analyzePolicySignals([
    {
      id: "x",
      title: "Government spokesperson issues official statement on sanctions",
      summary: "The ministry said export controls will be reviewed.",
      source: "Example Wire",
      verificationStatus: "official_statement",
      publishedAt: new Date(Date.now() - 12 * 60000).toISOString(),
    },
  ]);
  const item = result.items[0];
  check("[item] sourceType is News", item?.sourceType === "News", item?.sourceType);
  check("[item] minsAgo derived from publishedAt", item?.minsAgo >= 10 && item.minsAgo <= 14, String(item?.minsAgo));
  check("[item] provenance flag", result.provenance === "derived_from_rss_text" && result.inferred === true);
  check("[confidence] official source lifts confidence", item?.confidenceLevel >= 4, String(item?.confidenceLevel));
})();

console.log(`\n${"=".repeat(58)}`);
if (failures.length === 0) {
  console.log(`ALL PASSED - ${passed} assertions`);
  console.log("=".repeat(58));
  process.exit(0);
} else {
  console.log(`${passed} passed   ${failures.length} failed`);
  console.log("-".repeat(58));
  for (const failure of failures) console.log(failure);
  console.log("=".repeat(58));
  process.exit(1);
}
