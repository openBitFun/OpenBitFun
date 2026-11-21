// The web build's renderer files (`documentRenderers.ts`), from this app's own directory.
import { setRendererAssets } from "./documentRenderers";
import mermaidScript from "../assets/vendor/mermaid-10.9.1/mermaid.min.js?url";
import katexScript from "../assets/vendor/katex-0.16.11/katex.min.js?url";
import katexStyle from "../assets/vendor/katex-0.16.11/katex.css?url";

setRendererAssets({ mermaidScript, katexScript, katexStyle });
