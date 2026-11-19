import { effect, Scroll, signal, Text, untracked, View, type ViewRef } from "nsh";
import { Input, TextView } from "nsh/base";
import {
  PERSONA_FILES,
  activePersonaFile,
  assistantQuickPrompt,
  assistantQuickSending,
  assistants,
  assistantsBusy,
  assistantsError,
  assistantsLoading,
  assistantsNotice,
  cancelAssistantConfirm,
  chatWithAssistant,
  closeNewAssistantModal,
  confirmingAssistantAction,
  confirmingPersonaReset,
  createAssistant,
  executeAssistantConfirm,
  joinPersonaFilePath,
  loadAssistants,
  loadPersonaFile,
  newAssistantModalOpen,
  newAssistantNameInput,
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
  selectAssistant,
  selectPersonaFile,
  selectedAssistant,
  selectedAssistantId,
  selectedAssistantRoot,
  sendQuickPromptToAssistant,
  setPersonaDraftText,
  setPrimaryAssistant,
  syncAssistantsScope,
  togglePersonaPreview,
  type AssistantWorkspaceView,
  type PersonaFileName,
} from "../assistantStore";
import { formatCount, formatPlural } from "../format";
import { localizeHostError, tr } from "../i18n";
import { peerScope } from "../peerState";
import {
  fontMono,
  palette,
  radii,
  textLineHeight,
  textSize,
  textTracking,
} from "../theme";
import { BotCharacter, Icon, type BotVariant } from "../ui/icons";
import {
  STATIC_MARKDOWN_OPTIONS,
  createMarkdownCodeActions,
  createMarkdownStyles,
} from "../ui/markdown";
import { MOTION_DURATION, animateLayout, paintTransition } from "../ui/motion";
import { DropdownMenu, ModalDialog, type DropdownMenuItem } from "../ui/overlays";
import {
  Badge,
  Button,
  EmptyStateCard,
  IconButton,
  InlineBanner,
  InlineConfirmBar,
  InputBox,
  SegmentedTabs,
  StatusDot,
  StatusPill,
  ToggleSwitch,
} from "../ui/primitives";

const PERSONA_TAB_OPTIONS: ReadonlyArray<{
  value: PersonaFileName;
  label: string;
  accessibilityLabel: string;
}> = PERSONA_FILES.map(file => ({
  value: file,
  label: file,
  accessibilityLabel: `persona-tab-${file}`,
}));

const ASSISTANT_VARIANTS: readonly BotVariant[] = ["muse", "violet", "mint", "amber", "grok"];

function hashVariantIndex(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % ASSISTANT_VARIANTS.length;
}

function assistantBotVariant(id: string): BotVariant {
  const list = assistants();
  const idx = list.findIndex(item => item.id === id);
  if (idx >= 0) {
    return ASSISTANT_VARIANTS[idx % ASSISTANT_VARIANTS.length];
  }
  return ASSISTANT_VARIANTS[hashVariantIndex(id)];
}

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

