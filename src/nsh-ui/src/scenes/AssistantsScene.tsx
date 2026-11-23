import { cleanup, computed, effect, openUrl, Overlay, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { revealPath } from "../fileStore";
import { isRemoteWorkspace, resolveWorkspaceMarkdownLink } from "../shared/workspaceUtils";
import { activeWorkspace, navigateScene } from "../state";
import {
  ASSISTANT_AVATAR_PRESETS,
  ASSISTANT_EMOJI_PRESETS,
  PERSONA_FILES,
  activePersonaFile,
  assistantNameDraft,
  assistantQuickPrompt,
  assistantQuickSending,
  assistantSessions,
  assistantSessionsError,
  assistantSessionsState,
  assistantView,
  assistants,
  assistantsBusy,
  assistantsError,
  assistantsLoading,
  assistantsNotice,
  avatarCustomInput,
  avatarPickerOpen,
  beginAssistantNameEdit,
  cancelAssistantConfirm,
  cancelAssistantNameEdit,
  chatWithAssistant,
  chooseAvatarEmoji,
  chooseAvatarPreset,
  closeNewAssistantModal,
  commitAssistantNameEdit,
  confirmingAssistantAction,
  confirmingPersonaReset,
  createAssistant,
  editingAssistantName,
  executeAssistantConfirm,
  galleryAssistants,
  identitySaveError,
  identitySaveStatus,
  joinPersonaFilePath,
  loadAssistantSessions,
  loadAssistants,
  loadPersonaFile,
  newAssistantModalOpen,
  newAssistantNameInput,
  openAssistantConfig,
  openAssistantGallery,
  openAssistantSession,
  openNewAssistantModal,
  personaDirty,
  personaDraft,
  personaError,
  personaLoading,
  personaNotice,
  personaPreview,
  personaReloadToken,
  personaSaving,
  primaryAssistantId,
  requestAssistantConfirm,
  resetSelectedPersonaFiles,
  savePersonaFile,
  selectPersonaFile,
  selectedAssistant,
  selectedAssistantId,
  selectedAssistantRoot,
  sendQuickPromptToAssistant,
  setPersonaDraftText,
  setPrimaryAssistant,
  submitCustomAvatar,
  syncAssistantsScope,
  toggleAvatarPicker,
  togglePersonaPreview,
  type AssistantWorkspaceView,
  type PersonaFileName,
  assistantWorkspaceBusy,
  closeAssistantWorkspace,
  isAssistantWorkspaceOpen,
  openAssistantWorkspace,
} from "../assistantStore";
import { formatCount, formatPlural, formatRelativeTime } from "../format";
import { localizeHostError, tr } from "../i18n";
import { deviceContext, sessionLastActivityMs } from "../state";
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
  textTracking,
  touchSlop,
} from "../theme";
import { stateColor } from "../ui/fleet";
import { Icon } from "../ui/icons";
import {
  AssistantAvatar,
  InsetGroup,
  STUDIO_CONTENT_MAX,
  STUDIO_TOUCH_MIN,
  StudioEmpty,
  studioCompact,
  studioGutter,
  studioTitleSize,
  trackStudioWidth,
} from "../ui/studio";
import { LibraryToolbar, libraryBodyStyle } from "./LibraryChrome";
import {
  MarkdownDocumentEditor,
  MarkdownPreview,
  visualEditBlock,
  visualEditBlockMessage,
  VisualEditNotice,
} from "../ui/markdownEditor";
import {
  MOTION_DURATION,
  paintTransition,
  popoverEnterMotion,
  pressTransition,
  tactileActiveStyle,
} from "../ui/motion";
import { DropdownMenu, ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import {
  Button,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SegmentedTabs,
  SkeletonBlock,
  ToggleSwitch,
  focusRingStyle,
} from "../ui/primitives";

// Persona documents (wave 22 P1): the shared visual Markdown editor, with the
// source editor when the user asks for it or the document needs it (front matter).
const personaSourceMode = signal(false);
/** Decided on the document as it loads, so the editor does not switch while the user types. */
const personaVisualBlock = computed(() => {
  activePersonaFile();
  if (personaLoading()) return null;
  return visualEditBlock(untracked(() => personaDraft()));
});
const personaEditsVisually = () => !personaSourceMode() && !personaVisualBlock();

const PERSONA_TAB_OPTIONS: ReadonlyArray<{
  value: PersonaFileName;
  label: string;
  accessibilityLabel: string;
}> = PERSONA_FILES.map(file => ({
  value: file,
  label: file,
  accessibilityLabel: `persona-tab-${file}`,
}));

function formatDocumentStats(text: string): string {
  const chars = text.length;
  const lines = chars === 0 ? 0 : text.split(/\r?\n/).length;
  return `${formatPlural(lines, "format.lineOne", "format.lineOther")} · ${formatPlural(chars, "format.charOne", "format.charOther")}`;
}

const studioMenuOpen = signal(false);
const studioMenuAnchor = signal<ViewRef | null>(null);

function buildAssistantMenuItems(assistant: AssistantWorkspaceView): DropdownMenuItem[] {
  const isPrimary = primaryAssistantId() === assistant.id;
  return [
    {
      id: "set-primary",
      label: isPrimary ? tr("assistants.primaryAssistant") : tr("assistants.setAsPrimary"),
      icon: "pin",
      disabled: isPrimary || assistantsBusy(),
      accessibilityLabel: `assistant-set-primary-${assistant.id}`,
      onSelect: () => {
        void setPrimaryAssistant(assistant.id);
      },
    },
    {
      id: "reset",
      label: tr("assistants.resetWorkspace"),
      icon: "undo",
      separator: true,
      disabled: assistantsBusy(),
      accessibilityLabel: `assistant-reset-${assistant.id}`,
      onSelect: () => {
        requestAssistantConfirm(assistant.id, "reset");
      },
    },
    {
      id: "delete",
      label: tr("assistants.deleteAssistant"),
      icon: "trash",
      danger: true,
      disabled: isPrimary || assistantsBusy(),
      accessibilityLabel: `assistant-delete-${assistant.id}`,
      onSelect: () => {
        requestAssistantConfirm(assistant.id, "delete");
      },
    },
  ];
}

/**
 * Compact layout: the list is the landing and an assistant's page replaces it
 * (`assistantView` is "config"), with a back control. The regular layout shows
 * both side by side, so the view only decides what the compact layout draws.
 */
function compactDetailOpen(): boolean {
  return assistantView() === "config";
}

/** Hosted in the Library: the list is the landing and an open assistant replaces it, at every width. */
const assistantsEmbedded = signal(false);

/** The list and the editor take turns (a phone-sized scene, or the Library). */
function listDetailFlow(): boolean {
  return studioCompact() || assistantsEmbedded();
}

/** True while an open assistant's editor replaces the Library list (the Library hides its header). */
export function assistantDetailShown(): boolean {
  return assistantsEmbedded() && compactDetailOpen() && Boolean(selectedAssistant());
}

/** What the studio pane shows under the assistant's header. */
type StudioTab = "persona" | "sessions";
const studioTab = signal<StudioTab>("persona");

/** The row's one line of detail: the vibe and creature, as the desktop's card writes them. */
function assistantMeta(item: AssistantWorkspaceView): string {
  return [item.identity.vibe || item.description || tr("assistants.gallery.noVibe"), item.identity.creature]
    .filter(Boolean)
    .join(" · ");
}

function CompanionGalleryRow(props: { item: AssistantWorkspaceView; first: boolean }) {
  const isSelected = () => selectedAssistantId() === props.item.id;
  const isPrimary = () => primaryAssistantId() === props.item.id;

  return (
    <View
      role="button"
      accessibilityLabel={`assistant-card-${props.item.id}`}
      accessibilityState={{ selected: isSelected() }}
      onPress={() => {
        studioMenuOpen.set(false);
        openAssistantConfig(props.item.id);
      }}
      style={{
        position: "relative",
        minHeight: assistantsEmbedded() ? layout.touchTarget + space.md : STUDIO_TOUCH_MIN + space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: listDetailFlow() ? 0 : radii.md,
        borderCurve: "continuous",
        backgroundColor: isSelected() && !listDetailFlow() ? palette().panelHover : "transparent",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      <If when={listDetailFlow() && !props.first}>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 56,
            right: 0,
            height: 1,
            backgroundColor: palette().borderSubtle,
            pointerEvents: "none",
          }}
        />
      </If>
      <AssistantAvatar
        avatar={props.item.identity.avatar}
        emoji={props.item.identity.emoji}
        name={props.item.name}
        size={32}
        active={isSelected()}
        accessibilityLabel={`assistant-avatar-${props.item.id}`}
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: space.sm }}>
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(14),
              fontWeight: isSelected() ? "600" : "500",
              lineHeight: textLineHeight(14, 1.3),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.item.name}
          </Text>
          <If when={isPrimary()}>
            <Text
              accessibilityLabel={`assistant-primary-dot-${props.item.id}`}
              style={{
                ...textStyle("caption"),
                flexShrink: 0,
              }}
            >
              {tr("common.primary")}
            </Text>
          </If>
        </View>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(12),
            lineHeight: textLineHeight(12, 1.36),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {assistantMeta(props.item)}
        </Text>
      </View>
      <If when={listDetailFlow()}>
        <Icon name="chevron-right" size={12} color={palette().textMuted} />
      </If>
    </View>
  );
}

