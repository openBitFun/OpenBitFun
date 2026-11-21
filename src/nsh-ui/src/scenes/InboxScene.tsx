// The Inbox (visual spec §4.4): everything that waits on you, from every
// device, answerable in place. The page (route `"inbox"`) and the ⌘I sheet
// (`InboxSheet`, 440 on the right) draw the same `AttentionTray`.
//
// Display only: the groups, their order, the badge and every item come from
// the backend (`attentionStore`).

import { Scroll, Text, View, createMotion, reduceMotion } from "nsh";
import { inboxSheetOpen, startAttentionStore, type AttentionEntry, type PromptAnswer } from "../attentionStore";
import type { FleetPrompt } from "../fleetTypes";
import {
  clearInboxHistory,
  inboxCanClear,
  inboxGroups,
  inboxHasReadable,
  inboxIsLocal,
  markInboxRead,
} from "../localInboxStore";
import { answerPermission } from "../permissionStore";
import { tr } from "../i18n";
import { activeConversationId } from "../superagentStore";
import { navigateScene, openDevicePage, selectSession } from "../state";
import { compactLayout, elevationScrim, elevationShadow, layout, palette, radii, space, textStyle } from "../theme";
import { AttentionTray } from "../ui/attention";
import { IconButton, Button } from "../ui/primitives";
import { pushToast } from "../ui/overlays";
import { MOTION_DURATION, MOTION_EASE_DRAWER_BEZIER } from "../ui/motion";

export { inboxSheetOpen };

/** Opens what an item belongs to: an OpenBitFun conversation or a device's session. */
export function openAttentionEntry(entry: AttentionEntry): void {
  inboxSheetOpen.set(false);
  if (entry.source.conversationId) {
    activeConversationId.set(entry.source.conversationId);
    navigateScene("openbitfun");
    return;
  }
  if (entry.source.sessionId) {
    selectSession(entry.source.sessionId, entry.source.deviceId || undefined);
    navigateScene("sessions");
  }
}

function openDevice(deviceId: string): void {
  inboxSheetOpen.set(false);
  openDevicePage(deviceId);
}

function answeredToast(entry: AttentionEntry): void {
  const device = entry.deviceName ?? "";
  if (device) pushToast(tr("inbox.answeredToast", { device }), "neutral", 4000);
}

/** "Mark all as read" shows only while there are Done or Failed items to mark. */
function canMarkRead(): boolean {
  return inboxHasReadable();
}

/** Without the fleet layer an approval is this backend's own: `permissionStore` answers it and drops it. */
async function sendLocalPrompt(prompt: FleetPrompt, answer: PromptAnswer): Promise<void> {
  if (answer.kind !== "permission") return;
  await answerPermission(prompt.promptId, answer.reply);
}

function sendPrompt() {
  return inboxIsLocal() ? sendLocalPrompt : undefined;
}

function InboxHeader(props: { sheet?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 28 }}>
      {/* On a phone the shell's 48 top bar already says "Inbox". */}
      <If when={props.sheet || !compactLayout()} else={<View style={{ flex: 1 }} />}>
        <Text role="header" style={{ ...textStyle(props.sheet ? "sectionTitle" : "pageTitle"), flex: 1, minWidth: 0 }}>
          {tr("inbox.title")}
        </Text>
      </If>
      <If when={canMarkRead()}>
        <Button
          label={tr("inbox.markAllRead")}
          variant="ghost"
          size="sm"
          accessibilityLabel="inbox-mark-all-read"
          onPress={() => void markInboxRead()}
        />
      </If>
      <If when={inboxCanClear()}>
        <Button
          label={tr("inbox.clear")}
          variant="ghost"
          size="sm"
          accessibilityLabel="inbox-clear"
          onPress={() => clearInboxHistory()}
        />
      </If>
      <If when={Boolean(props.sheet)}>
        <IconButton icon="close" size="sm" accessibilityLabel={tr("common.close")} onPress={() => inboxSheetOpen.set(false)} />
      </If>
    </View>
  );
}

/** The Inbox page: 720 wide, top 32 (16 on a phone), title, 24, the groups. */
export function InboxScene() {
  startAttentionStore();
  return (
    <Scroll testID="inbox-scene" style={{ flex: 1, minHeight: 0 }} scrollbar={true}>
      <View
        style={{
          width: "100%",
          maxWidth: layout.pageWidth + 2 * (compactLayout() ? layout.phoneGutter : layout.pageGutter),
          alignSelf: "center",
          paddingTop: compactLayout() ? layout.phonePagePaddingTop : layout.pagePaddingTop,
          paddingBottom: space.x5l,
          paddingHorizontal: compactLayout() ? layout.phoneGutter : layout.pageGutter,
          gap: layout.titleToSection,
        }}
      >
        <InboxHeader />
        <AttentionTray
          groups={inboxGroups()}
          sendPrompt={sendPrompt()}
          onOpen={openAttentionEntry}
          onDevice={openDevice}
          onAnswered={answeredToast}
        />
      </View>
    </Scroll>
  );
}

const SHEET_WIDTH = 440;

function sheetMotion() {
  return createMotion({
    enter: reduceMotion()
      ? { keyframes: { opacity: [0, 1] }, duration: 120, easing: "ease", ignoreReduceMotion: true }
      : { keyframes: { opacity: [0, 1], translateX: [24, 0] }, duration: MOTION_DURATION.toast, easing: MOTION_EASE_DRAWER_BEZIER },
  });
}

function SheetPanel() {
  const motion = sheetMotion();
  return (
    <View
      testID="inbox-sheet"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 40, flexDirection: "row" }}
    >
      <View
        role="button"
        accessibilityLabel={tr("common.close")}
        onPress={() => inboxSheetOpen.set(false)}
        style={{ flex: 1, backgroundColor: elevationScrim() }}
      />
      <View
        style={[
          {
            width: compactLayout() ? "100%" : SHEET_WIDTH,
            height: "100%",
            backgroundColor: palette().canvas,
            borderLeftWidth: 1,
            borderColor: palette().borderSubtle,
            boxShadow: elevationShadow(3),
            borderTopLeftRadius: compactLayout() ? 0 : radii.lg,
            borderBottomLeftRadius: compactLayout() ? 0 : radii.lg,
            borderCurve: "continuous",
          },
          motion.style,
        ]}
      >
        <Scroll style={{ flex: 1, minHeight: 0 }} scrollbar={true}>
          <View style={{ padding: space.xxl, gap: space.xl }}>
            <InboxHeader sheet={true} />
            <AttentionTray
              groups={inboxGroups()}
              sendPrompt={sendPrompt()}
              onOpen={openAttentionEntry}
              onDevice={openDevice}
              onAnswered={answeredToast}
            />
          </View>
        </Scroll>
      </View>
    </View>
  );
}

/** The ⌘I sheet: the same list, 440 wide on the right, over a scrim. */
export function InboxSheet() {
  startAttentionStore();
  return (
    <If when={inboxSheetOpen()}>
      <SheetPanel />
    </If>
  );
}
