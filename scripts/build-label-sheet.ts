/**
 * Builds the blank labeling sheet Tarik fills in by hand:
 * `docs/evaluation/clustering-pair-labels.md`.
 *
 *   npx tsx scripts/build-label-sheet.ts
 *
 * No deployment access, no model, no paid call — everything comes from the
 * committed fixture `tests/fixtures/clustering/scan-294.json`, which is the real
 * 294-source scan `k1781cvj03wmdd2bgz4ks2rzbh8d4ze8`.
 *
 * WHICH PAIRS ARE IN THE SHEET, and why (research-clustering.md §5(b) suggested
 * ~47 at a cutoff design that was never shipped; the shipped two-tier cutoffs
 * produce a different set):
 *
 *   - all 89 AMBIGUOUS pairs — the band where the score genuinely does not know,
 *     and the only input `convex/ai/adjudicatePairs.ts` ever receives. A human
 *     verdict here is worth the most.
 *   - all 15 AUTO-LINKED pairs — the side no model can undo. Precision on these
 *     is the number that matters for `independentCategoryCount`.
 *   - 3 seeded pairs the code REJECTED, named in the plan as traps. Without them
 *     nothing in the sheet can measure blocking's recall at all.
 *
 * The code's own verdict and score are deliberately NOT printed next to a pair.
 * A sheet that shows the machine's answer collects agreement, not judgment. The
 * harness (`tests/unit/editorial/labeled-pairs.test.ts`) recomputes both from the
 * same fixture at test time and joins on the pair key.
 *
 * Pairs are grouped into families (connected components over the sheet's own
 * pairs) so the ten permutations of one high-school football listing sit
 * together and are read once, not ten times.
 *
 * Re-running this OVERWRITES the sheet and would discard any labels already in
 * it. It refuses to do that unless `--force` is passed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { groupSignals, pairLinkKey, type ClusterSignal } from "../convex/editorial/blocking";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHEET = path.join(ROOT, "docs/evaluation/clustering-pair-labels.md");

type Row = { sourceResultId: string; title: string; snippet: string; entityKeys?: string[]; claimSummary?: string };

const rows: Row[] = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/clustering/scan-294.json"), "utf8"));
const signals: ClusterSignal[] = rows.map((r) => ({
  sourceResultId: r.sourceResultId,
  title: r.title,
  snippet: r.snippet,
  entityKeys: r.entityKeys ?? [],
  claimSummary: r.claimSummary ?? "",
  dates: [],
}));
const byId = new Map(signals.map((s) => [s.sourceResultId, s]));

/** The four traps the real data handed us, by source id. */
const ID = {
  asianFoodFestival: "k97cp4yf7x290h4s1sjktg10sx8d51qx",
  freshwaterFestival: "k97e3ffyry70mjy7vsmshnhmr58d5g9s",
  homelessFamily: "k975xbgmjvgzwe1t0xv6b5rzdd8d453c",
  mayorBikeRide: "k97eyxc1qgmr61gzan2ds5ekn98d40wr",
  backToSchoolFestival: "k97cnx1qgvcmzr4ndya0wz1x5s8d46m0",
  homesMke: "k972wcvf9tvy8hrbjkxmkxfh6s8d42a4",
  southSideSpanish: "k97a905v5nv0m7smvwjkvphnws8d47z8",
};

const SEEDED: Record<string, string> = {
  [pairLinkKey(ID.asianFoodFestival, ID.freshwaterFestival)]:
    "PRE-KNOWN — expected **different**. Two unrelated festivals that share only the words `food` and `festival`. The code never even compares them.",
  [pairLinkKey(ID.homelessFamily, ID.mayorBikeRide)]:
    "PRE-KNOWN — expected **different**. Shares only the neighbourhood `East Side`. The named must-NOT-merge trap.",
  [pairLinkKey(ID.mayorBikeRide, ID.backToSchoolFestival)]:
    "PRE-KNOWN — expected **same** (`KNOWN MISS #1`). The ride happens AT that festival. They share no distinctive word, so the code never compares them — no wording change makes it find this.",
  [pairLinkKey(ID.homesMke, ID.southSideSpanish)]:
    "PRE-KNOWN — expected **same** (`KNOWN MISS #2`). The same housing programme in Spanish and in English, one point under the floor.",
};

const outcome = groupSignals(signals);
const keys = new Map<string, [string, string]>();
for (const p of outcome.pairs) keys.set(pairLinkKey(p.a, p.b), [p.a, p.b]);
// The three seeded traps the score rejected, which are therefore not in `pairs`.
for (const key of Object.keys(SEEDED)) {
  const [a, b] = key.split("|");
  if (!keys.has(key)) keys.set(key, [a, b]);
}