/** The desktop gallery's create card, as a quiet last row while there are fewer than three assistants. */
function CreateAssistantRow() {
  return (
    <View
      role="button"
      accessibilityLabel="assistants-create-card"
      onPress={() => {
        if (!assistantsBusy()) openNewAssistantModal();
      }}
      style={{
        position: "relative",
        minHeight: STUDIO_TOUCH_MIN + space.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: studioCompact() ? 0 : radii.md,
        borderCurve: "continuous",
        cursor: "pointer",
        userSelect: "none",
        ...pressTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
      activeStyle={tactileActiveStyle(0.985)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      <If when={studioCompact() && assistants().length > 0}>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 56,
            right: 0,
            height: 1,
            backgroundColor: palette().borderSubtle,
            pointerEvents: "none",
          }}
        />
      </If>
      <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
        <Icon name="plus" size={16} color={palette().textMuted} />
      </View>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(14),
          lineHeight: textLineHeight(14, 1.3),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {tr("assistants.newAssistant")}
      </Text>
    </View>
  );
}

function CompanionsRail() {
  return (
    <View
      style={{
        width: studioCompact() ? "100%" : 264,
        flex: studioCompact() ? 1 : undefined,
        flexShrink: 0,
        minHeight: 0,
        borderRightWidth: studioCompact() ? 0 : 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvas,
      }}
    >
      <View
        style={{
          paddingHorizontal: studioCompact() ? studioGutter() : 16,
          paddingTop: studioCompact() ? 20 : 20,
          paddingBottom: 12,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text
              role="header"
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(studioCompact() ? studioTitleSize() : 17),
                fontWeight: "600",
                letterSpacing: textTracking(studioCompact() ? studioTitleSize() : 17),
                lineHeight: textLineHeight(studioCompact() ? studioTitleSize() : 17, 1.25),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("assistants.title")}
            </Text>
            <Text
              style={{
                flexShrink: 0,
                color: palette().textMuted,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.3),
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCount(assistants().length)}
            </Text>
          </View>
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("assistants.refreshTooltip")}
            disabled={assistantsLoading()}
            accessibilityLabel="assistants-refresh"
            style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={() => void loadAssistants()}
          />
          <IconButton
            icon="plus"
            size="sm"
            tooltip={tr("assistants.newAssistant")}
            disabled={assistantsBusy()}
            accessibilityLabel="assistants-new"
            style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={openNewAssistantModal}
          />
        </View>

        <If when={assistantsNotice()}>
          {notice => (
            <Text
              style={{
                color: stateColor("done"),
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {notice()}
            </Text>
          )}
        </If>
        <If when={assistantsError() && assistants().length > 0 ? assistantsError() : ""}>
          {err => (
            <Text
              style={{
                color: stateColor("failed"),
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {localizeHostError(err())}
            </Text>
          )}
        </If>
      </View>

      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            paddingHorizontal: studioCompact() ? studioGutter() : space.sm,
            paddingBottom: space.lg,
            gap: studioCompact() ? 0 : space.hair,
          }}
        >
          <If when={assistantsLoading() && assistants().length === 0}>
            <View style={{ gap: space.sm, paddingVertical: space.xs }}>
              <SkeletonBlock height={52} borderRadius={radii.md} />
              <SkeletonBlock height={52} borderRadius={radii.md} />
            </View>
          </If>
          <If when={!assistantsLoading() && assistants().length === 0}>
            <StudioEmpty
              icon={assistantsError() ? "alert-circle" : "bot"}
              tone={assistantsError() ? "danger" : "neutral"}
              message={
                assistantsError()
                  ? tr("assistants.unavailableTitle")
                  : tr("assistants.noneYetTitle")
              }
              detail={
                assistantsError()
                  ? localizeHostError(assistantsError())
                  : tr("assistants.noneYetSubtitle")
              }
              action={
                <Button
                  label={assistantsError() ? tr("common.retry") : tr("assistants.newAssistant")}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    if (assistantsError()) void loadAssistants();
                    else openNewAssistantModal();
                  }}
                />
              }
            />
          </If>
          <If when={assistants().length > 0}>
            <View
              style={
                studioCompact()
                  ? {
                      borderRadius: radii.lg,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: palette().borderSubtle,
                      backgroundColor: palette().panelRaised,
                      overflow: "hidden",
                    }
                  : { gap: 2 }
              }
            >
              <Each of={galleryAssistants()} key={item => item.id}>
                {(item, idx) => <CompanionGalleryRow item={item()} first={idx() === 0} />}
              </Each>
              <If when={assistants().length < 3}>
                <CreateAssistantRow />
              </If>
            </View>
          </If>
        </View>
      </Scroll>
    </View>
  );
}

/** The Library's Assistants tab: its toolbar (refresh, New assistant), then the rows. */
function AssistantLibraryList() {
  const phone = () => compactLayout();
  return (
    <Scroll style={{ flex: 1, minHeight: 0 }}>
      <LibraryToolbar
        accessibilityLabel="assistants-toolbar"
        leading={
          <IconButton
            icon="refresh"
            size="md"
            tooltip={tr("assistants.refreshTooltip")}
            disabled={assistantsLoading()}
            accessibilityLabel="assistants-refresh"
            style={phone() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={() => void loadAssistants()}
          />
        }
        primary={
          <Button
            label={tr("assistants.newAssistant")}
            variant="primary"
            size="md"
            leadingIcon="plus"
            disabled={assistantsBusy()}
            accessibilityLabel="assistants-new"
            style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
            onPress={openNewAssistantModal}
          />
        }
      />
      <View style={libraryBodyStyle()}>
        <If when={assistantsNotice()}>
          {notice => <Text style={textStyle("caption", { color: stateColor("done") })}>{notice()}</Text>}
        </If>
        <If when={assistantsError() && assistants().length > 0 ? assistantsError() : ""}>
          {err => <Text style={textStyle("caption", { color: stateColor("failed") })}>{localizeHostError(err())}</Text>}
        </If>
        <If when={assistantsLoading() && assistants().length === 0}>
          <View style={{ gap: space.sm }}>
            <SkeletonBlock height={56} borderRadius={radii.lg} />
            <SkeletonBlock height={56} borderRadius={radii.lg} />
          </View>
        </If>
        <If when={!assistantsLoading() && assistants().length === 0}>
          <StudioEmpty
            icon={assistantsError() ? "alert-circle" : "bot"}
            tone={assistantsError() ? "danger" : "neutral"}
            message={assistantsError() ? tr("assistants.unavailableTitle") : tr("assistants.noneYetTitle")}
            detail={assistantsError() ? localizeHostError(assistantsError()) : tr("assistants.noneYetSubtitle")}
            action={
              <Button
                label={assistantsError() ? tr("common.retry") : tr("assistants.newAssistant")}
                variant="secondary"
                size="md"
                accessibilityLabel="assistants-empty-action"
                style={phone() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                onPress={() => {
                  if (assistantsError()) void loadAssistants();
                  else openNewAssistantModal();
                }}
              />
            }
          />
        </If>
        <If when={assistants().length > 0}>
          <InsetGroup accessibilityLabel="assistants-list">
            <Each of={galleryAssistants()} key={item => item.id}>
              {(item, idx) => <CompanionGalleryRow item={item()} first={idx() === 0} />}
            </Each>
          </InsetGroup>
        </If>
      </View>
    </Scroll>
  );
}

const avatarAnchor = signal<ViewRef | null>(null);

function identityStatusText(): string {
  switch (identitySaveStatus()) {
    case "saving":
      return tr("assistants.avatar.saving");
    case "saved":
      return tr("assistants.avatar.saved");
    case "error":
      return tr("assistants.avatar.saveFailed");
    default:
      return tr("assistants.avatar.autosave");
  }
}

function avatarOptionStyle(selected: boolean) {
  const tile = compactLayout() ? layout.touchTarget : 36;
  return {
    width: tile,
    height: tile,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radii.md,
    borderCurve: "continuous" as const,
    backgroundColor: selected ? palette().accentSoft : "transparent",
    cursor: "pointer" as const,
    userSelect: "none" as const,
    ...pressTransition(MOTION_DURATION.fast),
  };
}

function AvatarPickerLabel(props: { label: string }) {
  return (
    <Text
      style={{
        color: palette().textSecondary,
        fontSize: textSize(12),
        fontWeight: "600",
        lineHeight: textLineHeight(12, 1.3),
      }}
    >
      {props.label}
    </Text>
  );
}

/**
 * The header avatar is the avatar picker: the desktop's official artwork, its
 * emoji presets and one custom symbol. Every choice is written into
 * IDENTITY.md at once (`chooseAvatarPreset` / `chooseAvatarEmoji`).
 */
function AvatarPicker(props: { assistant: AssistantWorkspaceView; size: number }) {
  const popoverMotion = popoverEnterMotion("bottom", "start");
  return (
    <View style={{ flexShrink: 0 }}>
      <View
        ref={el => avatarAnchor.set(el)}
        role="button"
        accessibilityLabel="assistant-avatar-change"
        accessibilityState={{ expanded: avatarPickerOpen() }}
        hitSlop={touchSlop(props.size)}
        tooltip={compactLayout() ? undefined : tr("assistants.avatar.title")}
        onPress={toggleAvatarPicker}
        style={{
          position: "relative",
          borderRadius: radii.pill,
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle()}
      >
        <AssistantAvatar
          avatar={props.assistant.identity.avatar}
          emoji={props.assistant.identity.emoji}
          name={props.assistant.name}
          size={props.size}
        />
        <View
          style={{
            position: "absolute",
            right: -space.hair,
            bottom: -space.hair,
            width: 16,
            height: 16,
            borderRadius: radii.pill,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            backgroundColor: palette().canvas,
            pointerEvents: "none",
          }}
        >
          <Icon name="edit" size={10} color={palette().textMuted} />
        </View>
      </View>
      <If when={avatarPickerOpen()}>
        <Overlay
          anchor={avatarAnchor()}
          placement="bottom"
          align="start"
          offset={space.sm}
          margin={space.sm}
          onPressOutside={() => avatarPickerOpen.set(false)}
          onCancel={() => avatarPickerOpen.set(false)}
        >
          <View
            role="dialog"
            accessibilityLabel="assistant-avatar-picker"
            style={[
              {
                width: compactLayout() ? 280 : 296,
                maxWidth: "100%",
                gap: space.md,
                padding: space.lg,
                borderRadius: radii.lg,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().popoverBg,
                boxShadow: palette().shadowOverlay,
              },
              popoverMotion.style,
            ]}
          >
            <View style={{ gap: space.hair }}>
              <Text
                style={{
                  color: palette().text,
                  fontSize: textSize(13),
                  fontWeight: "600",
                  lineHeight: textLineHeight(13, 1.3),
                }}
              >
                {tr("assistants.avatar.title")}
              </Text>
              <Text
                style={{
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.4),
                }}
              >
                {tr("assistants.avatar.hint")}
              </Text>
            </View>
            <View style={{ gap: space.xs }}>
              <AvatarPickerLabel label={tr("assistants.avatar.official")} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.hair }}>
                <Each of={[...ASSISTANT_AVATAR_PRESETS]} key={item => item}>
                  {preset => (
                    <View
                      role="button"
                      accessibilityLabel={`assistant-avatar-preset-${preset()}`}
                      accessibilityState={{ selected: props.assistant.identity.avatar === preset() }}
                      hitSlop={touchSlop(36)}
                      onPress={() => void chooseAvatarPreset(preset())}
                      style={avatarOptionStyle(props.assistant.identity.avatar === preset())}
                      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
                      activeStyle={tactileActiveStyle(0.95)}
                      focusVisibleStyle={focusRingStyle()}
                    >
                      <AssistantAvatar avatar={preset()} size={28} />
                    </View>
                  )}
                </Each>
              </View>
            </View>
            <View style={{ gap: space.xs }}>
              <AvatarPickerLabel label={tr("assistants.avatar.emoji")} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.hair }}>
                <Each of={[...ASSISTANT_EMOJI_PRESETS]} key={item => item}>
                  {(emoji, index) => (
                    <View
                      role="button"
                      accessibilityLabel={`assistant-avatar-emoji-${index()}`}
                      accessibilityState={{
                        selected: !props.assistant.identity.avatar && props.assistant.identity.emoji === emoji(),
                      }}
                      hitSlop={touchSlop(36)}
                      onPress={() => void chooseAvatarEmoji(emoji())}
                      style={avatarOptionStyle(
                        !props.assistant.identity.avatar && props.assistant.identity.emoji === emoji(),
                      )}
                      hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
                      activeStyle={tactileActiveStyle(0.95)}
                      focusVisibleStyle={focusRingStyle()}
                    >
                      <Text style={{ fontSize: textSize(16), lineHeight: textLineHeight(16, 1.2) }}>
                        {emoji()}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Input
                value={avatarCustomInput()}
                placeholder={tr("assistants.avatar.customPlaceholder")}
                accessibilityLabel="assistant-avatar-custom"
                submitBehavior="submit"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: compactLayout() ? layout.touchTarget : 32,
                  paddingHorizontal: space.sm,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().inputBg,
                  color: palette().text,
                  placeholderColor: palette().textMuted,
                  caretColor: palette().accent,
                  fontSize: compactLayout() ? Math.max(16, textSize(13)) : textSize(13),
                }}
                onChange={event => avatarCustomInput.set(event.value)}
                onSubmit={() => void submitCustomAvatar()}
              />
              <Button
                label={tr("assistants.avatar.useCustom")}
                variant="secondary"
                size={compactLayout() ? "md" : "sm"}
                disabled={!avatarCustomInput().trim()}
                accessibilityLabel="assistant-avatar-custom-apply"
                style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                onPress={() => void submitCustomAvatar()}
              />
            </View>
            <Text
              accessibilityLabel="assistant-identity-status"
              style={{
                color: identitySaveStatus() === "error" ? stateColor("failed") : palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {identityStatusText()}
            </Text>
          </View>
        </Overlay>
      </If>
    </View>
  );
}

/** The header name, pressed to edit in place: Return or leaving the field saves, Escape cancels. */
function AssistantNameEditor(props: { assistant: AssistantWorkspaceView }) {
  return (
    <If
      when={editingAssistantName()}
      else={
        <View
          role="button"
          accessibilityLabel="assistant-name-edit"
          hitSlop={touchSlop(32)}
          tooltip={compactLayout() ? undefined : tr("assistants.renameTooltip")}
          onPress={beginAssistantNameEdit}
          style={{
            flexShrink: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: -space.xs,
            paddingHorizontal: space.xs,
            borderRadius: radii.sm,
            borderCurve: "continuous",
            cursor: "text",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.985)}
          focusVisibleStyle={focusRingStyle()}
        >
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(studioCompact() ? 17 : 22),
              fontWeight: "600",
              letterSpacing: textTracking(studioCompact() ? 17 : 22),
              lineHeight: textLineHeight(studioCompact() ? 17 : 22, 1.25),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.assistant.identity.name || props.assistant.name}
          </Text>
        </View>
      }
    >
      <Input
        value={assistantNameDraft()}
        autoFocus={true}
        accessibilityLabel="assistant-name-input"
        submitBehavior="submit"
        style={{
          flex: 1,
          minWidth: 0,
          height: textLineHeight(22, 1.25),
          marginHorizontal: -space.xs,
          paddingHorizontal: space.xs,
          borderRadius: radii.sm,
          borderWidth: 1,
          borderColor: palette().fieldFocusBorder,
          backgroundColor: palette().inputBg,
          color: palette().text,
          placeholderColor: palette().textMuted,
          caretColor: palette().accent,
          fontSize: textSize(studioCompact() ? 17 : 22),
          fontWeight: "600",
        }}
        onChange={event => assistantNameDraft.set(event.value)}
        onSubmit={() => void commitAssistantNameEdit()}
        onBlur={() => void commitAssistantNameEdit()}
        onKeyPress={event => {
          if (event.key === "Escape") cancelAssistantNameEdit();
        }}
      />
    </If>
  );
}

