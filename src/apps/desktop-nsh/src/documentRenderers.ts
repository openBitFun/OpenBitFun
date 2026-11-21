// This app's copy of the document renderers (Mermaid, KaTeX) for the shared
// UI (`src/nsh-ui/src/documentRenderers.ts`). nsh ships only files inside the
// app's directory (symlinks resolve outside and are refused), so `assets/vendor`
// is a gitignored copy of `src/nsh-ui/assets/vendor`, the one in the repository,
// written by `scripts/sync-nsh-vendor-assets.mjs` before every native build.
import { setRendererAssets } from "../../../nsh-ui/src/documentRenderers";
import mermaidScript from "../assets/vendor/mermaid-10.9.1/mermaid.min.js?url";
import katexScript from "../assets/vendor/katex-0.16.11/katex.min.js?url";
import katexStyle from "../assets/vendor/katex-0.16.11/katex.css?url";

setRendererAssets({ mermaidScript, katexScript, katexStyle });
