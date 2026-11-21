// Where the document renderers (Mermaid, KaTeX) are, as each app ships them.
//
// The files live once in the repository (`src/nsh-ui/assets/vendor`), and an
// app can only ship files inside its own directory, so every entry registers
// its own `?url` imports here before the UI's modules run: the web build from
// `src/nsh-ui/WebApp.tsx`, the desktop and phone apps from their `src/`
// (gitignored copies, `scripts/sync-nsh-vendor-assets.mjs`). `App.tsx` imports no
// renderer itself, because the native entries import it from outside its
// directory. Without a registration (tests, `nsh run` of `App.tsx`) diagrams
// and formulas show as their source.
//
// This module imports nothing, so an entry can load it first.

export interface DocumentRendererAssets {
  /** `mermaid.min.js`. */
  mermaidScript: string;
  /** `katex.min.js`. */
  katexScript: string;
  /** `katex.css` with its fonts inlined. */
  katexStyle: string;
}

let registered: DocumentRendererAssets | null = null;

export function setRendererAssets(assets: DocumentRendererAssets): void {
  registered = assets;
}

export function rendererAssets(): DocumentRendererAssets | null {
  return registered;
}
