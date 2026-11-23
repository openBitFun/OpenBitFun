// Per-turn snapshot file changes card (collapsed by default) and turn snapshot
// diff review modal.

import { computed, effect, Scroll, signal, Text, View } from "nsh";
import { DiffView } from "nsh/base";
import {
  getOperationDiff,
  type OperationDiffResult,
  type TranscriptTurnFileChange,
} from "../api";
import { basename, formatCount } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  animateLayout,
  MOTION_DURATION,
  paintTransition,
  pressTransition,
  Spinner,
  tactileActiveStyle,
} from "./motion";
import {
  compactLayout,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  textStyle,
} from "../theme";
import { Icon } from "./icons";
import { createDiffViewStyles } from "./markdown";
import { ModalDialog } from "./overlays";
import { Button, InlineBanner, focusRingStyle } from "./primitives";

function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return { name: normalized, dir: "" };
  return {
    name: normalized.slice(slash + 1) || normalized,
    dir: normalized.slice(0, slash),
  };
}

function fileBadge(fileName: string): { label: string; color: () => string } {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  switch (ext) {
    case "ts":
      return { label: "TS", color: () => palette().gitLanes[0] };
    case "tsx":
      return { label: "TSX", color: () => palette().gitLanes[6] };
    case "js":
    case "mjs":
    case "cjs":
      return { label: "JS", color: () => palette().warning };
    case "jsx":
      return { label: "JSX", color: () => palette().warning };
    case "rs":
      return { label: "RS", color: () => palette().warning };
    case "py":
      return { label: "PY", color: () => palette().gitLanes[0] };
    case "go":
      return { label: "GO", color: () => palette().gitLanes[6] };
    case "json":
      return { label: "JSON", color: () => palette().warning };
    case "md":
    case "mdx":
      return { label: "MD", color: () => palette().textSecondary };
    case "css":
    case "scss":
      return { label: "CSS", color: () => palette().accent };
    case "html":
      return { label: "HTML", color: () => palette().accent };
    case "toml":
    case "yaml":
    case "yml":
      return { label: ext.toUpperCase(), color: () => palette().textSecondary };
    case "sh":
    case "zsh":
      return { label: "SH", color: () => palette().success };
    default:
      return {
        label: ext ? ext.slice(0, 4).toUpperCase() : "FILE",
        color: () => palette().textMuted,
      };
  }
}