function CompanionGalleryRow(props: { item: AssistantWorkspaceView }) {
  const isSelected = () => selectedAssistantId() === props.item.id;
  const isPrimary = () => primaryAssistantId() === props.item.id;

  return (
    <View
      role="button"
      accessibilityLabel={`assistant-card-${props.item.id}`}
      accessibilityState={{ selected: isSelected() }}
      onPress={() => {
        studioMenuOpen.set(false);
        selectAssistant(props.item.id);
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 9,
        borderRadius: radii.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: isSelected() ? palette().border : "transparent",
        backgroundColor: isSelected() ? palette().panelRaised : "transparent",
        boxShadow: isSelected()
          ? `${palette().shadowButton}, ${palette().innerHighlight}`
          : undefined,
        cursor: "pointer",
        ...paintTransition(MOTION_DURATION.fast),
      }}
      hoverStyle={{
        backgroundColor: isSelected() ? palette().panelRaised : palette().panelHover,
        borderColor: isSelected() ? palette().borderStrong : palette().borderSubtle,
      }}
      activeStyle={{
        backgroundColor: palette().panelHover,
      }}
      focusVisibleStyle={{
        outlineWidth: 2,
        outlineColor: palette().borderFocus,
        outlineOffset: -2,
      }}
    >
      <View style={{ flexShrink: 0 }}>
        <BotCharacter
          variant={assistantBotVariant(props.item.id)}
          seed={props.item.id}
          size={34}
          ringColor={isSelected() ? palette().panelRaised : palette().canvasSubtle}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: 6 }}>
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(13),
              fontWeight: isSelected() ? "600" : "500",
              lineHeight: textLineHeight(13, 1.32),
              numberOfLines: 1,
              textOverflow: "ellipsis",
            }}
          >
            {props.item.name}
          </Text>
          <If when={isPrimary()}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexShrink: 0,
                gap: 4,
                paddingHorizontal: 6,
                paddingVertical: 1.5,
                borderRadius: radii.xs,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().accentBorder,
                backgroundColor: palette().accentSoft,
              }}
            >
              <StatusDot
                kind="accent"
                size={5}
                accessibilityLabel={`assistant-primary-dot-${props.item.id}`}
              />
              <Text
                style={{
                  color: palette().accent,
                  fontSize: textSize(10),
                  lineHeight: textLineHeight(10, 1.25),
                  fontWeight: "600",
                }}
              >
                {tr("common.primary")}
              </Text>
            </View>
          </If>
        </View>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(11.5),
            lineHeight: textLineHeight(11.5, 1.36),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.item.identity.vibe ||
            props.item.description ||
            props.item.identity.creature ||
            tr("assistants.personalCompanion")}
        </Text>
      </View>
    </View>
  );
}

