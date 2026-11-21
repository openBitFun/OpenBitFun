// The OpenBitFun scene beside its history slot, as the shell lays them out
// (sidebar 264 on `chromeBg`, the scene on the canvas), for
// `test/superagent-conversation.test.tsx`. The shell's own stores load first.
import "../../src/sessionStatusStore";
import "../../src/agentEvents";
import { View, mount } from "nsh";
import { loadAccountState } from "../../src/homeStore";
import { loadAppLocale } from "../../src/i18n";
import { OpenBitFunScene } from "../../src/scenes/OpenBitFunScene";
import { compactLayout, layout, palette } from "../../src/theme";
import { ConversationHistory } from "../../src/ui/jobs";
import { ToastHost } from "../../src/ui/overlays";

function Shell() {
  void loadAppLocale();
  void loadAccountState();
  return (
    <View
      style={{ flex: 1, flexDirection: "row", backgroundColor: palette().chromeBg }}
      onLayout={event => compactLayout.set(event.bounds.size.width <= layout.phoneMaxWidth)}
    >
      <If when={!compactLayout()}>
        <View style={{ width: layout.navDefaultWidth, paddingHorizontal: 8 }}>
          <ConversationHistory />
        </View>
      </If>
      <View style={{ flex: 1, minWidth: 0 }}>
        <OpenBitFunScene />
      </View>
      <ToastHost />
    </View>
  );
}

mount(Shell);
