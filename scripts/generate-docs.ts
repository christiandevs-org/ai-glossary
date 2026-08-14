#!/usr/bin/env node
/**
 * Doc generator for the website — turns README.md into Docusaurus pages.
 *
 * Runs on Node >=23.6 via native TypeScript type-stripping, same as
 * scripts/lint.ts — no build step, no dependencies, no node_modules.
 *
 *   node scripts/generate-docs.ts   generate
 *   node --test scripts/            run the test suite
 *
 * Emits one doc per "### " term at /terms/<slug>, plus search-index.json
 * for the search landing page (website/src/pages/index.tsx). There is no
 * per-category page and no docs-plugin landing page — / is owned by that
 * React page instead.
 *
 * Assumes README.md is already lint-clean (scripts/lint.ts), which
 * guarantees the three-block (definition, quote, related terms) shape
 * parseTerms relies on.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const README_PATH = join(ROOT, "README.md");
const DOCS_DIR = join(ROOT, "website", "docs");
const TERMS_DIR = join(DOCS_DIR, "terms");
const SEARCH_INDEX_PATH = join(ROOT, "website", "src", "data", "search-index.json");

export type Section = {
  emoji: string;
  title: string;
  slug: string;
  content: string;
};

export type Term = {
  title: string;
  slug: string;
  section: Section;
  definition: string;
  quote: string;
  relatedRaw: string;
};

export type SearchIndexEntry = {
  title: string;
  slug: string;
  category: string;
  categoryLabel: string;
  teaser: string;
  definition: string;
  quote: string;
};

// For file names and URLs — collapses runs of whitespace to a single hyphen.
export const slugifyFile = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

// For anchor matching — each space becomes its own hyphen (matches GitHub's
// heading-anchor algorithm, including the double-hyphen it produces for
// "Word / word" headings once the slash is stripped).
export const slugifyAnchor = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/ /g, "-");

export const parseReadme = (markdown: string): Section[] => {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let contentLines: string[] = [];
  const sectionHeaderRegex = /^## (.+)$/;
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u;

  for (const line of lines) {
    const match = line.match(sectionHeaderRegex);
    if (match) {
      if (currentSection) {
        currentSection.content = contentLines.join("\n").trim();
        sections.push(currentSection);
      }

      const rawTitle = match[1].trim();
      const emojiMatch = rawTitle.match(emojiRegex);
      const emoji = emojiMatch ? emojiMatch[0].trim() : "";
      const title = emojiMatch ? rawTitle.slice(emojiMatch[0].length) : rawTitle;

      currentSection = {
        emoji,
        title,
        slug: slugifyFile(title),
        content: "",
      };
      contentLines = [];
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = contentLines.join("\n").trim();
    sections.push(currentSection);
  }

  return sections;
};

/** Splits each section's content into individual terms on "### " headings. */
export const parseTerms = (sections: Section[]): Term[] => {
  const terms: Term[] = [];
  const headingRegex = /^### (.+)$/gm;

  for (const section of sections) {
    const matches = [...section.content.matchAll(headingRegex)];

    for (const [index, match] of matches.entries()) {
      const title = match[1].trim();
      const start = (match.index ?? 0) + match[0].length;
      const end = index + 1 < matches.length ? (matches[index + 1].index ?? start) : section.content.length;
      const body = section.content.slice(start, end).trim();

      // README.md is validated by scripts/lint.ts before this runs, which
      // guarantees exactly three blank-line-separated blocks per entry:
      // definition, usage blockquote, related terms row.
      const [definition = "", quote = "", relatedRaw = ""] = body
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block !== "");

      terms.push({
        title,
        slug: slugifyFile(title),
        section,
        definition,
        quote,
        relatedRaw,
      });
    }
  }

  return terms;
};

/** Maps a GitHub-style heading anchor to the term it belongs to. */
export const buildAnchorMap = (terms: Term[]): Map<string, Term> => {
  const map = new Map<string, Term>();
  for (const term of terms) map.set(slugifyAnchor(term.title), term);
  return map;
};

/**
 * Rewrites related-term links to point directly at the target term's own
 * page, replacing the anchor entirely. Unknown anchors are left as-is.
 */
export const rewriteRelatedTermsForTermPage = (
  relatedRaw: string,
  anchorMap: Map<string, Term>,
): string =>
  relatedRaw.replace(/\[([^\]]+)\]\(#([^)]+)\)/g, (original, linkText: string, anchor: string) => {
    const target = anchorMap.get(anchor);
    return target ? `[${linkText}](../terms/${target.slug})` : original;
  });

/** First sentence of a definition, for use as a search-result teaser. */
export const firstSentence = (text: string): string => {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : text;
};

const quoteText = (quote: string): string => quote.replace(/^>\s*/, "");

// Term headings can themselves contain double quotes (e.g. `Cook / "let him
// cook"`), which would otherwise break out of the YAML double-quoted string.
const escapeYamlDoubleQuoted = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const buildTermPageContent = (term: Term, anchorMap: Map<string, Term>): string => {
  const { section } = term;
  const related = rewriteRelatedTermsForTermPage(term.relatedRaw, anchorMap);

  return [
    "---",
    `title: "${escapeYamlDoubleQuoted(term.title)}"`,
    "displayed_sidebar: null",
    "---",
    "",
    `# ${term.title}`,
    "",
    `<a class="term-category-badge" href="/?tag=${section.slug}">${section.emoji} ${section.title}</a>`,
    "",
    "### Definition",
    "",
    term.definition,
    "",
    "### Example",
    "",
    term.quote,
    "",
    related,
    "",
  ].join("\n");
};

export const buildSearchIndex = (terms: Term[]): SearchIndexEntry[] =>
  terms.map((term) => ({
    title: term.title,
    slug: term.slug,
    category: term.section.slug,
    categoryLabel: `${term.section.emoji} ${term.section.title}`,
    teaser: firstSentence(term.definition),
    definition: term.definition,
    quote: quoteText(term.quote),
  }));

const generateDocs = () => {
  const readme = readFileSync(README_PATH, "utf-8");
  const sections = parseReadme(readme);

  if (sections.length === 0) {
    console.error("No sections found in README.md");
    process.exit(1);
  }

  // Clean and recreate docs directory
  rmSync(DOCS_DIR, { recursive: true, force: true });
  mkdirSync(DOCS_DIR, { recursive: true });

  const terms = parseTerms(sections);
  const anchorMap = buildAnchorMap(terms);

  // A related-term anchor that doesn't resolve becomes a dead same-page
  // anchor on a term page (unlike the old section pages, there's no other
  // term content on the page for it to coincidentally land on). Warn loudly
  // rather than let it fail silently.
  for (const term of terms) {
    for (const match of term.relatedRaw.matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)) {
      const anchor = match[2];
      if (!anchorMap.has(anchor)) {
        console.warn(`  ! "${term.title}" links to unresolved anchor #${anchor}`);
      }
    }
  }

  mkdirSync(TERMS_DIR, { recursive: true });

  for (const term of terms) {
    const filePath = join(TERMS_DIR, `${term.slug}.md`);
    writeFileSync(filePath, buildTermPageContent(term, anchorMap));
  }

  console.log(`  ✓ terms/ (${terms.length} term pages)`);

  const searchIndex = buildSearchIndex(terms);
  mkdirSync(dirname(SEARCH_INDEX_PATH), { recursive: true });
  writeFileSync(SEARCH_INDEX_PATH, JSON.stringify(searchIndex, null, 2));
  console.log(`  ✓ search-index.json (${searchIndex.length} terms)`);
};

if (import.meta.main) generateDocs();
