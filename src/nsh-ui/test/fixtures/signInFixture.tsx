// The desktop sign-in on one page, for `test/sign-in.test.tsx`: the first-run
// screen (`SignInScreen`) and the account dialog (`openAccountAuthModal`) over
// the host's account commands.
// The shell loads its stores before the primitives (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { mount, signal, Text, View } from "nsh";
import { palette, space, textStyle } from "../../src/theme";
import { AccountAuthModal, openAccountAuthModal, SignInScreen } from "../../src/ui/AccountAuthModal";
import { ToastHost } from "../../src/ui/overlays";
import { Button } from "../../src/ui/primitives";

const finished = signal("");

function Fixture() {
  return (
    <View style={{ flex: 1, backgroundColor: palette().canvas }}>
      <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
        <Button label="Open account" onPress={() => openAccountAuthModal()} />
        <Text style={textStyle("caption")}>{finished()}</Text>
      </View>
      <If when={finished() ? "" : "1"}>
        <SignInScreen onLocalOnly={() => finished.set("local only")} onDone={() => finished.set("welcome done")} />
      </If>
      <AccountAuthModal />
      <ToastHost />
    </View>
  );
}

mount(Fixture);
