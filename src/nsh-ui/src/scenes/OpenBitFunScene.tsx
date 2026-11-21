// OpenBitFun: the conversation (visual spec §4.2 and §4.3, ux-redesign §3.1
// and §3.2). With no conversation open it is the new-conversation screen (the
// question, the composer, the backend's suggestions and "Needs you" / "Working
// now"); with one open it is the thread: the user's bubbles, OpenBitFun's
// answers, the live job cards where the model dispatched them, and the
// composer pinned to the bottom.
//
// Display only: what is drawn, in which order, with which state and which
// actions is the cloud node's (`superagentStore.ts`). There is no device
// picker, mode or model chip anywhere on this screen: the model decides where
// work runs.

import { Scroll, Text, View, openUrl, signal, type ScrollRef, type ViewRef } from "nsh";
import { TextView } from "nsh/base";
import { contentWidth } from "../contentWidthStore";
import { tr } from "../i18n";
import {
  activeConversationId,
  cancelTurn,
  citedJobId,
  composerDraft,
  conversationError,
  conversationLoading,
  conversationView,
  conversationsLoaded,
  conversationGroups,
  enableSuperagent,
  jobCards,
  liveReply,
  pendingSend,
  refreshConversation,
  refreshSuperagentStatus,
  sendError,
  sendToSuperagent,
  startSuperagentStore,
  superagentPhase,
  superagentStatus,
  superagentUnavailable,
  turnRunning,
  turnStep,
  type ConversationMessage,
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
import { BrandSpinner, paintTransition } from "../ui/motion";
import { DropdownMenu } from "../ui/overlays";
import { Button, EmptyStateCard, IconButton } from "../ui/primitives";

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

function Composer(props: { maxFieldHeight: number }) {
  return (
    <View style={{ gap: space.sm }}>
      <SuperComposer
        value={composerDraft()}
        onChange={value => composerDraft.set(value)}
        onSubmit={() => void sendToSuperagent()}
        placeholder={placeholder()}
        running={Boolean(activeConversationId()) && turnRunning()}
        onStop={() => void cancelTurn()}
        blocked={composerBlocked()}
        maxFieldHeight={props.maxFieldHeight}
      />
      <If when={sendError()}>
        <Text testID="sa-send-error" style={{ ...textStyle("caption", { color: palette().danger }), paddingHorizontal: space.lg }}>
          {tr("job.unconfirmed")}
        </Text>
      </If>
    </View>
  );
}

// ── New conversation ─────────────────────────────────────────────────────────

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
        alignItems: "center",
        paddingHorizontal: gutter(),
        paddingTop: compactLayout() ? space.xxl : Math.round(props.height * 0.22),
        paddingBottom: space.x3l,
      }}
    >
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
          <Composer maxFieldHeight={Math.max(controlHeight.lg * 3, Math.round(props.height * 0.4))} />
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
        <If when={showEmpty()}>
          <EmptyStateCard title={tr("sa.emptyTitle")} subtitle={tr("sa.emptyBody")} />
        </If>
      </View>
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

/** The thread in the cloud node's order: an assistant item that also carries cards draws its text, then its stack. */
function threadItems(): ThreadItem[] {
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
  if (liveReply()) items.push({ kind: "assistant", key: "live", text: liveReply(), citations: [], live: true });
  return items;
}

function gapBefore(items: ThreadItem[], index: number): number {
  if (index === 0) return 0;
  const previous = items[index - 1];
  const current = items[index];
  if (current?.kind === "jobs" && previous?.kind === "assistant") return space.md;
  if (current?.kind === "assistant" && previous?.kind === "assistant") return space.md;
  return space.xxl;
}

function handleLink(event: { url: string }): void {
  const url = event.url.trim();
  if (/^(https?:|mailto:)/i.test(url)) void openUrl(url).catch(() => undefined);
}

function UserBubble(props: { text: string; pending?: boolean }) {
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "72%" }}>
      <View
        style={{
          maxWidth: USER_BUBBLE_MAX,
          paddingVertical: space.sm + space.hair,
          paddingHorizontal: space.md + space.hair,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          backgroundColor: palette().userBubble,
          opacity: props.pending ? 0.72 : 1,
          ...paintTransition(160),
        }}
      >
        <Text style={{ ...textStyle("prose", { color: palette().userBubbleText }) }}>
          {props.text}
        </Text>
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

function Notice(props: { text: string; failed: boolean }) {
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
      </View>
    </If>
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
        height: layout.topBarHeight,
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
              <ThinkingLine />
            </If>
            <Each of={threadItems()} key={item => item.key}>
              {(item, index) => (
                <View
                  style={{ marginTop: gapBefore(threadItems(), index()) }}
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
                    <Notice text={(item() as { text: string }).text} failed={(item() as { failed: boolean }).failed} />
                  </If>
                </View>
              )}
            </Each>
            <If when={(turnStep() === "model_round" || turnStep() === "tools") && !liveReply()}>
              <View style={{ marginTop: threadItems().length > 0 ? space.lg : 0 }}>
                <ThinkingLine />
              </View>
            </If>
            <If when={conversationError()}>
              <View style={{ marginTop: space.lg, flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Icon name="info" size={14} color={palette().textMuted} />
                <Text style={{ ...textStyle("label", { color: palette().textMuted }), fontWeight: "400", flex: 1 }}>
                  {tr("sa.loadFailed")}
                </Text>
                <Button label={tr("common.tryAgain")} variant="ghost" size="sm" onPress={() => void refreshConversation()} />
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
                height: controlHeight.sm,
                paddingHorizontal: space.md,
                borderRadius: radii.pill,
                backgroundColor: palette().surfaceElevated,
                boxShadow: palette().shadowTooltip,
                cursor: "pointer",
              }}
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
          <Composer maxFieldHeight={Math.max(controlHeight.lg * 3, Math.round(props.height * 0.4))} />
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
