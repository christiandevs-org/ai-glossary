import { useState, useEffect, useMemo } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import { useHistory, useLocation } from "@docusaurus/router";

import {
  filterTerms,
  pickWordOfDay,
  parseUrlSearchState,
  buildUrlSearchState,
  type SearchIndexEntry,
} from "../lib/search";
import rawSearchIndex from "../data/search-index.json";

const searchIndex = rawSearchIndex as SearchIndexEntry[];

// One chip per category, in first-seen (README) order — search-index.json
// preserves README order, so this doesn't need a separate sort.
const categories: { slug: string; label: string }[] = [];
for (const entry of searchIndex) {
  if (!categories.some((c) => c.slug === entry.category)) {
    categories.push({ slug: entry.category, label: entry.categoryLabel });
  }
}

export default function SearchPreview() {
  const location = useLocation();
  const history = useHistory();

  const [query, setQuery] = useState(() => parseUrlSearchState(location.search).q);
  const [tag, setTag] = useState<string | null>(() => parseUrlSearchState(location.search).tag);

  // Keep local state in sync when the URL changes from outside this
  // component's own writes (back/forward, a pasted link).
  useEffect(() => {
    const next = parseUrlSearchState(location.search);
    setQuery(next.q);
    setTag(next.tag);
    // location.search is the only dependency that matters here — location
    // itself is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Typing replaces the current history entry — a push per keystroke would
  // turn "back" into stepping through characters instead of leaving the
  // page. Selecting a tag is one deliberate action, so it earns its own
  // history entry.
  const handleQueryChange = (value: string) => {
    setQuery(value);
    history.replace({ pathname: location.pathname, search: buildUrlSearchState({ q: value, tag }) });
  };

  const handleTagSelect = (nextTag: string) => {
    const value = tag === nextTag ? null : nextTag;
    setTag(value);
    history.push({ pathname: location.pathname, search: buildUrlSearchState({ q: query, tag: value }) });
  };

  // Computed after mount, not during render: src/pages/*.tsx is server-
  // rendered at `docusaurus build` time, so `new Date()` in render would
  // bake in the build machine's day rather than the visitor's — precisely
  // the build-time-baking the spec calls out to avoid.
  const [wordOfDay, setWordOfDay] = useState<SearchIndexEntry | null>(null);
  useEffect(() => {
    setWordOfDay(pickWordOfDay(new Date(), searchIndex));
  }, []);

  const results = useMemo(() => filterTerms(searchIndex, query, tag), [query, tag]);

  return (
    <Layout title="Search" description="Look up a term in the AI glossary.">
      <main className="search-landing">
        <input
          type="search"
          className="search-landing__input"
          placeholder="Search the glossary…"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          aria-label="Search terms"
        />

        {wordOfDay && (
          <section className="search-landing__word-of-day" aria-label="Word of the day">
            <div className="search-landing__word-of-day-label">Word of the day</div>
            <Link to={`/terms/${wordOfDay.slug}`} className="search-landing__word-of-day-title">
              {wordOfDay.title}
            </Link>
            <p className="search-landing__word-of-day-teaser">{wordOfDay.teaser}</p>
          </section>
        )}

        <div className="search-landing__tags" role="group" aria-label="Filter by category">
          {categories.map((category) => (
            <button
              key={category.slug}
              type="button"
              className={
                "search-landing__tag" +
                (tag === category.slug ? " search-landing__tag--active" : "")
              }
              aria-pressed={tag === category.slug}
              onClick={() => handleTagSelect(category.slug)}
            >
              {category.label}
            </button>
          ))}
        </div>

        <ul className="search-landing__results">
          {results.map((entry) => (
            <li key={entry.slug} className="search-landing__result">
              <Link to={`/terms/${entry.slug}`} className="search-landing__result-link">
                <span className="search-landing__result-title">{entry.title}</span>
                <span className="search-landing__result-tag">{entry.categoryLabel}</span>
                <span className="search-landing__result-teaser">{entry.teaser}</span>
              </Link>
            </li>
          ))}
          {results.length === 0 && (
            <li className="search-landing__empty">No terms match &ldquo;{query}&rdquo;.</li>
          )}
        </ul>
      </main>
    </Layout>
  );
}
