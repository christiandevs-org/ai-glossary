#!/usr/bin/env node
/**
 * Glossary linter for README.md.
 *
 * Runs on Node >=23.6 via native TypeScript type-stripping — no build step, no
 * dependencies, no node_modules. Erasable syntax only: no enums, no namespaces,
 * no parameter properties.
 *
 *   node scripts/lint.ts [file]     lint
 *   node --test scripts/            run the test suite
 *
 * Exit 1 on any error. Warnings report but do not fail the run.
 *
 * Scope: this checks the mechanical rules only — structure, ordering, anchors,
 * banned patterns. Judgment calls (is this the right section, is the voice
 * right, is the blockquote real dialogue) live in .claude/skills/add-term and
 * are deliberately not approximated here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Severity = "error" | "warn";

export type Finding = {
  severity: Severity;
  line: number;
  rule: string;
  message: string;
};

/** A run of consecutive non-blank lines inside an entry. */
type Block = {
  lines: string[];
  start: number;
};

type Entry = {
  heading: string;
  slug: string;
  aliases: string[];
  /** Heading carries a `(disambiguator)`, so its bare name is shared by design. */
  disambiguated: boolean;
  line: number;
  section: string;
  blocks: Block[];
};

type Section = {
  heading: string;
  line: number;
  entries: Entry[];
};

/**
 * The six settled sections. Adding a seventh is a deliberate speed bump: update
 * this list, and expect to justify it in the PR.
 */
const SECTIONS = [
  "🛠️ Building & Ops",
  "📈 Business & Strategy",
  "🔥 Culture & Vibes",
  "🤖 Model Behavior",
  "💬 Prompting & Context",
  "🔒 Security & Trust",
];

/**
 * Entries exempt from `definition/reference`, because naming the other term IS
 * the entry — these are the deliberate traps documented in CONTRIBUTING.md.
 * Deleting the reference would delete the point of the entry.
 *
 * Extending this list requires a reason in the PR. It is not a convenience
 * hatch for "the sentence read better with the reference in it".
 */
const TRAP_EXEMPT = new Set([
  "Cooked",
  "Cracked",
  "One-shotted",
  "Mode collapse",
  "Model collapse",
]);

/**
 * Jargon that must have its own entry before a definition may lean on it.
 * A linter cannot infer which unfamiliar words deserve an entry, so the
 * watchlist is curated: add a term here when you catch a definition using it
 * undefined. Firing means "write that entry too, in the same change".
 */
const LOAD_BEARING = [
  "RLHF",
  "LoRA",
  "KV cache",
  "speculative decoding",
  "mixture of experts",
  "chain of draft",
  "constitutional AI",
  "context compaction",
  "semantic cache",
  "reranking",
  "agent washing",
  "tool poisoning",
  "mode collapse",
  "alignment tax",
];

const SENTENCES_WARN = 4;
const SENTENCES_MAX = 4;
const RELATED_WARN = 4;
const MIN_ALIAS_LENGTH = 3;

const RELATED_PREFIX = "**Related terms:**";

/** Abbreviations whose trailing period is not a sentence boundary. */
const ABBREVIATION =
  /\b(?:al|vs|etc|cf|e\.g|i\.e|Dr|Mr|Ms|Mrs|Prof|Inc|Ltd|St|approx|fig|no|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.$/i;

/**
 * Positional references are banned because sorting moves entries. Matched as
 * phrases, never as bare words — "System prompt" legitimately contains "sitting
 * above user turns".
 */
const POSITIONAL =
  /\b(?:sense|senses|entry|entries|term|terms|example|examples|section|sections|definition|definitions)\s+(?:above|below)\b|\b(?:see|listed|as|noted|described|shown|mentioned)\s+(?:above|below)\b|\b(?:previous|preceding|next|following)\s+(?:entry|term|section|definition)\b|\bthe\s+(?:above|below)\b/i;

const NUMBERED_REF = /(?:^|[\s(])#\d+\b/;

const BULLET = /^\s*(?:[-*+]\s|\d+[.)]\s)/;

const EMOJI = /\p{Extended_Pictographic}/u;

const MD_LINK = /\[[^\]]*\]\([^)]*\)/;

