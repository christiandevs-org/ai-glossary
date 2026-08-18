/**
 * Tests for the doc generator's README-parsing pipeline.
 *
 *   node --test scripts/
 *
 * Fixtures live in scripts/fixtures/ and are shared with lint.test.ts — they're
 * clean, lint-passing glossaries, which is exactly what this generator assumes
 * as input. Assertions check parsed shape, not exact file-write bytes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseReadme,
  parseTerms,
  buildAnchorMap,
  rewriteRelatedTermsForTermPage,
  buildTermPageContent,
  buildSearchIndex,
  firstSentence,
  slugifyFile,
  slugifyAnchor,
} from "./generate-docs.ts";

const here = dirname(fileURLToPath(import.meta.url));

function readFixture(fixture: string): string {
  return readFileSync(join(here, "fixtures", `${fixture}.md`), "utf8");
}

function termsFor(fixture: string) {
  const sections = parseReadme(readFixture(fixture));
  return parseTerms(sections);
}

test("parseReadme reads section metadata from clean.md", () => {
  const sections = parseReadme(readFixture("clean"));
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Building & Ops", "Culture & Vibes"],
  );
  assert.deepEqual(
    sections.map((s) => s.slug),
    ["building-ops", "culture-vibes"],
  );
});

test("parseTerms splits every section into one term per heading", () => {
  const terms = termsFor("clean");
  assert.deepEqual(
    terms.map((t) => t.title),
    ["Agentic / agent loop", "Eval", "Churn (code)", "Churn (customer)", "Cooked"],
  );
});

test("parseTerms extracts definition, quote, and related-terms blocks separately", () => {
  const terms = termsFor("clean");
  const eval_ = terms.find((t) => t.title === "Eval")!;
  assert.equal(eval_.definition, "Test suite for non-deterministic output.");
  assert.equal(eval_.quote, '> "Don\'t merge until it\'s green."');
  assert.equal(eval_.relatedRaw, "**Related terms:** [Agentic / agent loop](#agentic--agent-loop)");
});

test("slugifyFile collapses a slash heading to a single-hyphen file slug", () => {
  assert.equal(slugifyFile("Agentic / agent loop"), "agentic-agent-loop");
});

test("slugifyAnchor matches GitHub's double-hyphen anchor for a slash heading", () => {
  assert.equal(slugifyAnchor("Agentic / agent loop"), "agentic--agent-loop");
});

test("disambiguated headings produce distinct, non-colliding file slugs", () => {
  const terms = termsFor("clean");
  const churnCode = terms.find((t) => t.title === "Churn (code)")!;
  const churnCustomer = terms.find((t) => t.title === "Churn (customer)")!;
  assert.equal(churnCode.slug, "churn-code");
  assert.equal(churnCustomer.slug, "churn-customer");
  assert.notEqual(churnCode.slug, churnCustomer.slug);
});

test("buildAnchorMap resolves a slash-heading anchor to the right term (regression: TODO.md slugify mismatch)", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const target = anchorMap.get("agentic--agent-loop");
  assert.equal(target?.title, "Agentic / agent loop");
  assert.equal(target?.slug, "agentic-agent-loop");
});

test("rewriteRelatedTermsForTermPage points at the target term's own page, same section", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const agentic = terms.find((t) => t.title === "Agentic / agent loop")!;
  assert.equal(
    rewriteRelatedTermsForTermPage(agentic.relatedRaw, anchorMap),
    "**Related terms:** [Eval](../terms/eval)",
  );
});

test("rewriteRelatedTermsForTermPage points at the target term's own page, across sections", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const cooked = terms.find((t) => t.title === "Cooked")!;
  // Cooked (Culture & Vibes) relates to Eval (Building & Ops) — old behavior
  // rewrote this as a cross-file anchor; new behavior is a direct page link,
  // identical in shape to a same-section related link.
  assert.equal(
    rewriteRelatedTermsForTermPage(cooked.relatedRaw, anchorMap),
    "**Related terms:** [Eval](../terms/eval)",
  );
});

test("rewriteRelatedTermsForTermPage resolves a slash-heading target across sections without dropping the link", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const evalTerm = terms.find((t) => t.title === "Eval")!;
  assert.equal(
    rewriteRelatedTermsForTermPage(evalTerm.relatedRaw, anchorMap),
    "**Related terms:** [Agentic / agent loop](../terms/agentic-agent-loop)",
  );
});

test("rewriteRelatedTermsForTermPage leaves an unresolvable anchor untouched", () => {
  const anchorMap = new Map();
  assert.equal(
    rewriteRelatedTermsForTermPage("**Related terms:** [Ghost](#ghost)", anchorMap),
    "**Related terms:** [Ghost](#ghost)",
  );
});

test("firstSentence stops at the first sentence boundary", () => {
  assert.equal(
    firstSentence("Model runs in a cycle. It calls tools and reads results."),
    "Model runs in a cycle.",
  );
});

test("firstSentence returns the whole text when there is no boundary", () => {
  assert.equal(firstSentence("No punctuation here"), "No punctuation here");
});

test("buildTermPageContent escapes embedded double quotes in the title (regression: 'Cook / \"let him cook\"' broke YAML frontmatter)", () => {
  const section = { emoji: "🔥", title: "Culture & Vibes", slug: "culture-vibes", content: "" };
  const term = {
    title: 'Cook / "let him cook"',
    slug: "cook-let-him-cook",
    section,
    definition: "Let the model run without interrupting it.",
    quote: '> "Let him cook."',
    relatedRaw: "**Related terms:** [Cracked](#cracked)",
  };
  const content = buildTermPageContent(term, new Map());
  assert.match(content, /title: "Cook \/ \\"let him cook\\""/);
});

test("buildTermPageContent produces frontmatter, category badge, and rewritten related terms", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const agentic = terms.find((t) => t.title === "Agentic / agent loop")!;
  const content = buildTermPageContent(agentic, anchorMap);

  assert.match(content, /^---\n/);
  assert.match(content, /title: "Agentic \/ agent loop"/);
  assert.match(content, /displayed_sidebar: null/);
  assert.match(content, /href="\/\?tag=building-ops"/);
  assert.match(content, /🛠️ Building & Ops/);
  assert.match(content, /Model runs in a cycle instead of returning one answer\./);
  assert.match(content, /\[Eval\]\(\.\.\/terms\/eval\)/);
});

test("buildTermPageContent adds Definition and Example subheaders ahead of their blocks", () => {
  const terms = termsFor("clean");
  const anchorMap = buildAnchorMap(terms);
  const agentic = terms.find((t) => t.title === "Agentic / agent loop")!;
  const content = buildTermPageContent(agentic, anchorMap);

  assert.match(
    content,
    /### Definition\n\nModel runs in a cycle instead of returning one answer\./,
  );
  assert.match(content, /### Example\n\n> "It's not agentic/);
});

test("buildSearchIndex produces one entry per term with category, teaser, and stripped quote", () => {
  const terms = termsFor("clean");
  const index = buildSearchIndex(terms);
  assert.equal(index.length, 5);

  const eval_ = index.find((e) => e.slug === "eval")!;
  assert.equal(eval_.title, "Eval");
  assert.equal(eval_.category, "building-ops");
  assert.equal(eval_.categoryLabel, "🛠️ Building & Ops");
  assert.equal(eval_.teaser, "Test suite for non-deterministic output.");
  assert.equal(eval_.definition, "Test suite for non-deterministic output.");
  assert.equal(eval_.quote, "\"Don't merge until it's green.\"");
});

test("buildSearchIndex keeps disambiguated terms distinct", () => {
  const terms = termsFor("clean");
  const index = buildSearchIndex(terms);
  const slugs = index.map((e) => e.slug);
  assert.ok(slugs.includes("churn-code"));
  assert.ok(slugs.includes("churn-customer"));
});

test("running the script as a CLI writes the docs the site build needs", () => {
  // The site build shells out via `npx tsx scripts/generate-docs.ts`, and tsx
  // does not define `import.meta.main` — a guard on it makes the script exit 0
  // having written nothing, so Docusaurus then fails with "The docs folder does
  // not exist". Run it the way the build does and assert it actually wrote.
  const script = join(here, "generate-docs.ts");
  const result = spawnSync("npx", ["tsx", script], {
    encoding: "utf8",
    cwd: join(here, ".."),
  });

  assert.equal(result.status, 0, result.stderr);
  const termsDir = join(here, "..", "website", "docs", "terms");
  assert.ok(
    readdirSync(termsDir).some((f) => f.endsWith(".md")),
    "expected generated term pages in website/docs/terms",
  );
});

test("parseTerms handles the reference.md fixture's same-section related terms", () => {
  const terms = termsFor("reference");
  assert.deepEqual(
    terms.map((t) => t.title),
    ["Alpha", "Beta", "Cooked"],
  );
  const anchorMap = buildAnchorMap(terms);
  const alpha = terms.find((t) => t.title === "Alpha")!;
  assert.equal(
    rewriteRelatedTermsForTermPage(alpha.relatedRaw, anchorMap),
    "**Related terms:** [Beta](../terms/beta)",
  );
});
