import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import { useHistory, useLocation } from "@docusaurus/router";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import {
  filterTerms,
  pickWordOfDay,
  parseUrlSearchState,
  buildUrlSearchState,
  type SearchIndexEntry,
} from "../lib/search";
import rawSearchIndex from "../data/search-index.json";

const searchIndex = rawSearchIndex as SearchIndexEntry[];

// Suggestion dropdown depth — enough to scan without the list outgrowing the
// viewport on a small screen.
const MAX_SUGGESTIONS = 8;

// One chip per category, in first-seen (README) order — search-index.json
// preserves README order, so this doesn't need a separate sort.
const categories: { slug: string; label: string }[] = [];
for (const entry of searchIndex) {
  if (!categories.some((c) => c.slug === entry.category)) {
    categories.push({ slug: entry.category, label: entry.categoryLabel });
  }
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  const location = useLocation();
  const history = useHistory();

  const [query, setQuery] = useState(() => parseUrlSearchState(location.search).q);
  const [tag, setTag] = useState<string | null>(() => parseUrlSearchState(location.search).tag);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Keep the tag in sync when the URL changes from outside this component's
  // own writes (back/forward, a pasted link, the category badge on a term
  // page linking to /?tag=<slug>). The query has no URL state of its own —
  // it's a transient jump-to-term input, not a shareable filter.
  useEffect(() => {
    setTag(parseUrlSearchState(location.search).tag);
    // location.search is the only dependency that matters here — location
    // itself is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleTagSelect = (nextTag: string) => {
    const value = tag === nextTag ? null : nextTag;
    setTag(value);
    history.push({
      pathname: location.pathname,
      search: buildUrlSearchState({ q: "", tag: value }),
    });
  };

  // Computed after mount, not during render: src/pages/*.tsx is server-
  // rendered at `docusaurus build` time, so `new Date()` in render would
  // bake in the build machine's day rather than the visitor's — precisely
  // the build-time-baking the spec calls out to avoid.
  const [wordOfDay, setWordOfDay] = useState<SearchIndexEntry | null>(null);
  useEffect(() => {
    setWordOfDay(pickWordOfDay(new Date(), searchIndex));
  }, []);

  // The sidebar always shows the full list, narrowed only by category — never
  // by the search box. Search is a separate jump-to-term typeahead below.
  const sidebarResults = useMemo(() => filterTerms(searchIndex, "", tag), [tag]);

  // Suggestions search the whole glossary regardless of the active category
  // pill — picking one is a direct jump, not a refinement of the sidebar.
  const suggestions = useMemo(() => {
    if (query.trim() === "") return [];
    return filterTerms(searchIndex, query, null).slice(0, MAX_SUGGESTIONS);
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions]);

  const navigateToTerm = (slug: string) => {
    setIsDropdownOpen(false);
    setQuery("");
    history.push(`/terms/${slug}`);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsDropdownOpen(value.trim() !== "");
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigateToTerm(suggestions[activeIndex].slug);
    } else if (event.key === "Escape") {
      setIsDropdownOpen(false);
    }
  };

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main className="search-landing">
        <div className="search-landing__layout">
          <div className="search-landing__primary">
            <h1 className="search-landing__heading">{siteConfig.title}</h1>
            <p className="search-landing__description">
              This site exists to help navigate the jargon that comes with software engineering and
              AI development. Search a term to learn more.
            </p>
            <div className="search-landing__search">
              <input
                type="search"
                className="search-landing__input"
                placeholder="Jump to a term…"
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onFocus={() => setIsDropdownOpen(query.trim() !== "")}
                onBlur={() => window.setTimeout(() => setIsDropdownOpen(false), 100)}
                onKeyDown={handleInputKeyDown}
                aria-label="Jump to a term"
                aria-autocomplete="list"
                aria-expanded={isDropdownOpen && suggestions.length > 0}
                role="combobox"
                autoComplete="off"
              />

              {isDropdownOpen && suggestions.length > 0 && (
                <ul className="search-landing__suggestions" role="listbox">
                  {suggestions.map((entry, index) => (
                    <li
                      key={entry.slug}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={
                        "search-landing__suggestion" +
                        (index === activeIndex ? " search-landing__suggestion--active" : "")
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();
                        navigateToTerm(entry.slug);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className="search-landing__suggestion-title">{entry.title}</span>
                      <span className="search-landing__suggestion-tag">{entry.categoryLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {wordOfDay && (
              <section className="search-landing__word-of-day" aria-label="Word of the day">
                <div className="search-landing__word-of-day-label">Word of the day</div>

                {/* Title + category on one row: was two stacked lines, which read as
                    just another item in the label/title/pill/label/... stack below
                    instead of a card header. */}
                <div className="search-landing__word-of-day-header">
                  <Link to={`/terms/${wordOfDay.slug}`} className="search-landing__word-of-day-title">
                    {wordOfDay.title}
                  </Link>
                  <span className="search-landing__word-of-day-category">{wordOfDay.categoryLabel}</span>
                </div>

                {/* Hairline divider before the body — same device .markdown h3 uses to
                    separate a term's own heading from its content, reused here so the
                    card's header/body split reads the same way as the rest of the site. */}
                <div className="search-landing__word-of-day-body">
                  <div className="search-landing__word-of-day-section-label">Definition</div>
                  <p className="search-landing__word-of-day-definition">{wordOfDay.definition}</p>

                  <div className="search-landing__word-of-day-section-label">Usage</div>
                  <p className="search-landing__word-of-day-quote">{wordOfDay.quote}</p>
                </div>
              </section>
            )}
          </div>
          <aside className="search-landing__sidebar" aria-label="All terms">
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
              {sidebarResults.map((entry) => (
                <li key={entry.slug} className="search-landing__result">
                  <Link to={`/terms/${entry.slug}`} className="search-landing__result-link">
                    <span className="search-landing__result-title">{entry.title}</span>
                    <span className="search-landing__result-tag">{entry.categoryLabel}</span>
                    <span className="search-landing__result-teaser">{entry.teaser}</span>
                  </Link>
                </li>
              ))}
              {sidebarResults.length === 0 && (
                <li className="search-landing__empty">No terms in this category.</li>
              )}
            </ul>
          </aside>
        </div>
      </main>
    </Layout>
  );
}
