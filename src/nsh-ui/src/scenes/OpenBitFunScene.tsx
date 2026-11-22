// OpenBitFun: the conversation (visual spec §4.2 and §4.3, ux-redesign §3.1
// and §3.2). With no conversation open it is the new-conversation screen (the
// question, the composer, the backend's suggestions and "Needs you" / "Working
// now"); with one open it is the thread: the user's bubbles, OpenBitFun's
// answers, the live job cards where the model dispatched them, and the
// composer pinned to the bottom.
//
// Display only: what is drawn, in which order, with which state and which
// actions is the cloud node's (`superagentStore.ts`). There is no device
// picker or mode chip: the model decides where work runs. The composer's
// model picker chooses only where the model rounds run: Auto (the cloud node
// picks) or a device and one of its models, as the cloud node lists them.

import { Scroll, Text, View, cleanup, computed, openUrl, signal, type ScrollRef, type ViewRef } from "nsh";
import { TextView } from "nsh/base";
import { contentWidth } from "../contentWidthStore";
import { FLEET_ENTRY_LOST, fleetErrorKind } from "../fleetTypes";
import { localizeHostError, tr } from "../i18n";
import {
  activeConversationId,
  cancelTurn,
  chooseSuperagentModel,
  citedJobId,
  composerDraft,
  conversationError,
  conversationLoading,
  conversationView,
  conversationsLoaded,
  conversationGroups,
  currentModelSelection,
  enableSuperagent,
  jobCards,
  liveReply,
  modelPickError,
  pendingSend,
  refreshConversation,
  refreshSuperagentStatus,
  retryLastTurn,
  sendError,
  sendToSuperagent,
  startSuperagentStore,
  superagentPhase,
  superagentStatus,
  superagentUnavailable,
  turnRunning,
  turnStep,
  type ConversationMessage,
  type SuperagentModelSelection,
} from "../superagentStore";
import { compactLayout, controlHeight, layout, palette, radii, space, textStyle } from "../theme";
import { openAccountAuthModal } from "../ui/AccountAuthModal";
import { Icon } from "../ui/icons";
import {
  CitationChip,
  CITATION_FADE_MS,
  ConversationDialogs,
  JobStack,
  SuggestionChips,
  SuperComposer,
  WorkingNowList,
  conversationMenuItems,
  type ComposerBlocked,
} from "../ui/jobs";
import { createMarkdownCodeActions, createMarkdownStyles, STATIC_MARKDOWN_OPTIONS, STREAMING_MARKDOWN_OPTIONS } from "../ui/markdown";
import { BrandSpinner, MOTION_DURATION, paintTransition, pressTransition, tactileActiveStyle } from "../ui/motion";
import { DropdownMenu, type DropdownMenuItem } from "../ui/overlays";
import { Button, EmptyStateCard, IconButton, SkeletonBlock, focusRingStyle } from "../ui/primitives";
import { CardsStrip } from "../ui/cardView"; // wave22-p3

/** The user bubble's widest (spec §3: min(560, 72 %)). */
const USER_BUBBLE_MAX = 560;
/** "Jump to latest" shows once the reader is this far above the end (spec §4.3). */
const JUMP_THRESHOLD = 400;
/** How long a cited card holds its highlight before it fades. */
const CITATION_HOLD_MS = 1200;

function gutter(): number {
  return compactLayout() ? layout.phoneGutter : layout.pageGutter;
}

function unavailableReasonText(): string {
  const reason = superagentUnavailable()?.reason;
  switch (reason) {
    case "unreachable":
      return tr("sa.reasonUnreachable");
    case "not_provisioned":
      return tr("sa.reasonSignInAgain");
    case "update_required":
      return tr("sa.reasonUpdate");
    case "no_holder":
      return tr("sa.reasonNoHolder");
    default:
      return superagentStatus()?.reason ?? "";
  }
}

