// The Inbox alone, for `test/inbox.test.tsx`: the shared UI over a fleet entry
// through the test OBP socket, with the badge the shell draws and one prompt in
// a job card's placement, the way the OpenBitFun scene embeds it.
import "./installObpSocket";
// The shell loads its stores before the scenes (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { mount, Text, View } from "nsh";
import { inboxBadge, startAttentionStore } from "../../src/attentionStore";
import { openHostEventChannel } from "../../src/bridge";
import { fleetPromptList } from "../../src/fleetStore";
import { InboxScene, InboxSheet, inboxSheetOpen } from "../../src/scenes/InboxScene";
import { loadWorkspaces } from "../../src/state";
import { compactLayout, layout, palette } from "../../src/theme";
import { PromptAttention } from "../../src/ui/attention";
import { ToastHost } from "../../src/ui/overlays";

openHostEventChannel();
void loadWorkspaces();
startAttentionStore();

function InboxHarness() {
  return (
    <View
      onLayout={event => compactLayout.set(event.bounds.size.width <= layout.phoneMaxWidth)}
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Text testID="inbox-badge">{`badge:${inboxBadge()}`}</Text>
        <Text role="button" accessibilityLabel="open-inbox-sheet" onPress={() => inboxSheetOpen.set(true)}>
          sheet
        </Text>
      </View>
      <If when={fleetPromptList().find(prompt => prompt.jobId)}>
        {prompt => (
          <View testID="job-card" style={{ borderWidth: 1, borderColor: palette().borderSubtle }}>
            <PromptAttention prompt={prompt()} placement="card" testID="card-prompt" />
          </View>
        )}
      </If>
      <InboxScene />
      <InboxSheet />
      <ToastHost />
    </View>
  );
}

mount(InboxHarness);
