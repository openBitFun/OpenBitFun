// Jobs sent from this device (the power-user entry of Detached Dispatch; ux-redesign
// §2 capability map, visual spec §4.7). The OpenBitFun conversation starts most
// jobs; this row keeps the direct path, which also reaches saved SSH servers the
// conversation cannot. It shows only on the device page of the computer this UI
// runs on: the dispatch commands are controller local, so a browser or a phone
// never draws it.
//
// Display only: targets, readiness, jobs and their events are the backend's
// (`dispatchStore`, `dispatchObserver`); this file draws them in one sheet that
// switches between the job list, the new-job form and one job's log.

import { cleanup, Scroll, signal, Text, View } from "nsh";
import { TextView } from "nsh/base";
import {
  answerObservedPermission,
  cancelObservedJob,
  closeObservedJob,
  observedBusy,
  observedDraft,
  observedJobFinished,
  observedJobId,
  observedJobTitle,
  observedNotice,
  observedPending,
  observedRows,
  observedState,
  observedTruncated,
  openObservedJob,
  pollObservedJob,
  sendToObservedJob,
  syncObservedResult,
  type DispatchRow,
} from "../dispatchObserver";
import {
  DISPATCH_APPROVAL_POLICIES,
  cancelDispatch,
  chooseDispatchTarget,
  dispatchApprovalPolicy,
  dispatchBaseRef,
  dispatchFormOpen,
  dispatchIncludeUncommitted,
  dispatchJobs,
  dispatchModel,
  dispatchNotice,
  dispatchProbe,
  dispatchPrompt,
  dispatchSupported,
  dispatchTargetKey,
  dispatchTargetReady,
  dispatchTargets,
  dispatchTitle,
  dispatchWorkspacePath,
  ensureDispatch,
  openDispatchForm,
  probeDispatchTarget,
  refreshDispatchJobs,
  selectedTarget,
  submitDispatch,
  targetKey,
  type DispatchJob,
} from "../dispatchStore";
import { localizeHostError, tr, type MessageKey } from "../i18n";
import { compactLayout, layout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { StateMark, stateColor, stateWord, type MarkState } from "../ui/fleet";
import { Icon } from "../ui/icons";
import { createMarkdownCodeActions, createMarkdownStyles } from "../ui/markdown";
import { MOTION_DURATION, pressTransition, tactileActiveStyle } from "../ui/motion";
import { ModalDialog, SelectDropdown, type DropdownMenuItem } from "../ui/overlays";
import { Button, ConfigRow, InlineBanner, InputBox, SegmentedTabs, ToggleSwitch, focusRingStyle } from "../ui/primitives";
import { InsetGroup, InsetRow, MoreMenu, StudioEmpty } from "../ui/studio";

/** The jobs sheet. */
const sheetOpen = signal(false);

const APPROVAL_POLICY_LABELS: Record<string, { labelKey: MessageKey; hintKey: MessageKey }> = {
  auto: { labelKey: "devices.approvalAuto", hintKey: "devices.approvalAutoHint" },
  "reject-and-report": { labelKey: "devices.approvalReject", hintKey: "devices.approvalRejectHint" },
  remote: { labelKey: "devices.approvalRemote", hintKey: "devices.approvalRemoteHint" },
};

function approvalPolicyLabel(value: string, fallback: string): string {
  const entry = APPROVAL_POLICY_LABELS[value];
  return entry ? tr(entry.labelKey) : fallback;
}

function approvalPolicyHint(value: string): string {
  const entry = APPROVAL_POLICY_LABELS[value];
  return entry ? tr(entry.hintKey) : "";
}

/** A job's state as one of the shared marks (the only state → color map). */
function jobMark(state: string): MarkState {
  switch (state) {
    case "queued":
    case "pending":
    case "submitted":
      return "queued";
    case "running":
    case "starting":
      return "working";
    case "waiting":
    case "waiting_permission":
    case "awaiting_approval":
      return "needs_you";
    case "succeeded":
    case "completed":
      return "done";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "stopped";
    default:
      return "idle";
  }
}

/** A log line's mark: the target reports its state transitions as text. */
function stateLineMark(text: string): MarkState {
  const lower = text.toLowerCase();
  if (lower.includes("succeed")) return "done";
  if (lower.includes("fail") || lower.includes("error")) return "failed";
  if (lower.includes("cancel")) return "stopped";
  return "working";
}

function targetLabel(job: DispatchJob): string {
  return job.target?.displayName ?? job.target?.kind ?? "";
}

function openSheet(): void {
  void refreshDispatchJobs();
  sheetOpen.set(true);
}

function closeSheet(): void {
  dispatchFormOpen.set(false);
  closeObservedJob();
  sheetOpen.set(false);
}

// ── Job list ────────────────────────────────────────────────────────────────

function JobRow(props: { job: DispatchJob; first: boolean }) {
  const mark = () => jobMark(props.job.state);
  const phone = () => compactLayout();
  return (
    <InsetRow
      first={props.first}
      leading={<StateMark state={mark()} size={12} />}
      label={props.job.title || props.job.promptPreview || tr("deviceJobs.title")}
      detail={[targetLabel(props.job), stateWord(mark())].filter(Boolean).join(" · ")}
      trailing={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Button
            label={tr("deviceJobs.view")}
            variant="ghost"
            size={phone() ? "md" : "sm"}
            style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
            accessibilityLabel={`dispatch-observe-${props.job.jobId}`}
            onPress={() => void openObservedJob(props.job)}
          />
          <If when={mark() === "queued" || mark() === "working" || mark() === "needs_you"}>
            <Button
              label={tr("deviceJobs.stop")}
              variant="ghost"
              size={phone() ? "md" : "sm"}
              style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
              accessibilityLabel={`dispatch-cancel-${props.job.jobId}`}
              onPress={() => void cancelDispatch(props.job.jobId)}
            />
          </If>
        </View>
      }
    />
  );
}

function JobList() {
  return (
    <View style={{ gap: space.md, minWidth: 0 }}>
      <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("deviceJobs.subtitle")}</Text>
      <If when={dispatchNotice()}>
        {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
      </If>
      <If
        when={dispatchJobs().length > 0}
        else={<StudioEmpty icon="layers" message={tr("deviceJobs.empty")} />}
      >
        <InsetGroup accessibilityLabel="dispatch-jobs">
          <Each of={dispatchJobs()} key={job => job.jobId}>
            {(job, index) => <JobRow job={job()} first={index() === 0} />}
          </Each>
        </InsetGroup>
      </If>
    </View>
  );
}

// ── New job form ────────────────────────────────────────────────────────────

function ProbeLine() {
  return (
    <If when={dispatchProbe()}>
      {probe => (
        <View
          accessibilityLabel="dispatch-probe-status"
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 24 }}
        >
          <StateMark
            state={probe().status === "ready" ? "done" : probe().status === "checking" ? "working" : "failed"}
            size={12}
          />
          <Text
            style={{
              ...textStyle("caption", {
                color:
                  probe().status === "ready" || probe().status === "checking"
                    ? palette().textMuted
                    : stateColor("failed"),
              }),
              flex: 1,
              minWidth: 0,
            }}
          >
            {probe().status === "checking"
              ? tr("deviceJobs.checking")
              : probe().status === "ready"
                ? tr("deviceJobs.ready")
                : probe().status === "failed"
                  ? tr("deviceJobs.probeFailed", { error: probe().message })
                  : probe().message}
          </Text>
          <If when={probe().status === "failed" || probe().status === "not-ready"}>
            <Button
              label={tr("common.retry")}
              variant="ghost"
              size="sm"
              accessibilityLabel="dispatch-probe-retry"
              onPress={() => void probeDispatchTarget()}
            />
          </If>
        </View>
      )}
    </If>
  );
}