/** Quiet text tabs under the header: the persona documents or the assistant's sessions. */
function StudioTabs() {
  const tabs: ReadonlyArray<{ value: StudioTab; label: () => string }> = [
    { value: "persona", label: () => tr("assistants.tab.persona") },
    { value: "sessions", label: () => tr("assistants.page.sessionsTitle") },
  ];
  return (
    <View role="tablist" style={{ flexDirection: "row", alignItems: "stretch", gap: space.xl }}>
      <Each of={tabs} key={tab => tab.value}>
        {tab => (
          <View
            role="tab"
            accessibilityLabel={`assistant-tab-${tab().value}`}
            accessibilityState={{ selected: studioTab() === tab().value }}
            hitSlop={touchSlop(compactLayout() ? layout.touchTarget : 36)}
            onPress={() => studioTab.set(tab().value)}
            activeStyle={tactileActiveStyle(0.97)}
            focusVisibleStyle={focusRingStyle()}
            style={{
              position: "relative",
              height: compactLayout() ? layout.touchTarget : 36,
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              ...pressTransition(MOTION_DURATION.fast),
            }}
          >
            <Text
              style={{
                color: studioTab() === tab().value ? palette().text : palette().textSecondary,
                fontSize: textSize(13),
                fontWeight: studioTab() === tab().value ? "600" : "500",
                lineHeight: textLineHeight(13, 1.3),
                ...paintTransition(MOTION_DURATION.fast),
              }}
            >
              {tab().label()}
            </Text>
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: -1,
                height: 2,
                borderRadius: radii.pill,
                backgroundColor: studioTab() === tab().value ? palette().accent : "transparent",
                pointerEvents: "none",
                ...paintTransition(MOTION_DURATION.fast),
              }}
            />
          </View>
        )}
      </Each>
    </View>
  );
}