function CompanionsRail() {
  return (
    <View
      style={{
        width: 252,
        minWidth: 216,
        maxWidth: 276,
        flexShrink: 0,
        minHeight: 0,
        borderRightWidth: 1,
        borderColor: palette().borderSubtle,
        backgroundColor: palette().canvasSubtle,
      }}
    >
      <View
        style={{
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: palette().text,
                fontSize: textSize(15),
                fontWeight: "600",
                letterSpacing: textTracking(15),
                lineHeight: textLineHeight(15, 1.28),
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {tr("assistants.title")}
            </Text>
            <Badge label={formatCount(assistants().length)} tone="neutral" />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6 }}>
            <IconButton
              icon="refresh"
              size="sm"
              tooltip={tr("assistants.refreshTooltip")}
              disabled={assistantsLoading()}
              accessibilityLabel="assistants-refresh"
              onPress={() => void loadAssistants()}
            />
            <Button
              label={tr("assistants.new")}
              variant="primary"
              size="sm"
              leadingIcon="plus"
              disabled={assistantsBusy()}
              accessibilityLabel="assistants-new"
              onPress={openNewAssistantModal}
            />
          </View>
        </View>

        <If when={peerScope()}>
          {scope => (
            <InlineBanner
              tone="info"
              icon="laptop"
              message={tr("assistants.peerLabel", { label: scope().label })}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            />
          )}
        </If>

        <If when={assistantsNotice()}>
          {notice => (
            <InlineBanner
              tone="success"
              message={notice()}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            />
          )}
        </If>
        <If when={assistantsError()}>
          {err => (
            <InlineBanner
              tone="danger"
              message={localizeHostError(err())}
              style={{ paddingHorizontal: 10, paddingVertical: 6 }}
            />
          )}
        </If>
      </View>

      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View style={{ padding: 10, gap: 4 }}>
          <If when={!assistantsLoading() && assistants().length === 0}>
            <EmptyStateCard
              icon="bot"
              title={
                assistantsError()
                  ? tr("assistants.unavailableTitle")
                  : tr("assistants.noneYetTitle")
              }
              subtitle={
                assistantsError()
                  ? localizeHostError(assistantsError())
                  : tr("assistants.noneYetSubtitle")
              }
              actionLabel={
                assistantsError() ? tr("common.retry") : tr("assistants.newAssistant")
              }
              onAction={() => {
                if (assistantsError()) void loadAssistants();
                else openNewAssistantModal();
              }}
            />
          </If>

          <Each of={assistants()} key={item => item.id}>
            {item => <CompanionGalleryRow item={item()} />}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}

function PersonaStudioPane() {
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: palette().canvas }}>
      <If
        when={selectedAssistant()}
        else={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <EmptyStateCard
              icon="sparkles"
              title={tr("assistants.emptyTitle")}
              subtitle={tr("assistants.emptySubtitle")}
              actionLabel={tr("assistants.newAssistant")}
              onAction={openNewAssistantModal}
            />
          </View>
        }
      >
        {assistant => (
          <View style={{ flex: 1, minHeight: 0 }}>
            {/* Spotlight Companion Header (rail-aligned to 740px editorial column) */}
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().canvas,
                alignItems: "center",
              }}
            >
              <View style={{ width: "100%", maxWidth: 740, alignSelf: "center", gap: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={{ flexShrink: 0 }}>
                    <BotCharacter
                      variant={assistantBotVariant(assistant().id)}
                      seed={assistant().id}
                      size={44}
                      ringColor={palette().canvas}
                    />
                  </View>

                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0, gap: 8 }}>
                      <Text
                        style={{
                          flexShrink: 1,
                          minWidth: 0,
                          color: palette().text,
                          fontSize: textSize(18),
                          fontWeight: "600",
                          letterSpacing: textTracking(18),
                          lineHeight: textLineHeight(18, 1.24),
                          numberOfLines: 1,
                          textOverflow: "ellipsis",
                        }}
                      >
                        {assistant().name}
                      </Text>
                      <If when={primaryAssistantId() === assistant().id}>
                        <Badge label={tr("common.primary")} tone="accent" />
                      </If>
                    </View>
                    <Text
                      style={{
                        color: palette().textMuted,
                        fontSize: textSize(12),
                        lineHeight: textLineHeight(12, 1.4),
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
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 8 }}>
                    <Button
                      label={tr("assistants.chat")}
                      variant="secondary"
                      size="sm"
                      leadingIcon="chat"
                      accessibilityLabel={`assistant-chat-${assistant().id}`}
                      onPress={() => chatWithAssistant(assistant())}
                    />
                    <View ref={el => studioMenuAnchor.set(el)} style={{ flexShrink: 0 }}>
                      <IconButton
                        icon="more"
                        size="sm"
                        tooltip={tr("assistants.actions")}
                        active={studioMenuOpen()}
                        accessibilityLabel={`assistant-actions-${assistant().id}`}
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
              </View>
            </View>

            {/* Aligned Persona Studio Toolbar (locked to controlHeight.sm = 28px baseline & 740px column) */}
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().canvas,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: 740,
                  alignSelf: "center",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <SegmentedTabs
                  size="sm"
                  options={PERSONA_TAB_OPTIONS}
                  value={activePersonaFile()}
                  onChange={selectPersonaFile}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flexWrap: "wrap",
                    flexShrink: 0,
                    gap: 10,
                  }}
                >
                  <ToggleSwitch
                    value={personaPreview()}
                    label={tr("common.preview")}
                    accessibilityLabel="persona-preview-toggle"
                    onChange={togglePersonaPreview}
                  />
                  <Button
                    label={tr("common.reset")}
                    variant="secondary"
                    size="sm"
                    leadingIcon="undo"
                    disabled={personaSaving()}
                    accessibilityLabel="persona-reset-files"
                    onPress={() => {
                      animateLayout();
                      confirmingPersonaReset.set(true);
                    }}
                  />
                  <Button
                    label={personaSaving() ? tr("common.saving") : tr("common.save")}
                    variant="primary"
                    size="sm"
                    leadingIcon="check"
                    loading={personaSaving()}
                    disabled={personaSaving()}
                    accessibilityLabel="persona-save"
                    onPress={() => void savePersonaFile()}
                  />
                </View>
              </View>
            </View>

            {/* Quiet File Path & Document Telemetry Strip (rail-aligned to 740px editorial column) */}
            <View
              style={{
                paddingHorizontal: 24,
                paddingVertical: 7,
                borderBottomWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().canvasSubtle,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: 740,
                  alignSelf: "center",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="file-text" size={13} color={palette().textMuted} />
                  <Text
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: palette().textMuted,
                      fontFamily: fontMono,
                      fontSize: textSize(11),
                      lineHeight: textLineHeight(11, 1.35),
                      numberOfLines: 1,
                      textOverflow: "ellipsis-middle",
                    }}
                  >
                    {joinPersonaFilePath(assistant().rootPath, activePersonaFile())}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 10 }}>
                  <Text
                    style={{
                      color: palette().textMuted,
                      fontFamily: fontMono,
                      fontSize: textSize(10.5),
                      lineHeight: textLineHeight(10.5, 1.3),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatDocumentStats(personaDraft())}
                  </Text>
                  <StatusPill
                    label={
                      personaLoading()
                        ? tr("common.loading")
                        : personaDirty()
                          ? tr("assistants.unsavedChanges")
                          : tr("common.saved")
                    }
                    kind={personaDirty() ? "warning" : personaLoading() ? "accent" : "neutral"}
                    pulse={personaLoading()}
                  />
                </View>
              </View>
            </View>

            <If when={confirmingPersonaReset()}>
              <View
                style={{
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderColor: palette().borderSubtle,
                  backgroundColor: palette().canvasSubtle,
                  alignItems: "center",
                }}
              >
                <View style={{ width: "100%", maxWidth: 740, alignSelf: "center" }}>
                  <InlineConfirmBar
                    message={tr("assistants.resetFilesConfirmMessage")}
                    confirmLabel={tr("assistants.confirmResetFiles")}
                    onCancel={() => {
                      animateLayout();
                      confirmingPersonaReset.set(false);
                    }}
                    onConfirm={() => {
                      animateLayout();
                      void resetSelectedPersonaFiles();
                    }}
                  />
                </View>
              </View>
            </If>

            <If when={personaNotice()}>
              {notice => (
                <View style={{ paddingHorizontal: 24, paddingTop: 10, alignItems: "center" }}>
                  <View style={{ width: "100%", maxWidth: 740, alignSelf: "center" }}>
                    <InlineBanner
                      tone={notice().toLowerCase().includes("does not exist") ? "info" : "success"}
                      message={notice()}
                      style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                    />
                  </View>
                </View>
              )}
            </If>
            <If when={personaError()}>
              {err => (
                <View style={{ paddingHorizontal: 24, paddingTop: 10, alignItems: "center" }}>
                  <View style={{ width: "100%", maxWidth: 740, alignSelf: "center" }}>
                    <InlineBanner
                      tone="danger"
                      message={localizeHostError(err())}
                      style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                    />
                  </View>
                </View>
              )}
            </If>

            {/* De-boxed Editor & Editorial Preview Canvas (locked to exact 740px rail) */}
            <View style={{ flex: 1, minHeight: 0, backgroundColor: palette().canvas }}>
              <If
                when={personaPreview()}
                else={
                  <View
                    style={{
                      flex: 1,
                      minHeight: 0,
                      paddingHorizontal: 24,
                      paddingVertical: 18,
                      alignItems: "center",
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        minHeight: 0,
                        width: "100%",
                        maxWidth: 740,
                        alignSelf: "center",
                      }}
                    >
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
                          fontSize: textSize(13.5),
                          lineHeight: textLineHeight(13.5, 1.62),
                        }}
                        onChange={event => setPersonaDraftText(event.value)}
                      />
                    </View>
                  </View>
                }
              >
                <Scroll
                  style={{ flex: 1, minHeight: 0 }}
                  contentStyle={{ paddingHorizontal: 24, paddingVertical: 22, alignItems: "center" }}
                >
                  <View
                    style={{
                      width: "100%",
                      maxWidth: 740,
                    }}
                  >
                    <If
                      when={personaDraft().trim()}
                      else={
                        <View style={{ alignItems: "center", paddingVertical: 36, gap: 8 }}>
                          <Icon name="file-text" size={20} color={palette().textMuted} />
                          <Text
                            style={{
                              color: palette().textMuted,
                              fontSize: textSize(12.5),
                              lineHeight: textLineHeight(12.5, 1.48),
                              textAlign: "center",
                            }}
                          >
                            {tr("assistants.emptyPreview")}
                          </Text>
                        </View>
                      }
                    >
                      {md => (
                        <TextView
                          markdown={md()}
                          selectable={true}
                          links="open"
                          options={STATIC_MARKDOWN_OPTIONS}
                          codeBlockActions={createMarkdownCodeActions()}
                          styles={createMarkdownStyles()}
                        />
                      )}
                    </If>
                  </View>
                </Scroll>
              </If>
            </View>

            {/* Elevated Floating Quick-Message Bar (matching Sessions Composer craft & 740px rail) */}
            <View
              style={{
                paddingHorizontal: 24,
                paddingTop: 6,
                paddingBottom: 16,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: 740,
                  alignSelf: "center",
                  borderRadius: radii.xl,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: palette().border,
                  backgroundColor: palette().surfaceElevated,
                  boxShadow: `${palette().shadowComposer}, ${palette().innerHighlight}`,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  ...paintTransition(MOTION_DURATION.fast),
                }}
                hoverStyle={{ borderColor: palette().borderStrong }}
                focusWithinStyle={{
                  borderColor: palette().fieldFocusBorder,
                  boxShadow: palette().shadowComposerFocus,
                }}
              >
                <Icon name="chat" size={15} color={palette().textMuted} />
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
                    fontSize: textSize(13.5),
                    lineHeight: textLineHeight(13.5, 1.45),
                  }}
                  onChange={event => assistantQuickPrompt.set(event.value)}
                  onSubmit={() => void sendQuickPromptToAssistant()}
                />
                <Button
                  label={assistantQuickSending() ? tr("common.sending") : tr("common.send")}
                  variant="primary"
                  size="sm"
                  pill={true}
                  leadingIcon="arrow-up"
                  loading={assistantQuickSending()}
                  disabled={assistantQuickSending() || !assistantQuickPrompt().trim()}
                  accessibilityLabel="assistant-quick-send"
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
            accessibilityLabel="assistants-create-confirm"
            onPress={() => void createAssistant()}
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
        onSubmit={() => void createAssistant()}
      />
    </ModalDialog>
  );
}

export function AssistantsScene() {
  let initialMount = true;
  effect(() => {
    const peerId = peerScope()?.deviceId ?? null;
    const force = initialMount;
    initialMount = false;
    untracked(() => {
      studioMenuOpen.set(false);
      syncAssistantsScope(peerId, force);
    });
  });

  effect(() => {
    const id = selectedAssistantId() ?? "";
    const rootPath = selectedAssistantRoot();
    const fileName = activePersonaFile();
    const reloadTick = personaReloadToken();
    const peerId = peerScope()?.deviceId ?? null;
    void reloadTick;
    void peerId;
    if (!id) return;
    untracked(() => {
      const assistant = selectedAssistant();
      if (assistant && assistant.id === id && assistant.rootPath === rootPath) {
        void loadPersonaFile(assistant, fileName);
      }
    });
  });

  return (
    <View style={{ flex: 1, minHeight: 0, flexDirection: "row", backgroundColor: palette().canvas }}>
      <CompanionsRail />
      <PersonaStudioPane />
      <NewAssistantModal />
    </View>
  );
}
