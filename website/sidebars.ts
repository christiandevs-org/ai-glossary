import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// No category pages left to list — every remaining doc is a term page, and
// term pages opt out of the sidebar individually via `displayed_sidebar:
// null` (scripts/generate-docs.ts). Docusaurus still requires this file to
// export something.
const sidebars: SidebarsConfig = {
  glossarySidebar: [],
};

export default sidebars;