function FieldLabel(props: { text: string }) {
  return <Text style={textStyle("label", { color: palette().textSecondary })}>{props.text}</Text>;
}

function JobForm() {
  const needsPath = () => {
    const target = selectedTarget();
    return target !== null && target.kind !== "local";
  };
  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      <If when={dispatchNotice()}>
        {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
      </If>
      <View style={{ gap: space.chip }}>
        <FieldLabel text={tr("deviceJobs.target")} />
        <SelectDropdown
          options={dispatchTargets().map(target => ({
            value: targetKey(target),
            label: [
              target.displayName,
              target.kind === "ssh" ? "SSH" : "",
              target.online === false ? tr("state.offline") : "",
            ]
              .filter(Boolean)
              .join(" · "),
            icon: target.kind === "ssh" ? ("server" as const) : ("laptop" as const),
            accessibilityLabel: `dispatch-target-${targetKey(target)}`,
          }))}
          value={dispatchTargetKey()}
          placeholder={tr("deviceJobs.chooseTarget")}
          fullWidth={true}
          accessibilityLabel="dispatch-target-select"
          onChange={value => chooseDispatchTarget(value)}
        />
        <ProbeLine />
      </View>
      <If when={needsPath()}>
        <InputBox
          label={tr("deviceJobs.folder")}
          leadingIcon="folder"
          monospace
          value={dispatchWorkspacePath()}
          placeholder={tr("ssh.pathPlaceholder")}
          accessibilityLabel="dispatch-workspace"
          onChange={value => dispatchWorkspacePath.set(value)}
        />
      </If>
      <InputBox
        label={tr("devices.prompt")}
        multiline
        minHeight={88}
        value={dispatchPrompt()}
        placeholder={tr("deviceJobs.promptPlaceholder")}
        accessibilityLabel="dispatch-prompt"
        onChange={value => dispatchPrompt.set(value)}
        onSubmit={() => void submitDispatch()}
      />
      <InputBox
        label={tr("devices.dispatchTitleLabel")}
        value={dispatchTitle()}
        placeholder={tr("devices.dispatchTitlePlaceholder")}
        accessibilityLabel="dispatch-title"
        onChange={value => dispatchTitle.set(value)}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <InputBox
            label={tr("devices.dispatchBaseRef")}
            hint={tr("devices.dispatchBaseRefHint")}
            monospace
            value={dispatchBaseRef()}
            placeholder="HEAD"
            accessibilityLabel="dispatch-base-ref"
            onChange={value => dispatchBaseRef.set(value)}
          />
        </View>
        <View style={{ flex: 1, minWidth: 180, gap: space.chip }}>
          <FieldLabel text={tr("devices.dispatchModel")} />
          <SelectDropdown
            options={[
              { value: "", label: tr("devices.dispatchModelDefault"), accessibilityLabel: "dispatch-model-default" },
              ...(dispatchProbe()?.availableModels ?? []).map(model => ({
                value: model,
                label:
                  model === dispatchProbe()?.defaultModel
                    ? tr("devices.dispatchModelTargetDefault", { model })
                    : model,
                accessibilityLabel: `dispatch-model-${model}`,
              })),
            ]}
            value={dispatchModel()}
            fullWidth={true}
            accessibilityLabel="dispatch-model-select"
            onChange={value => dispatchModel.set(value)}
          />
        </View>
      </View>
      <ConfigRow
        label={tr("devices.dispatchIncludeUncommitted")}
        description={tr("devices.dispatchIncludeUncommittedHint")}
        divider={false}
      >
        <ToggleSwitch
          value={dispatchIncludeUncommitted()}
          accessibilityLabel="dispatch-include-uncommitted"
          onChange={next => dispatchIncludeUncommitted.set(next)}
        />
      </ConfigRow>
      <View style={{ gap: space.chip }}>
        <FieldLabel text={tr("devices.approvalPolicy")} />
        <Scroll horizontal scrollbar={false} style={{ width: "100%", minWidth: 0 }}>
          <SegmentedTabs
            size="sm"
            value={dispatchApprovalPolicy()}
            options={DISPATCH_APPROVAL_POLICIES.map(policy => ({
              value: policy.value,
              label: approvalPolicyLabel(policy.value, policy.label),
              accessibilityLabel: `dispatch-approval-${policy.value}`,
            }))}
            onChange={value => dispatchApprovalPolicy.set(value)}
          />
        </Scroll>
        <If when={approvalPolicyHint(dispatchApprovalPolicy())}>
          {hint => <Text style={textStyle("caption")}>{hint()}</Text>}
        </If>
      </View>
    </View>
  );
}