/** The assistant's own sessions (`list_persisted_sessions_page` for its workspace), newest first. */
function AssistantSessionsPane(props: { assistant: AssistantWorkspaceView }) {
  return (
    <Scroll
      style={{ flex: 1, minHeight: 0 }}
      contentStyle={{ paddingHorizontal: studioGutter(), paddingTop: 20, paddingBottom: 16, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: STUDIO_CONTENT_MAX, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 }}>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().textSecondary,
              fontSize: textSize(13),
              fontWeight: "600",
              lineHeight: textLineHeight(13, 1.3),
            }}
          >
            {assistantSessionsState() === "ready" && assistantSessions().length > 0
              ? formatPlural(assistantSessions().length, "format.sessionOne", "format.sessionOther")
              : tr("assistants.page.sessionsTitle")}
          </Text>
          <IconButton
            icon="refresh"
            size="sm"
            tooltip={tr("assistants.page.sessionsRefresh")}
            disabled={assistantSessionsState() === "loading"}
            accessibilityLabel="assistant-sessions-refresh"
            onPress={() => void loadAssistantSessions(props.assistant)}
          />
        </View>
        <If
          when={assistantSessionsState() === "ready" && assistantSessions().length > 0}
          else={
            <Text
              style={{
                paddingVertical: space.md,
                color: assistantSessionsState() === "error" ? stateColor("failed") : palette().textSecondary,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.45),
              }}
            >
              {assistantSessionsState() === "error"
                ? tr("assistants.page.sessionsFailed", {
                    error: localizeHostError(assistantSessionsError()),
                  })
                : assistantSessionsState() === "ready"
                  ? tr("assistants.page.sessionsEmpty")
                  : tr("common.loading")}
            </Text>
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
            <Each of={assistantSessions()} key={item => item.sessionId}>
              {(session, index) => (
                <View
                  role="button"
                  accessibilityLabel={`assistant-session-${session().sessionId}`}
                  onPress={() => void openAssistantSession(props.assistant, session().sessionId)}
                  style={{
                    position: "relative",
                    minHeight: STUDIO_TOUCH_MIN,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                    paddingHorizontal: space.lg,
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
                  activeStyle={tactileActiveStyle(0.985)}
                  focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
                >
                  <If when={index() > 0}>
                    <View
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 16,
                        right: 0,
                        height: 1,
                        backgroundColor: palette().borderSubtle,
                        pointerEvents: "none",
                      }}
                    />
                  </If>
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().text,
                      fontSize: textSize(14),
                      lineHeight: textLineHeight(14, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {session().sessionName || tr("assistants.page.untitledSession")}
                  </Text>
                  <Text
                    style={{
                      flexShrink: 0,
                      color: palette().textSecondary,
                      fontSize: textSize(13),
                      lineHeight: textLineHeight(13, 1.3),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatRelativeTime(sessionLastActivityMs(session()))}
                  </Text>
                  <Icon name="chevron-right" size={12} color={palette().textMuted} />
                </View>
              )}
            </Each>
          </View>
        </If>
      </View>
    </Scroll>
  );
}