/** Signed out, off or unavailable: the reason and one action replace the composer's bottom row. */
function composerBlocked(): ComposerBlocked | null {
  switch (superagentPhase()) {
    case "signed_out":
      return {
        reason: `${tr("sa.signedOutTitle")} · ${tr("sa.signedOutBody")}`,
        actionLabel: tr("signin.signIn"),
        onAction: () => openAccountAuthModal(),
      };
    case "off":
      return {
        reason: `${tr("sa.offTitle")} · ${tr("sa.offBody")}`,
        actionLabel: tr("sa.turnOn"),
        onAction: () => void enableSuperagent(),
      };
    case "unavailable":
      return {
        reason: tr("sa.unavailable", { reason: unavailableReasonText() }).trim(),
        actionLabel: tr("common.tryAgain"),
        onAction: () => void refreshSuperagentStatus(),
      };
    default:
      return null;
  }
}

function placeholder(): string {
  if (activeConversationId()) return tr("sa.replyPlaceholder");
  return superagentStatus()?.placeholder || tr("sa.placeholder");
}

/** Why a device's models cannot be picked now, as the cloud node said. */
function modelDeviceNote(reason: string | undefined): string {
  switch (reason) {
    case "device_offline":
      return tr("models.deviceOffline");
    case "superagent_requires_update":
    case "device_requires_update":
      return tr("models.deviceRequiresUpdate");
    case "no_model":
      return tr("models.deviceNoModel");
    default:
      return "";
  }
}

/** Why the current pick cannot run now. */
function modelPickNote(selection: SuperagentModelSelection): string {
  if (selection.mode !== "pinned") return "";
  switch (selection.unavailableReason) {
    case "device_offline":
    case "pinned_holder_offline":
      return tr("models.pickOffline");
    case "pinned_model_missing":
      return tr("models.pickMissing");
    default:
      return modelDeviceNote(selection.unavailableReason);
  }
}

function modelSelectionLabel(selection: SuperagentModelSelection): string {
  if (selection.mode !== "pinned") return tr("models.auto");
  const model = selection.modelName || selection.modelId || "";
  return selection.deviceName ? tr("models.onDevice", { model, device: selection.deviceName }) : model;
}

/** Auto, then every device with its models, in the cloud node's order. */
function modelMenuItems(): DropdownMenuItem[] {
  const selection = currentModelSelection();
  const items: DropdownMenuItem[] = [
    {
      id: "auto",
      label: tr("models.auto"),
      hint: tr("models.autoHint"),
      active: selection.mode !== "pinned",
      accessibilityLabel: "sa-model-auto",
      onSelect: () => void chooseSuperagentModel(null),
    },
  ];
  for (const device of superagentStatus()?.models ?? []) {
    const note = modelDeviceNote(device.unavailableReason);
    items.push({ id: `device:${device.deviceId}`, label: note ? `${device.name} · ${note}` : device.name, header: true });
    for (const model of device.models ?? []) {
      items.push({
        id: `model:${device.deviceId}/${model.modelId}`,
        // The model, then its provider, as the backend labelled them.
        label: model.label || model.displayName || model.modelId,
        hint: (model.label ? model.detail : model.provider) || undefined,
        trailingHint: model.primary ? tr("models.primary") : undefined,
        active: selection.mode === "pinned" && selection.deviceId === device.deviceId && selection.modelId === model.modelId,
        disabled: Boolean(device.unavailableReason),
        accessibilityLabel: `sa-model-${device.deviceId}-${model.modelId}`,
        onSelect: () => void chooseSuperagentModel({ deviceId: device.deviceId, modelId: model.modelId }),
      });
    }
  }
  return items;
}

function ModelPicker() {
  const open = signal(false);
  let anchor: ViewRef | undefined;
  return (
    <View
      ref={node => {
        anchor = node;
      }}
    >
      <Button
        label={modelSelectionLabel(currentModelSelection())}
        variant="ghost"
        size="xs"
        trailingIcon="chevron-down"
        accessibilityLabel="sa-model-picker"
        tooltip={tr("models.superAgentTitle")}
        style={compactLayout() ? { minHeight: layout.touchTarget, minWidth: layout.touchTarget } : undefined}
        onPress={() => {
          open.set(!open());
          if (open()) void refreshSuperagentStatus();
        }}
      />
      <DropdownMenu
        open={open()}
        anchor={anchor}
        placement="top"
        align="end"
        minWidth={240}
        items={modelMenuItems()}
        onClose={() => open.set(false)}
      />
    </View>
  );
}