export function TurnFileChangesCard(props: {
  turnId: string;
  changes: TranscriptTurnFileChange[];
  onReview: (initialFilePath?: string) => void;
}) {
  const expanded = signal(false);
  const totalAdded = computed(() => props.changes.reduce((sum, item) => sum + (item.linesAdded || 0), 0));
  const totalRemoved = computed(() => props.changes.reduce((sum, item) => sum + (item.linesRemoved || 0), 0));
  const summaryLabel = computed(() =>
    props.changes.length === 1
      ? tr("sessions.turnFilesChangedOne")
      : tr("sessions.turnFilesChangedMany", { count: formatCount(props.changes.length) }),
  );

  return (
    <View
      accessibilityLabel={`turn-changes-card-${props.turnId}`}
      style={{
        borderRadius: radii.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().surfaceSubtle,
        overflow: "hidden",
      }}
    >
      {/* Header row — default collapsed; click left region to expand/collapse */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.sm,
          paddingLeft: space.md,
          paddingRight: space.sm,
          paddingVertical: space.xs,
          minHeight: compactLayout() ? layout.touchTarget : 40,
        }}
      >
        <View
          role="button"
          accessibilityLabel={`turn-changes-toggle-${props.turnId}`}
          accessibilityState={{ expanded: expanded() }}
          onPress={() => {
            animateLayout();
            expanded.update(v => !v);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: compactLayout() ? layout.touchTarget : 30,
            borderRadius: radii.sm,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          activeStyle={tactileActiveStyle(0.99)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.35),
              fontWeight: "500",
              flexShrink: 1,
              minWidth: 0,
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {summaryLabel()}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <Text
              style={{
                color: palette().success,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
                fontFamily: fontMono,
                fontWeight: "500",
                fontVariant: ["tabular-nums"],
              }}
            >
              {`+${formatCount(totalAdded())}`}
            </Text>
            <Text
              style={{
                color: palette().danger,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.3),
                fontFamily: fontMono,
                fontWeight: "500",
                fontVariant: ["tabular-nums"],
              }}
            >
              {`-${formatCount(totalRemoved())}`}
            </Text>
          </View>
          <Icon
            name={expanded() ? "chevron-down" : "chevron-right"}
            size={13}
            color={palette().textMuted}
          />
        </View>

        <View
          role="button"
          accessibilityLabel={`turn-changes-review-${props.turnId}`}
          onPress={() => props.onReview(props.changes[0]?.filePath)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.sm,
            height: compactLayout() ? layout.touchTarget : 28,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().border,
            backgroundColor: palette().panelRaised,
            flexShrink: 0,
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{
            backgroundColor: palette().panelHover,
            borderColor: palette().borderStrong,
          }}
          activeStyle={tactileActiveStyle(0.97)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Icon name="file-code" size={13} color={palette().textSecondary} />
          <Text
            style={{
              color: palette().text,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
              fontWeight: "500",
            }}
          >
            {tr("sessions.turnFilesReview")}
          </Text>
        </View>
      </View>

      {/* Expanded changed-file list */}
      <If when={expanded()}>
        <View
          style={{
            borderTopWidth: 1,
            borderColor: palette().borderSubtle,
            paddingVertical: space.xs,
          }}
        >
          <Each of={props.changes} key={item => item.filePath}>
            {item => {
              const parts = computed(() => splitFilePath(item().filePath));
              const badge = computed(() => fileBadge(parts().name));
              return (
                <View
                  role="button"
                  accessibilityLabel={`turn-change-file-${props.turnId}-${parts().name}`}
                  onPress={() => props.onReview(item().filePath)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    minHeight: compactLayout() ? layout.touchTarget : 34,
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                    cursor: "pointer",
                    userSelect: "none",
                    ...paintTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  activeStyle={tactileActiveStyle(0.995)}
                  focusVisibleStyle={focusRingStyle()}
                >
                  <Text
                    style={{
                      width: 28,
                      flexShrink: 0,
                      color: badge().color(),
                      fontSize: textSize(10),
                      lineHeight: textLineHeight(10, 1.2),
                      fontFamily: fontMono,
                      fontWeight: "700",
                      textAlign: "left",
                    }}
                  >
                    {badge().label}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "baseline",
                      gap: space.sm,
                    }}
                  >
                    <Text
                      style={{
                        color: item().changeKind === "delete" ? palette().textMuted : palette().text,
                        fontSize: textSize(13),
                        lineHeight: textLineHeight(13, 1.35),
                        fontWeight: "500",
                        flexShrink: 0,
                        numberOfLines: 1,
                      }}
                    >
                      {parts().name}
                    </Text>
                    <If when={parts().dir.length > 0}>
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          color: palette().textMuted,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.35),
                          numberOfLines: 1,
                          textOverflow: "ellipsis-middle",
                        }}
                      >
                        {parts().dir}
                      </Text>
                    </If>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.xs,
                      flexShrink: 0,
                    }}
                  >
                    <Text
                      style={{
                        color: palette().success,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.3),
                        fontFamily: fontMono,
                        fontWeight: "500",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`+${formatCount(item().linesAdded)}`}
                    </Text>
                    <Text
                      style={{
                        color: palette().danger,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.3),
                        fontFamily: fontMono,
                        fontWeight: "500",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {`-${formatCount(item().linesRemoved)}`}
                    </Text>
                  </View>
                </View>
              );
            }}
          </Each>
        </View>
      </If>
    </View>
  );
}

export interface TurnChangesReviewState {
  sessionId: string;
  turnId: string;
  workspaceId?: string;
  workspacePath?: string;
  changes: TranscriptTurnFileChange[];
  selectedPath: string;
}

