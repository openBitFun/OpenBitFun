// The native OpenBitFun desktop: the shared UI (`src/nsh-ui`) in an AppKit /
// Win32 / GTK window, over the backend linked into this process.
//
// Order matters: the native connection and shell are installed before the UI's
// modules run, and the UI's `App.tsx` mounts itself.

import "./src/nativeTransport";
import "../../nsh-ui/App";