function personaNoticeTone(notice: string): "info" | "success" {
  if (
    notice === tr("assistants.store.fileMissing", { file: activePersonaFile() }) ||
    notice === tr("assistants.persona.fileMissing")
  ) {
    return "info";
  }
  if (
    notice === tr("assistants.store.savedFile", { file: activePersonaFile() }) ||
    notice === tr("assistants.store.personaReset")
  ) {
    return "success";
  }
  return "info";
}

function PersonaStudioPane() {
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: palette().canvas }}>
      <If
        when={selectedAssistant()}
        else={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <StudioEmpty
              icon="sparkles"
              message={tr("assistants.emptyTitle")}
              detail={tr("assistants.emptySubtitle")}
              action={
                <Button
                  label={tr("assistants.newAssistant")}
                  variant="secondary"
                  size="sm"
                  onPress={openNewAssistantModal}
                />
              }
            />
          </View>
        }
      >
        {assistant => (
          <View style={{ flex: 1, minHeight: 0 }}>
            {/* Studio header: avatar, large name, one detail line, quiet trailing actions. */}
            <View
              style={{
                paddingHorizontal: studioGutter(),
                paddingTop: studioCompact() ? 12 : 24,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().canvas,
                alignItems: "center",
              }}
            >
              <View style={{ width: "100%", maxWidth: STUDIO_CONTENT_MAX, alignSelf: "center", gap: 12 }}>
                <If when={listDetailFlow()}>
                  <View style={{ flexDirection: "row" }}>
                    <Button
                      label={tr("assistants.title")}
                      variant="ghost"
                      size="sm"
                      leadingIcon="chevron-left"
                      accessibilityLabel="assistants-back"
                      style={{ marginLeft: -8, minHeight: STUDIO_TOUCH_MIN }}
                      onPress={openAssistantGallery}
                    />
                  </View>
                </If>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flexWrap: studioCompact() ? "wrap" : "nowrap",
                    gap: space.md,
                  }}
                >
                  <AvatarPicker assistant={assistant()} size={40} />

                  <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                    <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: space.sm }}>
                      <AssistantNameEditor assistant={assistant()} />
                      <If when={primaryAssistantId() === assistant().id && !editingAssistantName()}>
                        <Text
                          style={{
                            flexShrink: 0,
                            color: palette().textMuted,
                            fontSize: textSize(13),
                            lineHeight: textLineHeight(13, 1.3),
                          }}
                        >
                          {tr("common.primary")}
                        </Text>
                      </If>
                    </View>
                    <Text
                      style={{
                        color: palette().textSecondary,
                        fontSize: textSize(13),
                        lineHeight: textLineHeight(13, 1.4),
                        maxWidth: 560,
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {[
                        assistant().identity.vibe ||
                          assistant().description ||
                          tr("assistants.personaStudio"),
                        assistant().identity.creature,
                        assistant().lastAccessedText
                          ? tr("assistants.lastActive", { time: assistant().lastAccessedText })
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <If when={identitySaveStatus() === "error" ? identitySaveError() : ""}>
                      {err => (
                        <Text
                          style={{
                            color: stateColor("failed"),
                            fontSize: textSize(12),
                            lineHeight: textLineHeight(12, 1.4),
                          }}
                        >
                          {`${tr("assistants.avatar.saveFailed")} ${localizeHostError(err())}`}
                        </Text>
                      )}
                    </If>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", flexShrink: 0, gap: space.sm }}>
                    <If
                      when={isAssistantWorkspaceOpen(assistant().id)}
                      else={
                        <Button
                          label={tr("assistants.openWorkspace")}
                          variant="ghost"
                          size="sm"
                          leadingIcon="folder-open"
                          loading={assistantWorkspaceBusy() === assistant().id}
                          disabled={Boolean(assistantWorkspaceBusy())}
                          accessibilityLabel={`assistant-open-${assistant().id}`}
                          style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                          onPress={() => void openAssistantWorkspace(assistant())}
                        />
                      }
                    >
                      <Button
                        label={tr("assistants.closeWorkspace")}
                        variant="ghost"
                        size="sm"
                        leadingIcon="close"
                        loading={assistantWorkspaceBusy() === assistant().id}
                        disabled={Boolean(assistantWorkspaceBusy())}
                        accessibilityLabel={`assistant-close-${assistant().id}`}
                        style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                        onPress={() => void closeAssistantWorkspace(assistant())}
                      />
                    </If>
                    <Button
                      label={tr("assistants.chat")}
                      variant="secondary"
                      size="sm"
                      leadingIcon="chat"
                      accessibilityLabel={`assistant-chat-${assistant().id}`}
                      style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                      onPress={() => chatWithAssistant(assistant())}
                    />
                    <View ref={el => studioMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
                      <IconButton
                        icon="more"
                        size="sm"
                        tooltip={tr("assistants.actions")}
                        active={studioMenuOpen()}
                        accessibilityLabel={`assistant-actions-${assistant().id}`}
                        style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
                        onPress={() => studioMenuOpen.update(open => !open)}
                      />
                    </View>
                    <DropdownMenu
                      open={studioMenuOpen()}
                      anchor={studioMenuAnchor()}
                      placement="bottom"
                      align="end"
                      minWidth={200}
                      items={buildAssistantMenuItems(assistant())}
                      onClose={() => studioMenuOpen.set(false)}
                    />
                  </View>
                </View>

                {/* With the list out of view, its notice and error show under the open assistant. */}
                <If when={listDetailFlow() ? assistantsNotice() : ""}>
                  {notice => <Text style={textStyle("caption", { color: stateColor("done") })}>{notice()}</Text>}
                </If>
                <If when={listDetailFlow() ? assistantsError() : ""}>
                  {err => (
                    <Text style={textStyle("caption", { color: stateColor("failed") })}>{localizeHostError(err())}</Text>
                  )}
                </If>
                <If
                  when={
                    confirmingAssistantAction()?.id === assistant().id
                      ? confirmingAssistantAction()
                      : null
                  }
                >
                  {confirm => (
                    <InlineConfirmBar
                      message={
                        confirm().kind === "delete"
                          ? tr("assistants.deleteConfirmMessage", { name: assistant().name })
                          : tr("assistants.resetConfirmMessage", { name: assistant().name })
                      }
                      confirmLabel={
                        confirm().kind === "delete"
                          ? tr("common.confirmDelete")
                          : tr("assistants.confirmReset")
                      }
                      danger={confirm().kind === "delete"}
                      onCancel={cancelAssistantConfirm}
                      onConfirm={() => void executeAssistantConfirm()}
                    />
                  )}
                </If>
                <StudioTabs />
              </View>
            </View>

            <If
              when={studioTab() === "sessions"}
              else={
                <>
                    {/* Persona toolbar: file tabs, preview, reset, the one primary Save. */}
                    <View
                      style={{
                        paddingHorizontal: studioGutter(),
                        paddingVertical: space.md,
                        borderBottomWidth: 1,
                        borderColor: palette().borderSubtle,
                        backgroundColor: palette().canvas,
                        alignItems: "center",
                      }}
                    >
                      <View
                        style={{
                          width: "100%",
                          maxWidth: STUDIO_CONTENT_MAX,
                          alignSelf: "center",
                          gap: space.sm,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: space.sm,
                          }}
                        >
                          <Scroll horizontal scrollbar={false} style={{ maxWidth: "100%", minWidth: 0 }}>
                            <SegmentedTabs
                              size="sm"
                              options={PERSONA_TAB_OPTIONS}
                              value={activePersonaFile()}
                              onChange={selectPersonaFile}
                            />
                          </Scroll>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              flexWrap: "wrap",
                              flexShrink: 0,
                              gap: space.sm,
                            }}
                          >
                            <ToggleSwitch
                              value={personaPreview()}
                              label={tr("common.preview")}
                              accessibilityLabel="persona-preview-toggle"
                              onChange={togglePersonaPreview}
                            />
                            <If when={!personaPreview() && !personaVisualBlock()}>
                              <Button
                                label={personaSourceMode() ? tr("doc.editVisually") : tr("doc.editAsSource")}
                                variant="ghost"
                                size="sm"
                                accessibilityLabel="persona-source-toggle"
                                style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                                onPress={() => {
                                  // A source draft the visual editor cannot keep stays in the source editor.
                                  const block = personaSourceMode() ? visualEditBlock(personaDraft()) : null;
                                  if (block) {
                                    personaNotice.set(visualEditBlockMessage(block));
                                    return;
                                  }
                                  personaSourceMode.set(!personaSourceMode());
                                }}
                              />
                            </If>
                            <Button
                              label={tr("common.reset")}
                              variant="ghost"
                              size="sm"
                              disabled={personaSaving()}
                              accessibilityLabel="persona-reset-files"
                              style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                              onPress={() => {
                                confirmingPersonaReset.set(true);
                              }}
                            />
                            <Button
                              label={personaSaving() ? tr("common.saving") : tr("common.save")}
                              variant={personaDirty() ? "primary" : "secondary"}
                              size="sm"
                              loading={personaSaving()}
                              disabled={personaSaving()}
                              accessibilityLabel="persona-save"
                              style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                              onPress={() => void savePersonaFile()}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
                          <Text
                            style={{
                              flex: 1,
                              minWidth: 0,
                              color: palette().textMuted,
                              fontFamily: fontMono,
                              fontSize: textSize(12),
                              lineHeight: textLineHeight(12, 1.35),
                              numberOfLines: 1,
                              textOverflow: "ellipsis-middle",
                            }}
                          >
                            {joinPersonaFilePath(assistant().rootPath, activePersonaFile())}
                          </Text>
                          <Text
                            style={{
                              flexShrink: 0,
                              color: personaDirty() ? stateColor("needs_you") : palette().textMuted,
                              fontSize: textSize(12),
                              lineHeight: textLineHeight(12, 1.3),
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {[
                              studioCompact() ? "" : formatDocumentStats(personaDraft()),
                              personaLoading()
                                ? tr("common.loading")
                                : personaDirty()
                                  ? tr("assistants.unsavedChanges")
                                  : tr("common.saved"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <If when={confirmingPersonaReset()}>
                      <View
                        style={{
                          paddingHorizontal: studioGutter(),
                          paddingVertical: space.sm,
                          borderBottomWidth: 1,
                          borderColor: palette().borderSubtle,
                          backgroundColor: palette().canvas,
                          alignItems: "center",
                        }}
                      >
                        <View style={{ width: "100%", maxWidth: STUDIO_CONTENT_MAX, alignSelf: "center" }}>
                          <InlineConfirmBar
                            message={tr("assistants.resetFilesConfirmMessage")}
                            confirmLabel={tr("assistants.confirmResetFiles")}
                            onCancel={() => {
                              confirmingPersonaReset.set(false);
                            }}
                            onConfirm={() => {
                              void resetSelectedPersonaFiles();
                            }}
                          />
                        </View>
                      </View>
                    </If>

                    <If when={personaNotice()}>
                      {notice => (
                        <View style={{ paddingHorizontal: studioGutter(), paddingTop: space.sm, alignItems: "center" }}>
                          <View style={{ width: "100%", maxWidth: STUDIO_CONTENT_MAX, alignSelf: "center" }}>
                            <InlineBanner
                              tone={personaNoticeTone(notice())}
                              message={notice()}
                              style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}
                            />
                          </View>
                        </View>
                      )}
                    </If>
                    <If when={personaError()}>
                      {err => (
                        <View style={{ paddingHorizontal: studioGutter(), paddingTop: space.sm, alignItems: "center" }}>
                          <View style={{ width: "100%", maxWidth: STUDIO_CONTENT_MAX, alignSelf: "center" }}>
                            <InlineBanner
                              tone="danger"
                              message={localizeHostError(err())}
                              style={{ paddingHorizontal: space.md, paddingVertical: space.sm }}
                            />
                          </View>
                        </View>
                      )}
                    </If>

                    {/* De-boxed Editor & Editorial Preview Canvas */}
                    <View style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}>
                      <If
                        when={personaPreview()}
                        else={
                          <View
                            style={{
                              flex: 1,
                              minHeight: 0,
                              paddingHorizontal: studioGutter(),
                              paddingVertical: space.lg,
                              alignItems: "center",
                            }}
                          >
                            <View
                              style={{
                                flex: 1,
                                minHeight: 0,
                                width: "100%",
                                maxWidth: STUDIO_CONTENT_MAX,
                                alignSelf: "center",
                              }}
                            >
                              <If
                                when={personaEditsVisually()}
                                else={
                                  <View style={{ flex: 1, minHeight: 0 }}>
                                    <If when={personaVisualBlock()}>
                                      {block => <VisualEditNotice block={block()} inset={0} />}
                                    </If>
                                    <Input
                                      value={personaDraft()}
                                      placeholder={tr("assistants.editorPlaceholder", {
                                        file: activePersonaFile(),
                                      })}
                                      accessibilityLabel="persona-editor-input"
                                      multiline={true}
                                      submitBehavior="newline"
                                      style={{
                                        flex: 1,
                                        minHeight: 190,
                                        color: palette().text,
                                        placeholderColor: palette().textMuted,
                                        caretColor: palette().accent,
                                        fontFamily: fontMono,
                                        fontSize: compactLayout() ? Math.max(16, textSize(13)) : textSize(13),
                                        lineHeight: textLineHeight(13, 1.62),
                                      }}
                                      onChange={event => setPersonaDraftText(event.value)}
                                    />
                                  </View>
                                }
                              >
                                <MarkdownDocumentEditor
                                  documentKey={joinPersonaFilePath(assistant().rootPath, activePersonaFile())}
                                  documentName={activePersonaFile()}
                                  text={personaDraft()}
                                  onChange={setPersonaDraftText}
                                  accessibilityLabel="persona-editor-input"
                                  placeholder={tr("assistants.editorPlaceholder", { file: activePersonaFile() })}
                                  compact={true}
                                  ai={true}
                                />
                              </If>
                            </View>
                          </View>
                        }
                      >
                        <Scroll
                          style={{ flex: 1, minHeight: 0 }}
                          contentStyle={{ paddingHorizontal: studioGutter(), paddingVertical: space.xl, alignItems: "center" }}
                        >
                          <View
                            style={{
                              width: "100%",
                              maxWidth: STUDIO_CONTENT_MAX,
                            }}
                          >
                            <If
                              when={personaDraft().trim()}
                              else={
                                <View style={{ alignItems: "center", paddingVertical: space.xxl, gap: space.sm }}>
                                  <Icon name="file-text" size={28} color={palette().textMuted} />
                                  <Text
                                    style={{
                                      color: palette().textSecondary,
                                      fontSize: textSize(13),
                                      lineHeight: textLineHeight(13, 1.48),
                                      textAlign: "center",
                                    }}
                                  >
                                    {tr("assistants.emptyPreview")}
                                  </Text>
                                </View>
                              }
                            >
                              {md => (
                                <MarkdownPreview
                                  markdown={md()}
                                  links="report"
                                  onLinkPress={event => {
                                    const baseDir = assistant().rootPath || activeWorkspace()?.rootPath || "";
                                    const resolved = resolveWorkspaceMarkdownLink(
                                      event.url,
                                      baseDir,
                                      isRemoteWorkspace(activeWorkspace()),
                                    );
                                    if (resolved.kind === "external") {
                                      void openUrl(resolved.target).catch(() => undefined);
                                    } else if (resolved.kind === "workspace") {
                                      void revealPath(resolved.target);
                                      navigateScene("files");
                                    }
                                  }}
                                />
                              )}
                            </If>
                          </View>
                        </Scroll>
                      </If>
                    </View>
                </>
              }
            >
              <AssistantSessionsPane assistant={assistant()} />
            </If>

            {/* Quick message: one quiet field on the canvas. */}
            <View
              style={{
                paddingHorizontal: studioGutter(),
                paddingTop: space.sm,
                paddingBottom: space.lg,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: STUDIO_CONTENT_MAX,
                  alignSelf: "center",
                  minHeight: STUDIO_TOUCH_MIN + space.xs,
                  borderRadius: radii.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().panelRaised,
                  paddingLeft: space.lg,
                  paddingRight: space.sm,
                  paddingVertical: space.xs,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                focusWithinStyle={{ borderColor: palette().fieldFocusBorder }}
              >
                <Input
                  value={assistantQuickPrompt()}
                  placeholder={tr("assistants.messagePlaceholder", { name: assistant().name })}
                  accessibilityLabel="assistant-quick-prompt"
                  submitBehavior="submit"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: palette().text,
                    placeholderColor: palette().textMuted,
                    caretColor: palette().accent,
                    fontSize: compactLayout() ? Math.max(16, textSize(14)) : textSize(14),
                    lineHeight: textLineHeight(14, 1.45),
                  }}
                  onChange={event => assistantQuickPrompt.set(event.value)}
                  onSubmit={() => void sendQuickPromptToAssistant()}
                />
                <Button
                  label={assistantQuickSending() ? tr("common.sending") : tr("common.send")}
                  variant={personaDirty() ? "secondary" : "primary"}
                  size="sm"
                  leadingIcon="arrow-up"
                  loading={assistantQuickSending()}
                  disabled={assistantQuickSending() || !assistantQuickPrompt().trim()}
                  accessibilityLabel="assistant-quick-send"
                  style={compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : undefined}
                  onPress={() => void sendQuickPromptToAssistant()}
                />
              </View>
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

function NewAssistantModal() {
  return (
    <ModalDialog
      open={newAssistantModalOpen()}
      size="sm"
      title={tr("assistants.newModalTitle")}
      subtitle={tr("assistants.newModalSubtitle")}
      accessibilityLabel="new-assistant-modal"
      onClose={closeNewAssistantModal}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            disabled={assistantsBusy()}
            onPress={closeNewAssistantModal}
          />
          <Button
            label={assistantsBusy() ? tr("assistants.creating") : tr("assistants.createAssistant")}
            variant="primary"
            size="md"
            leadingIcon="plus"
            loading={assistantsBusy()}
            disabled={assistantsBusy()}
            accessibilityLabel="assistants-create-confirm"
            onPress={() => {
              if (!assistantsBusy()) void createAssistant();
            }}
          />
        </View>
      }
    >
      <InputBox
        label={tr("assistants.displayNameLabel")}
        hint={tr("assistants.displayNameHint")}
        value={newAssistantNameInput()}
        placeholder={tr("assistants.displayNamePlaceholder")}
        accessibilityLabel="new-assistant-name-input"
        onChange={val => newAssistantNameInput.set(val)}
        onSubmit={() => {
          if (!assistantsBusy()) void createAssistant();
        }}
      />
    </ModalDialog>
  );
}

export function AssistantsScene(props: { embedded?: boolean }) {
  assistantsEmbedded.set(Boolean(props.embedded));
  cleanup(() => assistantsEmbedded.set(false));
  // Each visit lands on the list in the compact layout, on the Persona tab.
  openAssistantGallery();
  studioTab.set("persona");
  let initialMount = true;
  let lastDevice = untracked(() => deviceContext());
  effect(() => {
    // A new device context (the Library's scope chip) reads that device's assistants.
    const device = deviceContext();
    const force = initialMount || device !== lastDevice;
    lastDevice = device;
    initialMount = false;
    untracked(() => {
      studioMenuOpen.set(false);
      syncAssistantsScope(force);
    });
  });

  effect(() => {
    const id = selectedAssistantId() ?? "";
    const rootPath = selectedAssistantRoot();
    const fileName = activePersonaFile();
    void personaReloadToken();
    if (!id) return;
    untracked(() => {
      const assistant = selectedAssistant();
      if (assistant && assistant.id === id && assistant.rootPath === rootPath) {
        void loadPersonaFile(assistant, fileName);
      }
    });
  });

  // The Sessions tab reads the selected assistant's own sessions whenever it is shown.
  effect(() => {
    const id = selectedAssistantId() ?? "";
    const tab = studioTab();
    if (!id || tab !== "sessions") return;
    untracked(() => {
      const assistant = selectedAssistant();
      if (assistant && assistant.id === id) void loadAssistantSessions(assistant);
    });
  });

  return (
    <View
      onLayout={trackStudioWidth}
      style={{ flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: palette().canvas }}
    >
      {/* Regular: list rail beside the studio. Compact: the list is the landing, the studio replaces it. */}
      <If when={!listDetailFlow() || !compactDetailOpen() || !selectedAssistant()}>
        <If when={assistantsEmbedded()} else={<CompanionsRail />}>
          <AssistantLibraryList />
        </If>
      </If>
      <If when={!listDetailFlow() || (compactDetailOpen() && Boolean(selectedAssistant()))}>
        <PersonaStudioPane />
      </If>
      <NewAssistantModal />
    </View>
  );
}