export function TurnChangesDiffModal(props: {
  review: () => TurnChangesReviewState | null;
  onSelectFile: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onClose: () => void;
}) {
  const loading = signal(false);
  const diffResult = signal<OperationDiffResult | null>(null);
  const diffError = signal("");
  let loadSeq = 0;

  effect(() => {
    const state = props.review();
    if (!state) {
      diffResult.set(null);
      diffError.set("");
      loading.set(false);
      return;
    }
    const target = state.changes.find(item => item.filePath === state.selectedPath) ?? state.changes[0];
    if (!target) return;
    const seq = ++loadSeq;
    loading.set(true);
    diffError.set("");
    diffResult.set(null);
    void getOperationDiff({
      sessionId: state.sessionId,
      filePath: target.filePath,
      operationId: target.operationId,
      workspaceId: state.workspaceId,
      workspacePath: state.workspacePath,
    })
      .then(result => {
        if (seq !== loadSeq) return;
        diffResult.set(result);
        loading.set(false);
      })
      .catch(error => {
        if (seq !== loadSeq) return;
        diffError.set(error instanceof Error ? error.message : String(error));
        loading.set(false);
      });
  });

  const selectedEntry = computed(() => {
    const state = props.review();
    if (!state) return null;
    return state.changes.find(item => item.filePath === state.selectedPath) ?? state.changes[0] ?? null;
  });

  return (
    <ModalDialog
      open={props.review() !== null}
      title={tr("sessions.turnFilesReviewTitle")}
      subtitle={selectedEntry()?.filePath}
      size="xl"
      accessibilityLabel="turn-changes-review-modal"
      onClose={props.onClose}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flex: 1, gap: space.sm }}>
          <If when={selectedEntry()}>
            {entry => (
              <Button
                label={tr("sessions.turnFilesOpenFile")}
                variant="secondary"
                size="sm"
                leadingIcon="external-link"
                onPress={() => {
                  const path = entry().filePath;
                  props.onClose();
                  props.onOpenFile(path);
                }}
              />
            )}
          </If>
          <Button label={tr("common.close")} variant="secondary" size="sm" onPress={props.onClose} />
        </View>
      }
    >
      <If when={props.review()}>
        {state => (
          <View style={{ gap: space.sm, height: 520, minHeight: 0 }}>
            <Scroll
              horizontal
              scrollbar={false}
              style={{ flexShrink: 0 }}
              contentStyle={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
            >
              <Each of={state().changes} key={item => item.filePath}>
                {item => {
                  const active = computed(() => item().filePath === selectedEntry()?.filePath);
                  return (
                    <View
                      role="button"
                      accessibilityLabel={`review-file-tab-${basename(item().filePath)}`}
                      onPress={() => props.onSelectFile(item().filePath)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.xs,
                        paddingHorizontal: space.sm,
                        height: 28,
                        borderRadius: radii.sm,
                        borderCurve: "continuous",
                        borderWidth: 1,
                        borderColor: active() ? palette().accentBorder : palette().borderSubtle,
                        backgroundColor: active() ? palette().accentSoft : palette().surfaceSubtle,
                        cursor: "pointer",
                        userSelect: "none",
                        ...pressTransition(MOTION_DURATION.fast),
                      }}
                      hoverStyle={{ backgroundColor: active() ? palette().accentSoft : palette().panelHover }}
                    >
                      <Text
                        style={{
                          color: active() ? palette().text : palette().textSecondary,
                          fontSize: textSize(12),
                          lineHeight: textLineHeight(12, 1.3),
                          fontWeight: active() ? "600" : "500",
                        }}
                      >
                        {basename(item().filePath)}
                      </Text>
                      <Text
                        style={{
                          color: palette().success,
                          fontSize: textSize(11),
                          fontFamily: fontMono,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {`+${formatCount(item().linesAdded)}`}
                      </Text>
                      <Text
                        style={{
                          color: palette().danger,
                          fontSize: textSize(11),
                          fontFamily: fontMono,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {`-${formatCount(item().linesRemoved)}`}
                      </Text>
                    </View>
                  );
                }}
              </Each>
            </Scroll>

            <View
              style={{
                flex: 1,
                minHeight: 0,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().panelRaised,
                overflow: "hidden",
              }}
            >
              <If when={loading()}>
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm }}>
                  <Spinner size={18} />
                  <Text style={textStyle("caption")}>{tr("common.loading")}</Text>
                </View>
              </If>
              <If when={!loading() && Boolean(diffError())}>
                <View style={{ padding: space.md }}>
                  <InlineBanner tone="warning" message={localizeHostError(diffError())} />
                </View>
              </If>
              <If when={!loading() && !diffError() ? diffResult() : null}>
                {diff => (
                  <DiffView
                    oldValue={diff().originalContent}
                    newValue={diff().modifiedContent}
                    language={selectedEntry()?.filePath ?? "text"}
                    layout="unified"
                    indicators="bars"
                    inline="wordAlt"
                    lineNumbers={true}
                    fontFamily={fontMono}
                    fontSize={textSize(12)}
                    lineHeight={textLineHeight(12, 1.55)}
                    styles={createDiffViewStyles()}
                    style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                  />
                )}
              </If>
              <If when={!loading() && !diffError() && !diffResult()}>
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg }}>
                  <Text style={textStyle("caption")}>{tr("sessions.turnFilesNoDiff")}</Text>
                </View>
              </If>
            </View>
          </View>
        )}
      </If>
    </ModalDialog>
  );
}
