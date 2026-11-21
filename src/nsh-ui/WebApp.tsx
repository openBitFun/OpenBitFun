// The web build of the UI (`nsh package src/nsh-ui/WebApp.tsx --target web`):
// `App.tsx` plus the renderer files this directory ships. The native entries
// import `App.tsx` and register their own copies (see `src/documentRenderers.ts`).

import "./src/registerWebRenderers";
import "./App";
