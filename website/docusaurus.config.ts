import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const GITHUB_ORG = "https://github.com/christiandevs-org";
const GITHUB_REPO = "ai-glossary";
const DOMAIN = "https://glossary.christiandevs.org";
const PAGE_TITLE = "AI Slang Dictionary";
const PAGE_TAGLINE =
  "A curated guide to modern AI developer slang, LLM jargon, and engineering terminology";

const config: Config = {
  title: PAGE_TITLE,
  tagline: PAGE_TAGLINE,
  favicon: "img/favicon.svg",
  future: {
    v4: true,
  },
  url: DOMAIN,
  baseUrl: "/",
  organizationName: "christiandevs-org",
  projectName: GITHUB_REPO,
  onBrokenLinks: "throw",
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Brand faces (ADR 0003 in the newsletter repo): Space Grotesk display,
  // Inter body, JetBrains Mono for code. Loaded from Google Fonts to match
  // how the newsletter loads them; self-hosting is a later upgrade for both.
  headTags: [
    {
      tagName: "link",
      attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" },
    },
    {
      tagName: "link",
      attributes: {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "anonymous",
      },
    },
    // .ico fallback for clients that don't take the SVG favicon.
    {
      tagName: "link",
      attributes: { rel: "alternate icon", href: "/img/favicon.ico", sizes: "any" },
    },
  ],

  stylesheets: [
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap",
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: `${GITHUB_ORG}/${GITHUB_REPO}/blob/main/CONTRIBUTING.md`,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: PAGE_TITLE,
      logo: {
        alt: "Christian Devs mark",
        src: "img/mark-light.png",
        srcDark: "img/mark-dark.png",
        width: 30,
        height: 30,
      },
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Links",
          items: [
            {
              label: "GitHub",
              href: `${GITHUB_ORG}/${GITHUB_REPO}`,
            },
            {
              label: "Contribute",
              href: `${GITHUB_ORG}/${GITHUB_REPO}/blob/main/CONTRIBUTING.md`,
            },
            {
              label: "Christian Devs",
              href: "https://christiandevs.org",
            },
          ],
        },
      ],
      // Rendered as raw HTML, so the epigraph and the credit line share this
      // one field rather than needing a swizzled Footer.
      copyright: `
        <blockquote class="footer__quote">
          &ldquo;My people are destroyed for a lack of knowledge&hellip;&rdquo;
          <cite>Hosea 4:6</cite>
        </blockquote>
        <span class="footer__credit">Made with ❤️. A ChristianDevs project.</span>
      `,
    },
    prism: {
      theme: prismThemes.github,
      // vsDark over the template's dracula — the purple cast fights the brand's
      // near-black + cyan palette.
      darkTheme: prismThemes.vsDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