const RELATED_ITEM = /^\[([^\]]+)\]\(#([^)]+)\)$/;

/** GitHub heading-anchor rules: lowercase, drop punctuation, spaces to hyphens. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Alphabetical sort key: case-insensitive, punctuation and emoji stripped. */
export function sortKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Names a heading can be referred to by. `Human in the loop (HITL)` yields both
 * "Human in the loop" and "HITL"; `Zero-shot / few-shot` yields both halves.
 */
export function aliases(heading: string): string[] {
  const out: string[] = [];
  for (const part of heading.split(/\s\/\s|\svs\.\s/)) {
    // A parenthetical is an alias only when it is an acronym (HITL, CoT), not
    // a disambiguator — `Churn (code)` must not claim the word "code".
    const parenthetical = part.match(/\(([^)]+)\)/);
    if (parenthetical !== null) {
      const inner = parenthetical[1].trim();
      const capitals = inner.replace(/[^A-Z]/g, "").length;
      if (capitals >= 2 && /^[A-Za-z]+$/.test(inner)) out.push(inner);
    }
    const bare = part
      .replace(/\([^)]*\)/g, "")
      .replace(/["']/g, "")
      .trim();
    if (bare !== "") out.push(bare);
  }
  return out.filter((a) => a.length >= MIN_ALIAS_LENGTH);
}

/**
 * True when a heading is disambiguated by a parenthetical, as in `Churn (code)`
 * / `Churn (customer)`. Those entries share a bare name deliberately, so the
 * bare name is not exclusive to either and cannot be a duplicate.
 */
export function isDisambiguated(heading: string): boolean {
  const parenthetical = heading.match(/\(([^)]+)\)/);
  if (parenthetical === null) return false;
  const inner = parenthetical[1].trim();
  return inner.replace(/[^A-Z]/g, "").length < 2;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches an alias as a whole word, tolerating a plural or possessive suffix. */
function mentions(text: string, alias: string): boolean {
  return new RegExp(`\\b${escapeRegExp(alias)}(?:'?s)?\\b`, "i").test(text);
}

export function countSentences(text: string): number {
  const re = /[.!?]["')\]]*(?=\s|$)/g;
  let count = 0;
  let match = re.exec(text);
  while (match !== null) {
    if (!ABBREVIATION.test(text.slice(0, match.index + 1))) count += 1;
    match = re.exec(text);
  }
  return Math.max(count, 1);
}

function parse(content: string): { sections: Section[]; findings: Finding[] } {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const findings: Finding[] = [];
  let section: Section | null = null;
  let entry: Entry | null = null;
  let block: Block | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const text = raw.trim();

    if (raw.startsWith("## ")) {
      if (block !== null && entry !== null) entry.blocks.push(block);
      block = null;
      entry = null;
      section = { heading: raw.slice(3).trim(), line: lineNo, entries: [] };
      sections.push(section);
      continue;
    }

    if (raw.startsWith("### ")) {
      if (block !== null && entry !== null) entry.blocks.push(block);
      block = null;
      const heading = raw.slice(4).trim();
      entry = {
        heading,
        slug: slugify(heading),
        aliases: aliases(heading),
        disambiguated: isDisambiguated(heading),
        line: lineNo,
        section: section === null ? "" : section.heading,
        blocks: [],
      };
      if (section === null) {
        findings.push({
          severity: "error",
          line: lineNo,
          rule: "section/missing",
          message: `"${heading}" appears before any "## " section heading.`,
        });
      } else {
        section.entries.push(entry);
      }
      continue;
    }

    // Everything below only matters inside an entry.
    if (entry === null) continue;

    if (text === "" || text === "---") {
      if (block !== null) entry.blocks.push(block);
      block = null;
      continue;
    }

    if (block === null) block = { lines: [text], start: lineNo };
    else block.lines.push(text);
  }

  if (block !== null && entry !== null) entry.blocks.push(block);
  return { sections, findings };
}

function checkEntry(
  entry: Entry,
  slugs: Set<string>,
  others: Entry[],
  findings: Finding[],
): void {
  const at = entry.line;

  if (EMOJI.test(entry.heading)) {
    findings.push({
      severity: "error",
      line: at,
      rule: "heading/emoji",
      message: `"${entry.heading}" carries an emoji. Emoji belong on "## " sections only.`,
    });
  }

  // Banned patterns run first and unconditionally: a shape failure must not
  // mask them, or you fix the shape, rerun, and get a second round of errors.
  const allText = entry.blocks.flatMap((b) => b.lines).join("\n");
  const banned: [RegExp, string, string][] = [
    [/^\s*Tags:/im, "banned/tags", "per-entry tag lines were rejected"],
    [/\bSee also\b/i, "banned/see-also", "the related terms row replaced these"],
    [/<\/?(?:details|summary)\b/i, "banned/details", "collapsible sections were rejected"],
    [POSITIONAL, "banned/positional", "sorting moves entries — name the term instead"],
    [NUMBERED_REF, "banned/numbered", "terms are never referred to by number"],
  ];
  for (const [pattern, rule, why] of banned) {
    if (pattern.test(allText)) {
      findings.push({
        severity: "error",
        line: at,
        rule,
        message: `"${entry.heading}" matches a banned pattern (${rule.split("/")[1]}) — ${why}.`,
      });
    }
  }

  const blocks = entry.blocks;
  if (blocks.length !== 3) {
    findings.push({
      severity: "error",
      line: at,
      rule: "entry/shape",
      message:
        `"${entry.heading}" has ${blocks.length} block(s); expected exactly 3 ` +
        `(definition, usage blockquote, related terms row) with nothing after.`,
    });
    return;
  }

  const [definition, quote, related] = blocks;
  const definitionText = definition.lines.join(" ");

  // --- definition -----------------------------------------------------------
  if (definition.lines.some((l) => l.startsWith(">"))) {
    findings.push({
      severity: "error",
      line: definition.start,
      rule: "definition/missing",
      message: `"${entry.heading}" has no prose definition before its blockquote.`,
    });
    return;
  }
  if (definition.lines.some((l) => BULLET.test(l))) {
    findings.push({
      severity: "error",
      line: definition.start,
      rule: "definition/bullets",
      message: `"${entry.heading}" uses a list. Definitions are prose.`,
    });
  }
  if (MD_LINK.test(definitionText)) {
    findings.push({
      severity: "error",
      line: definition.start,
      rule: "definition/link",
      message:
        `"${entry.heading}" links inside its definition. Links belong in the ` +
        `related terms row.`,
    });
  }
  const sentences = countSentences(definitionText);
  if (sentences > SENTENCES_MAX) {
    findings.push({
      severity: "error",
      line: definition.start,
      rule: "definition/length",
      message: `"${entry.heading}" definition is ${sentences} sentences; ${SENTENCES_MAX} is the ceiling.`,
    });
  } else if (sentences === SENTENCES_WARN) {
    findings.push({
      severity: "warn",
      line: definition.start,
      rule: "definition/length",
      message: `"${entry.heading}" definition is ${sentences} sentences. Aim for 2–3.`,
    });
  }

  // Cross-references belong in the related terms row, not the prose. The
  // documented traps are exempt: for those, the contrast is the definition.
  if (!TRAP_EXEMPT.has(entry.heading)) {
    const own = new Set(entry.aliases.map((a) => a.toLowerCase()));
    const named = new Set<string>();
    for (const other of others) {
      if (other.heading === entry.heading) continue;
      for (const alias of other.aliases) {
        // A name the entry also claims is its own — `Churn (code)` saying
        // "rising churn" is not a reference to `Churn (customer)`.
        if (own.has(alias.toLowerCase())) continue;
        if (mentions(definitionText, alias)) named.add(other.heading);
      }
    }
    for (const name of [...named].sort()) {
      findings.push({
        severity: "error",
        line: definition.start,
        rule: "definition/reference",
        message:
          `"${entry.heading}" names "${name}" in its definition. ` +
          `Move the cross-reference to the related terms row.`,
      });
    }
  }

  // Load-bearing jargon must be defined before a definition leans on it.
  for (const term of LOAD_BEARING) {
    if (!mentions(definitionText, term)) continue;
    if (slugs.has(slugify(term))) continue;
    findings.push({
      severity: "error",
      line: definition.start,
      rule: "definition/undefined",
      message:
        `"${entry.heading}" uses "${term}", which has no entry. ` +
        `Write that entry in the same change, or reword.`,
    });
  }

  // --- usage blockquote -----------------------------------------------------
  if (!quote.lines[0].startsWith("> ")) {
    findings.push({
      severity: "error",
      line: quote.start,
      rule: "quote/missing",
      message: `"${entry.heading}" has no usage blockquote between definition and related terms.`,
    });
  } else if (quote.lines.length > 1) {
    findings.push({
      severity: "error",
      line: quote.start,
      rule: "quote/multiline",
      message: `"${entry.heading}" usage blockquote spans ${quote.lines.length} lines; keep it to one.`,
    });
  } else {
    const body = quote.lines[0].slice(2).trim();
    if (!body.startsWith('"') || !body.endsWith('"')) {
      findings.push({
        severity: "error",
        line: quote.start,
        rule: "quote/unquoted",
        message:
          `"${entry.heading}" usage line must be a quoted utterance — open and close ` +
          `with a double quote. Write dialogue, not a restatement.`,
      });
    }
    if (MD_LINK.test(body)) {
      findings.push({
        severity: "error",
        line: quote.start,
        rule: "quote/link",
        message: `"${entry.heading}" links inside its usage blockquote.`,
      });
    }
  }

  // --- related terms row ----------------------------------------------------
  const row = related.lines[0];
  if (!row.startsWith(RELATED_PREFIX)) {
    findings.push({
      severity: "error",
      line: related.start,
      rule: "related/missing",
      message: `"${entry.heading}" has no "${RELATED_PREFIX}" row. It is required, with at least one link.`,
    });
    return;
  }
  if (related.lines.length > 1) {
    findings.push({
      severity: "error",
      line: related.start,
      rule: "related/multiline",
      message: `"${entry.heading}" related terms row spans multiple lines.`,
    });
  }

  const items = row
    .slice(RELATED_PREFIX.length)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (items.length === 0) {
    findings.push({
      severity: "error",
      line: related.start,
      rule: "related/empty",
      message: `"${entry.heading}" related terms row has no links. At least one is required.`,
    });
  }
  if (items.length > RELATED_WARN) {
    findings.push({
      severity: "warn",
      line: related.start,
      rule: "related/count",
      message:
        `"${entry.heading}" lists ${items.length} related terms. Past ${RELATED_WARN} the row ` +
        `starts reading as a tag line.`,
    });
  }

  const seenAnchors = new Set<string>();
  for (const item of items) {
    const match = RELATED_ITEM.exec(item);
    if (match === null) {
      findings.push({
        severity: "error",
        line: related.start,
        rule: "related/format",
        message: `"${entry.heading}" related entry \`${item}\` is not \`[Text](#anchor)\`.`,
      });
      continue;
    }
    const [, label, anchor] = match;
    if (!slugs.has(anchor)) {
      findings.push({
        severity: "error",
        line: related.start,
        rule: "related/anchor",
        message: `"${entry.heading}" links to #${anchor}, which is not a heading in this file.`,
      });
    }
    if (slugify(label) !== anchor) {
      findings.push({
        severity: "error",
        line: related.start,
        rule: "related/label",
        message:
          `"${entry.heading}" link text "${label}" does not match its target — ` +
          `expected #${slugify(label)}, got #${anchor}.`,
      });
    }
    if (anchor === entry.slug) {
      findings.push({
        severity: "error",
        line: related.start,
        rule: "related/self",
        message: `"${entry.heading}" links to itself.`,
      });
    }
    if (seenAnchors.has(anchor)) {
      findings.push({
        severity: "error",
        line: related.start,
        rule: "related/duplicate",
        message: `"${entry.heading}" lists #${anchor} twice.`,
      });
    }
    seenAnchors.add(anchor);
  }
}

function checkOrdering(sections: Section[], findings: Finding[]): void {
  for (const section of sections) {
    if (!SECTIONS.includes(section.heading)) {
      findings.push({
        severity: "error",
        line: section.line,
        rule: "section/unknown",
        message:
          `"${section.heading}" is not one of the six settled sections. ` +
          `Adding one means updating SECTIONS in scripts/lint.ts.`,
      });
    }
    if (!EMOJI.test(section.heading)) {
      findings.push({
        severity: "error",
        line: section.line,
        rule: "section/emoji",
        message: `"${section.heading}" needs a leading emoji, then a space, then the name.`,
      });
    }

    for (let i = 1; i < section.entries.length; i += 1) {
      const prev = section.entries[i - 1];
      const curr = section.entries[i];
      if (sortKey(curr.heading) < sortKey(prev.heading)) {
        findings.push({
          severity: "error",
          line: curr.line,
          rule: "order/term",
          message: `"${curr.heading}" sorts before "${prev.heading}" — insert it at its alphabetical slot.`,
        });
      }
    }
  }

  for (let i = 1; i < sections.length; i += 1) {
    if (sortKey(sections[i].heading) < sortKey(sections[i - 1].heading)) {
      findings.push({
        severity: "error",
        line: sections[i].line,
        rule: "order/section",
        message: `"${sections[i].heading}" sorts before "${sections[i - 1].heading}".`,
      });
    }
  }
}

function checkDuplicates(entries: Entry[], findings: Finding[]): void {
  const bySlug = new Map<string, string>();
  const byAlias = new Map<string, string>();

  for (const entry of entries) {
    const clash = bySlug.get(entry.slug);
    if (clash !== undefined) {
      findings.push({
        severity: "error",
        line: entry.line,
        rule: "heading/duplicate",
        message: `"${entry.heading}" duplicates "${clash}" — both resolve to #${entry.slug}.`,
      });
    } else {
      bySlug.set(entry.slug, entry.heading);
    }

    for (const alias of entry.aliases) {
      // A disambiguated heading shares its bare name on purpose; only the full
      // heading has to be unique, and the slug check above covers that.
      if (entry.disambiguated) continue;
      const key = alias.toLowerCase();
      const owner = byAlias.get(key);
      if (owner !== undefined && owner !== entry.heading) {
        findings.push({
          severity: "error",
          line: entry.line,
          rule: "heading/duplicate-alias",
          message:
            `"${entry.heading}" and "${owner}" both claim the name "${alias}". ` +
            `Disambiguate in the heading, e.g. Churn (code) / Churn (customer).`,
        });
      } else {
        byAlias.set(key, entry.heading);
      }
    }
  }
}

/** Lint glossary markdown. Pure: no I/O, no process exit. */
export function lint(content: string): Finding[] {
  const { sections, findings } = parse(content);
  const entries = sections.flatMap((s) => s.entries);
  const slugs = new Set(entries.map((e) => e.slug));

  checkDuplicates(entries, findings);
  checkOrdering(sections, findings);
  for (const entry of entries) checkEntry(entry, slugs, entries, findings);

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

export function summarize(content: string): { sections: number; terms: number } {
  const { sections } = parse(content);
  return { sections: sections.length, terms: sections.flatMap((s) => s.entries).length };
}

function main(): void {
  const file = process.argv[2] ?? "README.md";
  const content = readFileSync(file, "utf8");
  const findings = lint(content);
  const { sections, terms } = summarize(content);

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");

  for (const f of findings) {
    const tag = f.severity === "error" ? "error" : " warn";
    console.log(`${tag}  ${file}:${f.line}  [${f.rule}]  ${f.message}`);
  }

  const counts = `${terms} terms across ${sections} sections`;
  if (findings.length === 0) console.log(`ok  ${counts} — clean.`);
  else console.log(`\n${counts} — ${errors.length} error(s), ${warnings.length} warning(s).`);

  process.exit(errors.length > 0 ? 1 : 0);
}

// Not `import.meta.main`: tsx leaves it undefined, which would make the linter
// exit 0 without checking anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