// ── One job's log ───────────────────────────────────────────────────────────

function ObservedEventRow(props: { row: DispatchRow }) {
  return (
    <View>
      <If when={props.row.kind === "state"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
          <StateMark state={stateLineMark(props.row.text)} size={12} />
          <Text style={{ ...textStyle("mono", { color: palette().textSecondary }), flexShrink: 1, minWidth: 0, numberOfLines: 2, textOverflow: "ellipsis" }}>
            {props.row.text}
          </Text>
        </View>
      </If>
      <If when={props.row.kind === "thinking"}>
        <View style={{ borderLeftWidth: 2, borderColor: palette().borderSubtle, paddingLeft: space.md, gap: space.hair }}>
          <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("devices.polish.thinking")}</Text>
          <Text style={textStyle("label", { color: palette().textMuted })}>{props.row.text}</Text>
        </View>
      </If>
      <If when={props.row.kind === "tool"}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, minWidth: 0 }}>
          <Icon name="wrench" size={12} color={palette().textMuted} />
          <Text style={{ ...textStyle("mono", { color: palette().textSecondary }), flex: 1, minWidth: 0 }}>{props.row.text}</Text>
        </View>
      </If>
      <If when={props.row.kind === "error"}>
        <View style={{ borderLeftWidth: 2, borderColor: stateColor("failed"), paddingLeft: space.md }}>
          <Text style={textStyle("label", { color: palette().text })}>{localizeHostError(props.row.text)}</Text>
        </View>
      </If>
      <If when={props.row.kind === "user"}>
        <View
          style={{
            alignSelf: "flex-end",
            maxWidth: "82%",
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette().userBubble,
          }}
        >
          <Text style={textStyle("label", { color: palette().userBubbleText })}>{props.row.text}</Text>
        </View>
      </If>
      <If when={props.row.kind === "assistant"}>
        <TextView
          markdown={props.row.text}
          selectable={true}
          links="open"
          codeBlockActions={createMarkdownCodeActions()}
          styles={createMarkdownStyles({ compact: true, baseFontSize: 13 })}
        />
      </If>
    </View>
  );
}

