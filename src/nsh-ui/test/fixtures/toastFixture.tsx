import { Text, View, mount } from "nsh";
import { palette } from "../../src/theme";
import { ToastHost, pushToast } from "../../src/ui/overlays";

function ToastHarness() {
  return (
    <View style={{ flex: 1, backgroundColor: palette().canvas }}>
      <View role="button" accessibilityLabel="push-success" onPress={() => pushToast("Saved settings", "success")}>
        <Text>push-success</Text>
      </View>
      <View role="button" accessibilityLabel="push-error" onPress={() => pushToast("Action failed", "error")}>
        <Text>push-error</Text>
      </View>
      <ToastHost />
    </View>
  );
}

mount(ToastHarness);
