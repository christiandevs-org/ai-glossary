/**
 * Pure, framework-free search logic for the landing page — no React, no DOM
 * beyond the URL/URLSearchParams globals Node also provides natively, so this
 * is testable with plain `node:test`. The React component in
 * src/pages/search-preview.tsx is the only consumer with a DOM dependency.
 */

export type SearchIndexEntry = {
  title: string;
  slug: string;
  category: string;
  categoryLabel: string;
  teaser: string;
  definition: string;
  quote: string;
};

/**
 * Filters by category (exact match, single-select) then by substring query
 * against the full indexed text — title, teaser, definition, and quote, not
 * just the title. Always returns results sorted alphabetically by title, so
 * calling this with an empty query and no tag doubles as "the full
 * alphabetical list".
 */
export const filterTerms = (
  index: SearchIndexEntry[],
  query: string,
  tag: string | null,
): SearchIndexEntry[] => {
  const q = query.trim().toLowerCase();

  return index
    .filter((entry) => tag === null || entry.category === tag)
    .filter((entry) => {
      if (q === "") return true;
      const haystack = `${entry.title} ${entry.teaser} ${entry.definition} ${entry.quote}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
};

/**
 * The UTC calendar day of the year (1-366), so the pick is the same for
 * every visitor regardless of local time zone — "day" here means one global
 * calendar day, not local midnight.
 */
const utcDayOfYear = (date: Date): number => {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((startOfDay - startOfYear) / 86_400_000) + 1;
};

/**
 * Deterministic pick from the current date against a term list — no
 * build-time baking, no scheduled rebuild, correct regardless of when the
 * site was last deployed. Same terms + same UTC day always yields the same
 * result.
 */
export const pickWordOfDay = (date: Date, terms: SearchIndexEntry[]): SearchIndexEntry => {
  if (terms.length === 0) throw new Error("pickWordOfDay requires a non-empty term list");
  return terms[utcDayOfYear(date) % terms.length];
};

export type UrlSearchState = {
  q: string;
  tag: string | null;
};

/** Reads {q, tag} out of a location.search string (leading "?" optional). */
export const parseUrlSearchState = (search: string): UrlSearchState => {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q") ?? "",
    tag: params.get("tag"),
  };
};

/** Inverse of parseUrlSearchState — "" when neither param is set. */
export const buildUrlSearchState = (state: UrlSearchState): string => {
  const params = new URLSearchParams();
  if (state.q !== "") params.set("q", state.q);
  if (state.tag !== null) params.set("tag", state.tag);
  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
};
