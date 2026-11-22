// The OpenBitFun phone app: the shared UI (`src/nsh-ui`) on iOS and Android,
// as a controller of the account's devices. It has no backend of its own: the
// native module (`openbitfun/mobile`, `native/`) signs in, joins OpenBitFun
// Link as a controller node and opens OBP connections to devices, and the UI's
// controller shell (sign-in, devices, then the full UI on the chosen device)
// draws over that port.
//
// Order matters: in ESM, module side effects run strictly in import order.
// `nativeController` installs the mobile window shell, idle connection and
// controller port before `../../nsh-ui/App` initializes and mounts.

import "./src/nativeController";
import "./src/documentRenderers";
import "../../nsh-ui/App";
