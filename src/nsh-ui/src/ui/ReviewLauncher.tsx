// Review launcher sheet (wave 5). Display only: what is listed, refused or
// launched is the host's answer to `launch_review` (see `src/reviewStore.ts`).

import { Scroll, Text, View, signal, type JSX } from "nsh";
import { Input } from "nsh/base";
import { formatCount } from "../format";
import { tr } from "../i18n";
import {
  chooseReviewIntent,
  closeReviewLauncher,
  includeAllReviewFiles,
  launchReviewFromSheet,
  reviewAllFiles,
  reviewExcluded,
  reviewFocus,
  reviewIntent,
  reviewLauncherOpen,
  reviewLaunching,
  reviewNotice,
  reviewPreview,
  reviewPreviewLoading,
  reviewSelectedCount,
  reviewUnsupported,
  toggleReviewFile,
  type ReviewIntent,
  type ReviewLaunchFile,
} from "../reviewStore";
import { activeWorkspace } from "../state";
import { compactLayout, fontMono, layout, palette, radii, space, textLineHeight, textSize } from "../theme";
import { Icon } from "./icons";
import { MOTION_DURATION, Spinner, paintTransition, pressTransition, tactileActiveStyle } from "./motion";
import { ModalDialog } from "./overlays";
import { Button, SegmentedTabs, focusRingStyle } from "./primitives";

const STATUS_MARK: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
};

function SectionHeader(props: { text: string; trailing?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm, gap: space.sm }}>
      <Text
        style={{
          flex: 1,
          color: palette().textSecondary,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.3),
          fontWeight: "600",
        }}
      >
        {props.text}
      </Text>
      {props.trailing}
    </View>
  );
}

function FileRow(props: { file: () => ReviewLaunchFile; first: () => boolean }) {
  const included = () => !reviewExcluded().includes(props.file().path);
  return (
    <View
      role="checkbox"
      accessibilityLabel={`review-file-${props.file().path}`}
      accessibilityState={{ checked: included() }}
      onPress={() => toggleReviewFile(props.file().path)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        minHeight: compactLayout() ? layout.touchTarget : space.x3l + space.xs,
        paddingHorizontal: space.lg,
        borderTopWidth: props.first() ? 0 : 1,
        borderColor: palette().borderSubtle,
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={focusRingStyle()}
    >
      <Icon
        name={included() ? "check-circle" : "circle-dot"}
        size={14}
        color={included() ? palette().text : palette().textMuted}
      />
      <Text
        style={{
          width: space.lg,
          color: palette().textMuted,
          fontFamily: fontMono,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
        }}
      >
        {STATUS_MARK[props.file().status] ?? "?"}
      </Text>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: included() ? palette().text : palette().textMuted,
          fontFamily: fontMono,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.35),
          numberOfLines: 1,
          textOverflow: "ellipsis-middle",
        }}
      >
        {props.file().previousPath ? `${props.file().previousPath} → ${props.file().path}` : props.file().path}
      </Text>
    </View>
  );
}

function scopeSummary(): string {
  const preview = reviewPreview();
  const selected = reviewSelectedCount();
  const files = tr(selected === 1 ? "review.fileOne" : "review.fileOther", { count: formatCount(selected) });
  if (!preview || preview.status === "refused" || typeof preview.changedLineCount !== "number") return files;
  return tr("review.scopeWithLines", { files, lines: formatCount(preview.changedLineCount) });
}