function observerMenuItems(): DropdownMenuItem[] {
  const items: DropdownMenuItem[] = [
    {
      id: "poll",
      label: tr("deviceJobs.refresh"),
      icon: "refresh",
      accessibilityLabel: "dispatch-observe-poll",
      onSelect: () => void pollObservedJob(),
    },
  ];
  if (!observedJobFinished()) {
    items.push({
      id: "cancel",
      label: tr("deviceJobs.stop"),
      icon: "stop",
      danger: true,
      separator: true,
      accessibilityLabel: "dispatch-observe-cancel",
      onSelect: () => void cancelObservedJob(),
    });
  }
  return items;
}

function JobLog() {
  const phone = () => compactLayout();
  return (
    <View accessibilityLabel="dispatch-observer" style={{ gap: space.md, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: phone() ? layout.touchTarget : 28 }}>
        <View
          role="button"
          accessibilityLabel="dispatch-observe-close"
          hitSlop={touchSlop(phone() ? layout.touchTarget : 28)}
          onPress={() => closeObservedJob()}
          hoverStyle={phone() ? undefined : { backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.97)}
          focusVisibleStyle={focusRingStyle()}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            minHeight: phone() ? layout.touchTarget : 28,
            paddingHorizontal: space.xs,
            marginLeft: -space.xs,
            borderRadius: radii.sm,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
        >
          <Icon name="chevron-left" size={12} color={palette().textSecondary} />
          <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("deviceJobs.allJobs")}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <If when={observedState()}>
          {state => <StateMark state={jobMark(state())} withWord={true} size={12} />}
        </If>
        <If when={observedJobFinished()}>
          <Button
            label={tr("deviceJobs.syncResult")}
            variant="secondary"
            size={phone() ? "md" : "sm"}
            style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
            accessibilityLabel="dispatch-observe-sync"
            onPress={() => void syncObservedResult()}
          />
        </If>
        <MoreMenu accessibilityLabel="dispatch-observe-menu" tooltip={tr("common.actions")} items={observerMenuItems()} />
      </View>
      <If when={observedJobTitle()}>
        {title => <Text style={textStyle("sectionTitle")}>{title()}</Text>}
      </If>
      <If when={observedNotice()}>
        {notice => <InlineBanner tone="neutral" message={localizeHostError(notice())} />}
      </If>
      <If when={observedTruncated()}>
        <InlineBanner tone="warning" message={tr("deviceJobs.truncated")} />
      </If>
      <Each of={observedPending()} key={request => request.requestId}>
        {request => (
          <View
            style={{
              gap: space.md,
              padding: space.lg,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
            }}
          >
            <View style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <StateMark state="needs_you" size={16} />
                <Text style={{ ...textStyle("body", { color: palette().text }), flex: 1, minWidth: 0 }}>{request().title}</Text>
              </View>
              <Text style={textStyle("mono", { color: palette().textSecondary })}>{request().detail}</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }}>
              <Button
                label={tr("prompt.allowOnce")}
                variant="primary"
                size={phone() ? "md" : "sm"}
                style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                accessibilityLabel={`dispatch-permission-once-${request().requestId}`}
                onPress={() => void answerObservedPermission(request().requestId, "once")}
              />
              <Button
                label={tr("prompt.always")}
                variant="secondary"
                size={phone() ? "md" : "sm"}
                style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                accessibilityLabel={`dispatch-permission-always-${request().requestId}`}
                onPress={() => void answerObservedPermission(request().requestId, "always")}
              />
              <Button
                label={tr("prompt.deny")}
                variant="ghost"
                size={phone() ? "md" : "sm"}
                style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                accessibilityLabel={`dispatch-permission-reject-${request().requestId}`}
                onPress={() => void answerObservedPermission(request().requestId, "reject")}
              />
            </View>
          </View>
        )}
      </Each>
      <View
        style={{
          borderRadius: radii.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().borderSubtle,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
        }}
      >
        <If
          when={phone()}
          else={
            <Scroll style={{ maxHeight: 320, minHeight: 0 }}>
              <View style={{ gap: space.md }}>
                <If when={observedRows().length === 0}>
                  <Text style={textStyle("caption")}>{tr("deviceJobs.noEvents")}</Text>
                </If>
                <Each of={observedRows()} key={row => row.id}>
                  {row => <ObservedEventRow row={row()} />}
                </Each>
              </View>
            </Scroll>
          }
        >
          <View style={{ gap: space.md }}>
            <If when={observedRows().length === 0}>
              <Text style={textStyle("caption")}>{tr("deviceJobs.noEvents")}</Text>
            </If>
            <Each of={observedRows()} key={row => row.id}>
              {row => <ObservedEventRow row={row()} />}
            </Each>
          </View>
        </If>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <InputBox
          size="md"
          value={observedDraft()}
          placeholder={observedJobFinished() ? tr("deviceJobs.followUp") : tr("deviceJobs.steer")}
          accessibilityLabel="dispatch-observe-message"
          style={{ flex: 1, minWidth: 0 }}
          onChange={value => observedDraft.set(value)}
          onSubmit={() => {
            if (!observedBusy() && observedDraft().trim()) void sendToObservedJob();
          }}
        />
        <Button
          label={tr("common.send")}
          variant="primary"
          size="md"
          disabled={observedBusy() || !observedDraft().trim()}
          style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
          accessibilityLabel="dispatch-observe-send"
          onPress={() => void sendToObservedJob()}
        />
      </View>
    </View>
  );
}

