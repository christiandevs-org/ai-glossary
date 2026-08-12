/**
 * Tests for the landing page's pure search logic.
 *
 *   node --experimental-strip-types --test website/src/lib/search.test.ts
 *
 * No test framework beyond node:test — mirrors scripts/lint.test.ts's style.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  filterTerms,
  pickWordOfDay,
  parseUrlSearchState,
  buildUrlSearchState,
  type SearchIndexEntry,
} from "./search.ts";

const entry = (overrides: Partial<SearchIndexEntry>): SearchIndexEntry => ({
  title: "Eval",
  slug: "eval",
  category: "building-ops",
  categoryLabel: "🛠️ Building & Ops",
  teaser: "Test suite for non-deterministic output.",
  definition: "Test suite for non-deterministic output. Fixed cases plus scoring.",
  quote: '"Don\'t merge until it\'s green."',
  ...overrides,
});

const index: SearchIndexEntry[] = [
  entry({
    title: "Eval",
    slug: "eval",
    category: "building-ops",
    teaser: "Test suite for non-deterministic output.",
  }),
  entry({
    title: "Agentic / agent loop",
    slug: "agentic-agent-loop",
    category: "building-ops",
    teaser: "Model runs in a cycle instead of returning one answer.",
    definition: "Model runs in a cycle instead of returning one answer.",
    quote: '"It\'s not agentic, it\'s one tool call with good marketing."',
  }),
  entry({
    title: "Churn (code)",
    slug: "churn-code",
    category: "culture-vibes",
    categoryLabel: "🔥 Culture & Vibes",
    teaser: "Lines written then rewritten within a short window.",
    definition: "Lines written then rewritten within a short window. A proxy for wasted motion.",
    quote: '"Churn doubled this month."',
  }),
];

test("filterTerms with no query and no tag returns everything, sorted alphabetically", () => {
  const result = filterTerms(index, "", null);
  assert.deepEqual(
    result.map((e) => e.title),
    ["Agentic / agent loop", "Churn (code)", "Eval"],
  );
});

test("filterTerms matches a query against the title", () => {
  const result = filterTerms(index, "eval", null);
  assert.deepEqual(result.map((e) => e.title), ["Eval"]);
});

test("filterTerms matches a query against definition text, not just the title", () => {
  // "wasted motion" only appears in Churn (code)'s definition.
  const result = filterTerms(index, "wasted motion", null);
  assert.deepEqual(result.map((e) => e.title), ["Churn (code)"]);
});

test("filterTerms matches a query against quote text", () => {
  const result = filterTerms(index, "good marketing", null);
  assert.deepEqual(result.map((e) => e.title), ["Agentic / agent loop"]);
});

test("filterTerms is case-insensitive", () => {
  const result = filterTerms(index, "EVAL", null);
  assert.deepEqual(result.map((e) => e.title), ["Eval"]);
});

test("filterTerms filters by tag alone", () => {
  const result = filterTerms(index, "", "culture-vibes");
  assert.deepEqual(result.map((e) => e.title), ["Churn (code)"]);
});

test("filterTerms combines tag and query", () => {
  const result = filterTerms(index, "eval", "culture-vibes");
  assert.deepEqual(result, []);
});

test("pickWordOfDay is deterministic for the same date and term list", () => {
  const date = new Date("2026-08-10T12:00:00Z");
  assert.deepEqual(pickWordOfDay(date, index), pickWordOfDay(date, index));
});

test("pickWordOfDay picks the same UTC calendar day regardless of local hour", () => {
  const morning = new Date("2026-08-10T00:30:00Z");
  const night = new Date("2026-08-10T23:30:00Z");
  assert.deepEqual(pickWordOfDay(morning, index), pickWordOfDay(night, index));
});

test("pickWordOfDay can pick a different term on a different day", () => {
  // With a 3-term list, consecutive days should not all collide.
  const day1 = pickWordOfDay(new Date("2026-01-01T00:00:00Z"), index);
  const day2 = pickWordOfDay(new Date("2026-01-02T00:00:00Z"), index);
  const day3 = pickWordOfDay(new Date("2026-01-03T00:00:00Z"), index);
  const picks = new Set([day1.slug, day2.slug, day3.slug]);
  assert.ok(picks.size > 1, "expected at least two distinct picks across three consecutive days");
});

test("pickWordOfDay throws on an empty term list", () => {
  assert.throws(() => pickWordOfDay(new Date(), []));
});

test("parseUrlSearchState reads q and tag from a query string", () => {
  assert.deepEqual(parseUrlSearchState("?q=vibe&tag=culture-vibes"), {
    q: "vibe",
    tag: "culture-vibes",
  });
});

test("parseUrlSearchState defaults q to empty string and tag to null when absent", () => {
  assert.deepEqual(parseUrlSearchState(""), { q: "", tag: null });
});

test("buildUrlSearchState round-trips through parseUrlSearchState", () => {
  const state = { q: "vibe", tag: "culture-vibes" };
  assert.deepEqual(parseUrlSearchState(buildUrlSearchState(state)), state);
});

test("buildUrlSearchState produces an empty string when nothing is set", () => {
  assert.equal(buildUrlSearchState({ q: "", tag: null }), "");
});

test("buildUrlSearchState omits q when empty but keeps tag", () => {
  assert.equal(buildUrlSearchState({ q: "", tag: "culture-vibes" }), "?tag=culture-vibes");
});