export function ReviewLauncherDialog() {
  const focusFocused = signal(false);
  const intentOptions = () => [
    { value: "review" as ReviewIntent, label: tr("review.intentStandard"), accessibilityLabel: "review-intent-review" },
    { value: "strict" as ReviewIntent, label: tr("review.intentStrict"), accessibilityLabel: "review-intent-strict" },
  ];
  return (
    <ModalDialog
      open={reviewLauncherOpen()}
      title={tr("review.title")}
      subtitle={activeWorkspace()?.name ?? ""}
      size="md"
      accessibilityLabel="review-launcher"
      onClose={closeReviewLauncher}
      footer={
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label={tr("common.cancel")} variant="ghost" size="md" onPress={closeReviewLauncher} />
          <Button
            label={tr("review.start")}
            variant="primary"
            size="md"
            accessibilityLabel="review-start"
            loading={reviewLaunching()}
            disabled={
              reviewUnsupported() ||
              reviewPreviewLoading() ||
              reviewSelectedCount() === 0 ||
              reviewPreview()?.status === "refused"
            }
            onPress={() => void launchReviewFromSheet()}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <SegmentedTabs options={intentOptions()} value={reviewIntent()} onChange={chooseReviewIntent} />
        <Text
          style={{
            color: palette().textSecondary,
            fontSize: textSize(13),
            lineHeight: textLineHeight(13, 1.5),
          }}
        >
          {reviewIntent() === "strict" ? tr("review.intentStrictHint") : tr("review.intentStandardHint")}
        </Text>
      </View>

      <View>
        <SectionHeader
          text={tr("review.scope")}
          trailing={
            <If
              when={reviewExcluded().length > 0}
              else={
                <Text style={{ color: palette().textMuted, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3) }}>
                  {scopeSummary()}
                </Text>
              }
            >
              <View
                role="button"
                accessibilityLabel="review-include-all"
                onPress={includeAllReviewFiles}
                style={{
                  minHeight: compactLayout() ? layout.touchTarget : undefined,
                  justifyContent: "center",
                  paddingHorizontal: space.xs,
                  borderRadius: radii.sm,
                  cursor: "pointer",
                  userSelect: "none",
                  ...pressTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ backgroundColor: palette().panelHover }}
                activeStyle={tactileActiveStyle(0.97)}
                focusVisibleStyle={focusRingStyle()}
              >
                <Text style={{ color: palette().textSecondary, fontSize: textSize(12), lineHeight: textLineHeight(12, 1.3), fontWeight: "500" }}>
                  {tr("review.includeAll", { summary: scopeSummary() })}
                </Text>
              </View>
            </If>
          }
        />
        <If
          when={reviewAllFiles().length > 0}
          else={
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: space.x3l + space.xs }}>
              <If when={reviewPreviewLoading()}>
                <Spinner size={14} />
              </If>
              <Text style={{ color: palette().textMuted, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>
                {reviewPreviewLoading() ? tr("review.reading") : tr("review.noFiles")}
              </Text>
            </View>
          }
        >
          <View
            style={{
              borderRadius: radii.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().panelRaised,
              overflow: "hidden",
            }}
          >
            <Scroll style={{ maxHeight: 216, minHeight: 0 }} scrollbar={true}>
              <Each of={reviewAllFiles()} key={file => file.path}>
                {(file, index) => <FileRow file={file} first={() => index() === 0} />}
              </Each>
            </Scroll>
          </View>
        </If>
        <If when={reviewPreview()?.completeness === "partial" && reviewPreview()?.status !== "refused"}>
          <Text
            style={{
              marginTop: space.sm,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.45),
            }}
          >
            {tr("review.partialEvidence")}
          </Text>
        </If>
      </View>

      <View>
        <SectionHeader text={tr("review.focus")} />
        <Input
          value={reviewFocus()}
          placeholder={tr("review.focusPlaceholder")}
          accessibilityLabel="review-focus"
          multiline={true}
          submitBehavior="newline"
          onFocus={() => focusFocused.set(true)}
          onBlur={() => focusFocused.set(false)}
          style={{
            minHeight: 64,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: focusFocused() ? palette().fieldFocusBorder : palette().borderSubtle,
            backgroundColor: palette().inputBg,
            color: palette().text,
            placeholderColor: palette().textMuted,
            caretColor: palette().accent,
            fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(13),
            lineHeight: compactLayout() ? textLineHeight(16, 1.45) : textLineHeight(13, 1.5),
            ...paintTransition(MOTION_DURATION.fast),
          }}
          onChange={event => reviewFocus.set(event.value)}
        />
      </View>

      <If when={reviewNotice()}>
        <View accessibilityLabel="review-notice" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
          <Icon name="info" size={14} color={palette().textSecondary} />
          <Text
            style={{
              flex: 1,
              color: palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.5),
            }}
          >
            {reviewNotice()}
          </Text>
        </View>
      </If>
    </ModalDialog>
  );
}
