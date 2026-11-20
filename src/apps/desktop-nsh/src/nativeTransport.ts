// Installs the in-process backend and the native shell into the shared UI.
//
// The backend runs in this process (`openbitfun-nsh`, crate `openbitfun-nsh-native`
// registers `openbitfun/native`); the UI reaches it only through the generic
// backend connection, so the same `src/nsh-ui` app runs here unchanged. This
// module must be imported before the UI so nothing calls the page host first.

import { Backend } from "openbitfun/native";
import { installBackendConnection, installWindowShell, invokeCommand, listenEvent } from "../../../nsh-ui/src/bridge";
import { createJsonWireConnection } from "../../../nsh-ui/src/jsonWireConnection";
import { createNshDesktopShell } from "../../../nsh-ui/src/nshDesktopShell";
import { startNshShellRequests } from "../../../nsh-ui/src/nshShellRequests";
import trayMark from "../assets/tray-mark.svg";

/** Members the contract marks optional: a host that lacks them is refused per call, loudly. */
interface OptionalBackendMembers {
  pickDirectory?: (optionsJson: string) => Promise<string>;
}

const optional = Backend as unknown as OptionalBackendMembers;

installBackendConnection(createJsonWireConnection(Backend, { kind: "native" }));

const shell = createNshDesktopShell({
  trayIcon: trayMark,
  pickDirectory:
    typeof optional.pickDirectory === "function"
      ? async options => {
          const text = await optional.pickDirectory!(JSON.stringify(options));
          const value: unknown = text ? JSON.parse(text) : null;
          return typeof value === "string" && value ? value : null;
        }
      : undefined,
});

installWindowShell(shell);
// The backend asks this shell for window, tray, notification, clipboard,
// login-item and lifecycle operations its commands need.
startNshShellRequests({ shell, invokeCommand, listenEvent });