function sendErrorText(): string {
  const raw = sendError();
  if (!raw) return "";
  if (fleetErrorKind(raw) === FLEET_ENTRY_LOST || raw.toLowerCase().includes("entry_lost")) {
    return tr("job.unconfirmed");
  }
  return localizeHostError(raw) || tr("job.unconfirmed");
}

function modelPickErrorText(): string {
  const raw = modelPickError();
  if (!raw) return "";
  return localizeHostError(raw) || tr("models.pickFailed");
}

function Composer(props: { maxFieldHeight: number }) {
  const pickNote = () => modelPickNote(currentModelSelection());
  return (
    <View style={{ gap: space.sm }}>
      <SuperComposer
        accessory={<ModelPicker />}
        value={composerDraft()}
        onChange={value => composerDraft.set(value)}
        onSubmit={() => void sendToSuperagent()}
        placeholder={placeholder()}
        running={Boolean(activeConversationId()) && turnRunning()}
        onStop={() => void cancelTurn()}
        blocked={composerBlocked()}
        maxFieldHeight={props.maxFieldHeight}
      />
      <If when={sendErrorText()}>
        {message => (
          <Text testID="sa-send-error" style={{ ...textStyle("caption", { color: palette().danger }), paddingHorizontal: space.lg }}>
            {message()}
          </Text>
        )}
      </If>
      <If when={pickNote()}>
        <Text testID="sa-model-note" style={{ ...textStyle("caption", { color: palette().warning }), paddingHorizontal: space.lg }}>
          {pickNote()}
        </Text>
      </If>
      <If when={modelPickErrorText()}>
        {message => (
          <Text testID="sa-model-error" style={{ ...textStyle("caption", { color: palette().danger }), paddingHorizontal: space.lg }}>
            {message()}
          </Text>
        )}
      </If>
    </View>
  );
}

// ── New conversation ─────────────────────────────────────────────────────────

function maxComposerHeight(height: number): number {
  return height > 0 ? Math.max(controlHeight.lg * 3, Math.round(height * 0.4)) : 320;
}