// ── The sheet and its row ───────────────────────────────────────────────────

function SheetFooter() {
  return (
    <If
      when={dispatchFormOpen()}
      else={
        <>
          <Button
            label={tr("deviceJobs.refresh")}
            variant="ghost"
            size="md"
            accessibilityLabel="dispatch-refresh"
            onPress={() => void refreshDispatchJobs()}
          />
          <Button
            label={tr("deviceJobs.newJob")}
            variant="secondary"
            size="md"
            accessibilityLabel="dispatch-form-toggle"
            onPress={() => {
              // This computer's folder means nothing on a server: a remote target starts empty.
              const hadPath = Boolean(dispatchWorkspacePath().trim());
              openDispatchForm();
              const target = selectedTarget();
              if (!hadPath && target !== null && target.kind !== "local") dispatchWorkspacePath.set("");
            }}
          />
          <Button label={tr("common.close")} variant="primary" size="md" onPress={closeSheet} />
        </>
      }
    >
      <Button label={tr("common.cancel")} variant="secondary" size="md" onPress={() => dispatchFormOpen.set(false)} />
      <Button
        label={tr("deviceJobs.submit")}
        variant="primary"
        size="md"
        accessibilityLabel="dispatch-submit"
        disabled={!dispatchTargetReady()}
        tooltip={dispatchTargetReady() ? undefined : dispatchProbe()?.message || tr("deviceJobs.notReady")}
        onPress={() => void submitDispatch()}
      />
    </If>
  );
}

/**
 * The device page's "Jobs sent from this device" row and its sheet. The caller
 * mounts it only for the device this UI runs on, on a desktop.
 */
export function DeviceJobsEntry(props: { first?: boolean }) {
  ensureDispatch();
  cleanup(() => closeSheet());
  return (
    <If when={dispatchSupported() !== false}>
      <InsetGroup accessibilityLabel="dispatch-section">
        <InsetRow
          first={props.first ?? true}
          label={tr("deviceJobs.title")}
          value={dispatchJobs().length > 0 ? String(dispatchJobs().length) : undefined}
          chevron
          accessibilityLabel="device-jobs"
          onPress={openSheet}
        />
      </InsetGroup>
      <ModalDialog
        open={sheetOpen()}
        size="lg"
        title={dispatchFormOpen() ? tr("deviceJobs.sendTitle") : tr("deviceJobs.title")}
        accessibilityLabel="device-jobs-sheet"
        onClose={closeSheet}
        footer={observedJobId() ? undefined : <SheetFooter />}
      >
        <View style={{ minWidth: 0, maxWidth: layout.pageWidth }}>
          <If when={dispatchFormOpen()} else={<If when={observedJobId()} else={<JobList />}><JobLog /></If>}>
            <JobForm />
          </If>
        </View>
      </ModalDialog>
    </If>
  );
}
