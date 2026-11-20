// The OpenBitFun phone app: the shared UI (`src/nsh-ui`) on iOS and Android,
// as a controller of the account's devices. It has no backend of its own: the
// native module (`openbitfun/mobile`, `native/`) signs in, joins OpenBitFun
// Link as a controller node and opens OBP connections to devices, and the UI's
// controller shell (sign-in, devices, then the full UI on the chosen device)
// draws over that port.
//
// Order matters: the controller port is installed before the UI's modules run,
// and the UI's `App.tsx` mounts itself.

import "./src/nativeController";
import "../../nsh-ui/App";