function NewConversation(props: { height: number }) {
  const workingNow = () => superagentStatus()?.workingNow ?? { needsYou: [], working: [] };
  const showEmpty = () =>
    superagentPhase() === "ready" &&
    conversationsLoaded() &&
    conversationGroups().length === 0 &&
    workingNow().needsYou.length === 0 &&
    workingNow().working.length === 0;
  return (
    <Scroll
      testID="sa-new-conversation"
      style={{ flex: 1, minHeight: 0 }}
      contentStyle={{
        flexGrow: 1,
        alignItems: "center",
        paddingHorizontal: gutter(),
        paddingTop: compactLayout() ? space.xxl : space.x3l,
        paddingBottom: space.x3l,
      }}
    >
      <If when={!compactLayout()}>
        <View style={{ flexGrow: 22, minHeight: space.x3l }} />
      </If>
      <View style={{ width: "100%", maxWidth: contentWidth(), gap: space.xxl }}>
        <Text
          style={{
            ...textStyle(compactLayout() ? "pageTitle" : "display"),
            textAlign: compactLayout() ? "left" : "center",
          }}
        >
          {tr("sa.hero")}
        </Text>
        <View style={{ gap: space.md }}>
          <Composer maxFieldHeight={maxComposerHeight(props.height)} />
          <If when={superagentPhase() === "ready"}>
            <SuggestionChips
              suggestions={(superagentStatus()?.suggestions ?? []).slice(0, 3)}
              onPick={text => composerDraft.set(text)}
            />
          </If>
        </View>
        <View style={{ paddingTop: space.sm }}>
          <WorkingNowList needsYou={workingNow().needsYou} working={workingNow().working} />
        </View>
        {/* wave22-p3: desktop cards inline on phones and in browsers. */}
        <CardsStrip />
        <If when={showEmpty()}>
          <EmptyStateCard title={tr("sa.emptyTitle")} subtitle={tr("sa.emptyBody")} />
        </If>
      </View>
      <If when={!compactLayout()}>
        <View style={{ flexGrow: 78 }} />
      </If>
    </Scroll>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────

type ThreadItem =
  | { kind: "user"; key: string; text: string; pending?: boolean }
  | { kind: "assistant"; key: string; text: string; citations: Array<{ jobId: string; label?: string }>; live?: boolean }
  | { kind: "jobs"; key: string; jobIds: string[] }
  | { kind: "notice"; key: string; text: string; failed: boolean };

function threadItemOf(message: ConversationMessage): ThreadItem | null {
  const jobIds = Array.isArray(message.jobIds) ? message.jobIds.filter(Boolean) : [];
  if (jobIds.length > 0 && (message.role === "jobs" || message.role === "tool" || message.role === "assistant")) {
    if (message.role === "assistant" && message.text?.trim()) return null; // drawn below with its cards
    return { kind: "jobs", key: message.id, jobIds };
  }
  switch (message.role) {
    case "user":
      return message.text ? { kind: "user", key: message.id, text: message.text } : null;
    case "assistant": {
      const text = message.text?.trim() ?? "";
      const citations = Array.isArray(message.citations) ? message.citations : [];
      return text || citations.length > 0 ? { kind: "assistant", key: message.id, text, citations } : null;
    }
    case "card":
      return message.text
        ? { kind: "notice", key: message.id, text: message.text, failed: message.card?.kind === "model_failed" }
        : null;
    default:
      return null;
  }
}

type ThreadRow = ThreadItem & { gap: number };

function gapBetween(previous: ThreadItem | undefined, current: ThreadItem): number {
  if (!previous) return 0;
  if (current.kind === "jobs" && previous.kind === "assistant") return space.md;
  if (current.kind === "assistant" && previous.kind === "assistant") return space.md;
  return space.xxl;
}

/**
 * The settled thread in the cloud node's order, with precomputed inter-row gaps.
 * Excludes `liveReply()` so streamed deltas never re-evaluate settled rows.
 */
const settledThreadItems = computed<ThreadRow[]>(() => {
  const items: ThreadItem[] = [];
  for (const message of conversationView()?.messages ?? []) {
    const item = threadItemOf(message);
    if (item) {
      items.push(item);
      continue;
    }
    const jobIds = Array.isArray(message.jobIds) ? message.jobIds.filter(Boolean) : [];
    if (message.role === "assistant" && jobIds.length > 0) {
      items.push({ kind: "assistant", key: `${message.id}:text`, text: message.text?.trim() ?? "", citations: message.citations ?? [] });
      items.push({ kind: "jobs", key: `${message.id}:jobs`, jobIds });
    }
  }
  const pending = pendingSend();
  if (pending && pending.conversationId === activeConversationId()) {
    items.push({ kind: "user", key: `pending:${pending.clientMessageId}`, text: pending.text, pending: true });
  }
  return items.map((item, index) => ({ ...item, gap: gapBetween(items[index - 1], item) }));
});

const hasLiveReply = computed<boolean>(() => liveReply().length > 0);
const liveReplyGap = computed<number>(() => {
  const rows = settledThreadItems();
  if (rows.length === 0) return 0;
  return rows[rows.length - 1]?.kind === "assistant" ? space.md : space.xxl;
});

function handleLink(event: { url: string }): void {
  const url = event.url.trim();
  if (/^(https?:|mailto:)/i.test(url)) void openUrl(url).catch(() => undefined);
}

function UserBubble(props: { text: string; pending?: boolean }) {
  const expanded = signal(false);
  const longText = () => props.text.length > 600 || props.text.split("\n").length > 10;
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "72%" }}>
      <View
        style={{
          maxWidth: USER_BUBBLE_MAX,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette().userBubble,
          opacity: props.pending ? 0.72 : 1,
          gap: space.xs,
          ...paintTransition(160),
        }}
      >
        <Text
          style={{
            ...textStyle("prose", { color: palette().userBubbleText }),
            userSelect: "text",
            numberOfLines: longText() && !expanded() ? 12 : undefined,
            textOverflow: longText() && !expanded() ? "ellipsis" : undefined,
          }}
        >
          {props.text}
        </Text>
        <If when={longText()}>
          <View
            role="button"
            accessibilityLabel={expanded() ? tr("session.showLess") : tr("session.showMore")}
            onPress={() => expanded.set(!expanded())}
            style={{
              alignSelf: "flex-start",
              minHeight: compactLayout() ? layout.touchTarget : controlHeight.xs,
              justifyContent: "center",
              paddingHorizontal: space.xs,
              borderRadius: radii.sm,
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
            activeStyle={tactileActiveStyle(0.98)}
            focusVisibleStyle={focusRingStyle()}
          >
            <Text style={{ ...textStyle("caption", { color: palette().textSecondary }), fontWeight: "500" }}>
              {expanded() ? tr("session.showLess") : tr("session.showMore")}
            </Text>
          </View>
        </If>
      </View>
    </View>
  );
}

function AssistantProse(props: {
  text: string;
  live?: boolean;
  citations: Array<{ jobId: string; label?: string }>;
  onCite: (jobId: string) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <If when={props.text}>
        <TextView
          markdown={props.text}
          selectable
          links="report"
          onLinkPress={handleLink}
          options={props.live ? STREAMING_MARKDOWN_OPTIONS : STATIC_MARKDOWN_OPTIONS}
          codeBlockActions={createMarkdownCodeActions()}
          styles={createMarkdownStyles({ baseFontSize: 15 })}
        />
      </If>
      <If when={props.citations.length > 0}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          <Each of={props.citations} key={(citation, index) => `${index}:${citation.jobId}`}>
            {citation => (
              <CitationChip
                testID={`cite-${citation().jobId}`}
                label={citation().label ?? jobCards()[citation().jobId]?.label ?? jobCards()[citation().jobId]?.title ?? citation().jobId}
                device={jobCards()[citation().jobId]?.deviceName}
                onPress={() => props.onCite(citation().jobId)}
              />
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}

function Notice(props: { text: string; failed: boolean; onRetry?: () => void }) {
  return (
    <If
      when={props.failed}
      else={
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <Icon name="info" size={14} color={palette().textMuted} />
          <Text style={{ ...textStyle("label", { color: palette().textMuted }), fontWeight: "400", flex: 1, minWidth: 0 }}>{props.text}</Text>
        </View>
      }
    >
      <View style={{ borderLeftWidth: 2, borderLeftColor: palette().danger, paddingLeft: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <Icon name="close" size={14} color={palette().danger} />
          <Text style={{ ...textStyle("body"), flex: 1, minWidth: 0 }}>{tr("session.turnStopped", { reason: props.text })}</Text>
        </View>
        <If when={Boolean(props.onRetry)}>
          <View style={{ alignSelf: "flex-start" }}>
            <Button
              label={tr("common.tryAgain")}
              variant="ghost"
              size="sm"
              style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
              onPress={() => props.onRetry?.()}
            />
          </View>
        </If>
      </View>
    </If>
  );
}

function ConversationSkeleton() {
  return (
    <View testID="sa-loading" style={{ gap: space.xxl, paddingVertical: space.sm }}>
      <View style={{ alignSelf: "flex-end", width: "54%", gap: space.xs }}>
        <SkeletonBlock width="100%" height={44} borderRadius={radii.lg} />
      </View>
      <View style={{ gap: space.sm }}>
        <SkeletonBlock width="84%" height={14} borderRadius={radii.xs} />
        <SkeletonBlock width="68%" height={14} borderRadius={radii.xs} />
        <SkeletonBlock width="42%" height={14} borderRadius={radii.xs} />
      </View>
    </View>
  );
}

function ThinkingLine() {
  return (
    <View testID="sa-thinking" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <BrandSpinner variant="matrix" size={12} color={palette().accent} />
      <Text style={{ ...textStyle("label", { color: palette().textMuted }), fontWeight: "400" }}>{tr("state.thinking")}</Text>
    </View>
  );
}

function ConversationHeader() {
  const menuOpen = signal(false);
  let anchor: ViewRef | undefined;
  const title = () => conversationView()?.conversation.title || tr("sa.newConversation");
  return (
    <View
      testID="sa-conversation-header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: compactLayout() ? layout.phoneTopBarHeight : layout.topBarHeight,
        paddingHorizontal: compactLayout() ? space.lg : space.xxl,
        gap: space.md,
        flexShrink: 0,
      }}
    >
      <Text style={{ ...textStyle("sectionTitle"), flex: 1, minWidth: 0, numberOfLines: 1, textOverflow: "ellipsis" }}>{title()}</Text>
      <View
        ref={node => {
          anchor = node;
        }}
      >
        <IconButton
          icon="more"
          size="sm"
          accessibilityLabel="sa-conversation-menu"
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={() => menuOpen.set(true)}
        />
      </View>
      <DropdownMenu
        open={menuOpen()}
        anchor={anchor}
        align="end"
        items={conversationMenuItems(activeConversationId() ?? "", conversationView()?.conversation.title ?? "")}
        onClose={() => menuOpen.set(false)}
      />
    </View>
  );
}

function Thread(props: { height: number }) {
  let scrollRef: ScrollRef | undefined;
  const following = signal(true);
  const distanceFromEnd = signal(0);
  const offsets = new Map<string, number>();
  let citeTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (citeTimer) {
      clearTimeout(citeTimer);
      citeTimer = null;
    }
  });
  const stick = () => {
    if (following()) scrollRef?.scrollToEnd({ animated: false });
  };
  const cite = (jobId: string) => {
    const y = offsets.get(jobId);
    if (typeof y === "number") {
      following.set(false);
      scrollRef?.scrollTo({ y: Math.max(0, y - space.xxl), animated: true });
    }
    citedJobId.set(jobId);
    if (citeTimer) clearTimeout(citeTimer);
    citeTimer = setTimeout(() => {
      if (citedJobId() === jobId) citedJobId.set(null);
    }, CITATION_HOLD_MS + CITATION_FADE_MS);
  };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ConversationHeader />
      <View style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Scroll
          ref={scrollRef}
          testID="sa-thread"
          style={{ flex: 1, minHeight: 0 }}
          contentStyle={{ alignItems: "center", paddingHorizontal: gutter(), paddingTop: space.xxl, paddingBottom: space.lg }}
          onLayout={() => stick()}
          onScroll={event => {
            const distance = Math.max(0, event.contentSize.height - event.size.height - event.offset.y);
            distanceFromEnd.set(distance);
            following.set(distance < space.xxl);
          }}
        >
          <View
            style={{ width: "100%", maxWidth: contentWidth() }}
            onLayout={() => stick()}
          >
            <If when={conversationLoading() && !conversationView()}>
              <ConversationSkeleton />
            </If>
            <Each of={settledThreadItems()} key={item => item.key}>
              {item => (
                <View
                  style={{ marginTop: item().gap }}
                  onLayout={event => {
                    const current = item();
                    if (current.kind === "jobs") for (const id of current.jobIds) offsets.set(id, event.bounds.origin.y);
                  }}
                >
                  <If when={item().kind === "user"}>
                    <UserBubble text={(item() as { text: string }).text} pending={(item() as { pending?: boolean }).pending} />
                  </If>
                  <If when={item().kind === "assistant"}>
                    <AssistantProse
                      text={(item() as { text: string }).text}
                      live={(item() as { live?: boolean }).live}
                      citations={(item() as { citations: Array<{ jobId: string; label?: string }> }).citations}
                      onCite={cite}
                    />
                  </If>
                  <If when={item().kind === "jobs"}>
                    <JobStack jobIds={(item() as { jobIds: string[] }).jobIds} citedJobId={citedJobId()} />
                  </If>
                  <If when={item().kind === "notice"}>
                    <Notice
                      text={(item() as { text: string }).text}
                      failed={(item() as { failed: boolean }).failed}
                      onRetry={(item() as { failed: boolean }).failed ? () => void retryLastTurn() : undefined}
                    />
                  </If>
                </View>
              )}
            </Each>
            <If when={hasLiveReply()}>
              <View style={{ marginTop: liveReplyGap() }}>
                <AssistantProse text={liveReply()} live={true} citations={[]} onCite={cite} />
              </View>
            </If>
            <If when={(turnStep() === "model_round" || turnStep() === "tools") && !hasLiveReply()}>
              <View style={{ marginTop: settledThreadItems().length > 0 ? space.lg : 0 }}>
                <ThinkingLine />
              </View>
            </If>
            <If when={conversationError()}>
              <View style={{ marginTop: space.lg, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Icon name="info" size={14} color={palette().textMuted} />
                <Text style={{ ...textStyle("label", { color: palette().textMuted }), fontWeight: "400", flex: 1 }}>
                  {tr("sa.loadFailed")}
                </Text>
                <Button
                  label={tr("common.tryAgain")}
                  variant="ghost"
                  size="sm"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => void refreshConversation()}
                />
              </View>
            </If>
          </View>
        </Scroll>
        <If when={distanceFromEnd() > JUMP_THRESHOLD}>
          <View
            style={{ position: "absolute", left: 0, right: 0, bottom: space.md, alignItems: "center", pointerEvents: "box-none" }}
          >
            <View
              role="button"
              accessibilityLabel={tr("session.jumpLatest")}
              onPress={() => {
                following.set(true);
                scrollRef?.scrollToEnd({ animated: true });
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                minHeight: compactLayout() ? layout.touchTarget : controlHeight.sm,
                paddingHorizontal: space.md,
                borderRadius: radii.pill,
                borderWidth: 1,
                borderColor: palette().border,
                backgroundColor: palette().surfaceElevated,
                boxShadow: palette().shadowTooltip,
                cursor: "pointer",
                userSelect: "none",
                ...pressTransition(MOTION_DURATION.fast),
              }}
              hoverStyle={{ backgroundColor: palette().panelHover }}
              activeStyle={tactileActiveStyle(0.97)}
              focusVisibleStyle={focusRingStyle()}
            >
              <Icon name="arrow-down" size={12} color={palette().textSecondary} />
              <Text style={textStyle("caption", { color: palette().textSecondary })}>{tr("session.jumpLatest")}</Text>
            </View>
          </View>
        </If>
      </View>
      <View
        style={{
          alignItems: "center",
          paddingHorizontal: gutter(),
          paddingTop: space.lg,
          paddingBottom: space.lg,
          backgroundColor: palette().canvas,
          flexShrink: 0,
        }}
      >
        <View style={{ width: "100%", maxWidth: contentWidth() }}>
          <Composer maxFieldHeight={maxComposerHeight(props.height)} />
        </View>
      </View>
    </View>
  );
}

/**
 * The OpenBitFun scene (route `openbitfun`, alias `home`). It fills the canvas
 * below the shell's top bar and draws its own conversation header.
 */
export function OpenBitFunScene() {
  startSuperagentStore();
  const height = signal(0);
  return (
    <View
      testID="openbitfun-scene"
      style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}
      onLayout={event => height.set(event.bounds.size.height)}
    >
      <If when={activeConversationId() ?? ""} else={<NewConversation height={height()} />}>
        <Thread height={height()} />
      </If>
      <ConversationDialogs />
    </View>
  );
}
