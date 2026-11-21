// The Library scene alone, for `test/library.test.tsx`. `?fleet` (the default)
// runs it over a fleet entry through the test OBP socket; the stores load the
// way the shell loads them, then the scene mounts.
import "./installObpSocket";
// The shell loads its stores before the scenes (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { mount, View } from "nsh";
import { openHostEventChannel } from "../../src/bridge";
import { LibraryScene } from "../../src/scenes/LibraryScene";
import { loadWorkspaces } from "../../src/state";
import { compactLayout, layout, palette } from "../../src/theme";

openHostEventChannel();
void loadWorkspaces();

function LibraryHarness() {
  return (
    <View
      // The shell's compact layout follows the window width; the harness does the same.
      onLayout={event => compactLayout.set(event.bounds.size.width <= layout.phoneMaxWidth)}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
    >
      <LibraryScene />
    </View>
  );
}

mount(LibraryHarness);