// Families: connected components over the sheet's own pairs, so related pairs
// are adjacent and one set of titles is read once.
const parent = new Map<string, string>();
const find = (x: string): string => {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  return r;
};
for (const [a, b] of keys.values()) {
  for (const id of [a, b]) if (!parent.has(id)) parent.set(id, id);
  const [ra, rb] = [find(a), find(b)];
  if (ra !== rb) parent.set(rb, ra);
}
const families = new Map<string, string[]>();
for (const key of [...keys.keys()].sort()) {
  const root = find(keys.get(key)![0]);
  const existing = families.get(root);
  if (existing) existing.push(key);
  else families.set(root, [key]);
}
const ordered = [...families.values()].sort((x, y) => y.length - x.length || x[0].localeCompare(y[0]));

const side = (label: string, id: string): string => {
  const s = byId.get(id);
  const snippet = (s?.snippet ?? "").trim();
  return `**${label}.** ${s?.title ?? "(unknown source)"}\n${snippet ? `> ${snippet}\n` : "> _(no snippet captured)_\n"}`;
};

let n = 0;
const blocks: string[] = [];
for (const [i, family] of ordered.entries()) {
  if (family.length > 1) blocks.push(`### Group ${i + 1} — ${family.length} pairs among the same handful of sources\n`);
  for (const key of family) {
    const [a, b] = keys.get(key)!;
    n += 1;
    const id = `P${String(n).padStart(3, "0")}`;
    const seed = SEEDED[key] ? `> ${SEEDED[key]}\n\n` : "";
    blocks.push([
      `#### ${id}`,
      "",
      `<!-- pair: ${key} -->`,
      "",
      seed + side("A", a) + "\n" + side("B", b),
      "**Answer:** ",
      "",
      "---",
      "",
    ].join("\n"));
  }
}

const header = `# Clustering pair labels — please fill this in

**What this is.** ${n} pairs of news sources drawn from one real Milwaukee scan
(294 sources, 2026-08-25). For each pair, the software has to decide whether the
two are covering **the same story**. This file is the answer key it gets graded
against. Nobody has labeled it yet — that is the job.

**What you are deciding.** For each pair, read the two headlines (and the snippet
under each, where one was captured) and write one word on the **Answer** line:

| write | when |
| --- | --- |
| \`same\` | both are covering the same underlying story or event |
| \`different\` | they are two separate stories |
| \`unsure\` | you genuinely cannot tell from what is shown |

\`unsure\` is a real answer, not a gap. A pair a careful editor cannot call is
signal — it tells us the software should not be confident either. It is excluded
from the scoring rather than counted against anything, so use it whenever it is
the honest answer. Leaving a line blank means "not labeled yet", which is
different from \`unsure\`.

**Edit only the Answer lines.** Everything else — the \`P001\` numbers and the
\`<!-- pair: ... -->\` comments — is how the test finds your answer. Write the
word after the colon, with or without backticks:

\`\`\`
**Answer:** same
\`\`\`

**Roughly how long.** Around 35 to 45 minutes. Most pairs are a five-second
call from the two headlines. Pairs are grouped so that related ones sit together
— one group is ten pairs over five copies of the same listing, and once you have
read those five titles the ten answers are the same answer.

**Judgement call worth making explicitly.** Some pairs are the same *thing* but
not a *story* — one high-school football game listed on five aggregator sites, or
two library branch pages sharing a newsletter footer. Label those \`same\` if they
are the same underlying thing; the fact that neither would make a lead is a
separate problem (source quality), and we would rather measure the two separately.
If you disagree with that, label them the way you think a merge should behave and
say so — the disagreement is the useful part.

**A few pairs are marked PRE-KNOWN**, with the answer we already believe from
reading the data. They are here so this sheet is not a rubber stamp and so the
score has something to measure recall against. Confirm them or overrule them; an
overrule is real information.

**What happens next.** \`tests/unit/editorial/labeled-pairs.test.ts\` reads this
file. While it is blank the test skips and \`npm run check\` stays green. Once
there are labels it asserts precision and recall floors against them, and goes
red if anyone drifts a clustering threshold.

---

`;

mkdirSync(path.dirname(SHEET), { recursive: true });
if (existsSync(SHEET) && !process.argv.includes("--force")) {
  console.error(`${SHEET} already exists. Re-running would discard any labels in it. Pass --force to overwrite.`);
  process.exit(1);
}
writeFileSync(SHEET, header + blocks.join("\n"));
console.log(`wrote ${SHEET}: ${n} pairs, ${ordered.length} families`);
