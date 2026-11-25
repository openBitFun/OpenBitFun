// The session view alone, for `test/session-view.test.tsx`: the shared UI over
// a fleet entry through the test OBP socket, with one session of another
// device open, the scene's route and aux pane shown as text, and a control that
// leaves a review note the way the diff's "Add a note" does.
import "./installObpSocket";
// The shell loads its stores before the scenes (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { mount, Text, View } from "nsh";
import { openHostEventChannel } from "../../src/bridge";
import { fleetDeviceById } from "../../src/fleetStore";
import { startPermissionPrompts } from "../../src/permissionStore";
import { startQuestionPrompts } from "../../src/userQuestionStore";
import { addReviewNote, updateReviewNote } from "../../src/reviewStore";
import { SessionsScene } from "../../src/scenes/SessionsScene";
import { activeConversationId } from "../../src/superagentStore";
import {
  activeScene,
  activeSessionKey,
  auxPaneOpen,
  auxPaneTab,

  loadWorkspaces,
  navigateScene,
  revealedDevice,
  selectSession,
} from "../../src/state";
import { compactLayout, layout, palette } from "../../src/theme";
import { ToastHost } from "../../src/ui/overlays";

openHostEventChannel();
void loadWorkspaces();
void startQuestionPrompts();

function SessionHarness() {
  return (
    <View
      onLayout={event => compactLayout.set(event.bounds.size.width <= layout.phoneMaxWidth)}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Text testID="harness-route">{`route:${activeScene()}::${activeConversationId() ?? ""}:${revealedDevice() ?? ""}`}</Text>
        <Text testID="harness-aux">{`aux:${auxPaneOpen() ? auxPaneTab() : "closed"}`}</Text>
        <Text
          role="button"
          accessibilityLabel="harness-open-session"
          onPress={() => {
            navigateScene("sessions");
            selectSession("s-b1", "dev-b");
          }}
        >
          {fleetDeviceById("dev-b") ? "ready" : "loading"}
        </Text>
        <Text
          role="button"
          accessibilityLabel="harness-open-entry-session"
          onPress={() => {
            // Prompts are read once the entry answered with the fleet layer.
            void startPermissionPrompts();
            navigateScene("sessions");
            selectSession("session-1", "dev-a");
          }}
        >
          entry
        </Text>
        <Text
          role="button"
          accessibilityLabel="harness-add-note"
          onPress={() => {
            const key = activeSessionKey();
            if (!key) return;
            const id = addReviewNote({ sessionKey: key, path: "src/parser.rs", side: "new", start: 11, end: 11 });
            updateReviewNote(id, "Use a match here");
          }}
        >
          add note
        </Text>
      </View>
      <SessionsScene />
      <ToastHost />
    </View>
  );
}

mount(SessionHarness);
