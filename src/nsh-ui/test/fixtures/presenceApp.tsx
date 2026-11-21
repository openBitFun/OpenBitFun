// The desktop presence alone, for `test/desktop-presence.test.tsx`: card and
// pet windows over a fleet entry through the test OBP socket, started the way
// the native shell starts them (`nshDesktopShell.ts` › `startIntegration`).
import "./installObpSocket";
import "./installTestPresence";
// The shell loads its stores before the scenes (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { host, mount, Text, View } from "nsh";
import { startAttentionStore } from "../../src/attentionStore";
import { openHostEventChannel } from "../../src/bridge";
import { startDesktopPresence } from "../../src/desktopPresence";
import { loadWorkspaces } from "../../src/state";
import { palette } from "../../src/theme";

openHostEventChannel();
void loadWorkspaces();
startAttentionStore();

function PresenceHarness() {
  startDesktopPresence(
    {
      openInbox: () => host.post("openbitfun.presence", { action: "openInbox" }),
      openPetSettings: () => host.post("openbitfun.presence", { action: "openPetSettings" }),
      showMain: () => host.post("openbitfun.presence", { action: "showMain" }),
    },
    { force: true },
  );
  return (
    <View style={{ flex: 1, backgroundColor: palette().canvas }}>
      <Text>Presence harness</Text>
    </View>
  );
}

mount(PresenceHarness);
