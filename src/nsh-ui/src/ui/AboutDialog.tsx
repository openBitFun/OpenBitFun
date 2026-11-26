// About OpenBitFun: the canonical fine-line hexagonal brand mark, installed
// version, and a unified inset group for software updates (when supported),
// release notes, open-source licenses, and expandable build/platform details.

import { cleanup, Clipboard, openUrl, signal, Text, View } from "nsh";
import { controllerAppVersion, invokeCommand } from "../bridge";
import { localizeHostError, tr } from "../i18n";
import {
  compactLayout,
  hasBundledUiFonts,
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
import { Icon, type IconName } from "./icons";
import { BrandSpinner, MOTION_DURATION, pressTransition, tactileActiveStyle } from "./motion";
import { ModalDialog, pushToast } from "./overlays";
import { Button, SkeletonBlock, focusRingStyle } from "./primitives";
import { InsetGroup, InsetRow, OpenBitFunLogoMark } from "./studio";

export const GITHUB_REPOSITORY_URL = "https://github.com/GCWing/OpenBitFun";
const RELEASE_NOTES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
const LICENSES_URL = `${GITHUB_REPOSITORY_URL}/blob/main/LICENSE`;

const MARK_SIZE = 68;
const COPY_FEEDBACK_MS = 1800;

/** The shell's update phases (the desktop's update menu: check, download, install). */
export type AboutUpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";

/** What the shell hands the About dialog about updates. Every value is the shell's. */
export interface AboutUpdateSource {
  /** Whether this window installs updates itself (a native NSH window does not). */
  supported: () => boolean;
  phase: () => AboutUpdatePhase;
  /** The version an update is available or ready for. */
  version: () => string;
  /** The download's progress, when the host reports one. */
  percent?: () => number | null;
  /** Whether the last check found nothing newer (unknown before a check). */
  upToDate?: () => boolean;
  /** Whether the last attempt failed. */
  failed?: () => boolean;
  check: () => void;
  download: () => void;
  restart: () => void;
}

const updateSource = signal<AboutUpdateSource | null>(null);

/** Called once by the shell so the dialog shows and drives its update state. */
export function installAboutUpdates(source: AboutUpdateSource | null): void {
  updateSource.set(source);
}

interface AboutFacts {
  version: string;
  platform: string;
  shortPlatform: string;
}

export const aboutOpen = signal(false);
const aboutFacts = signal<AboutFacts | null>(null);
const aboutLoading = signal(false);
const aboutError = signal("");
const detailsOpen = signal(false);
const copiedRecently = signal(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function clearCopiedTimer(): void {
  if (copiedTimer !== null) {
    clearTimeout(copiedTimer);
    copiedTimer = null;
  }
}

function formatAboutError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("development host has no fixture") ||
    lower.includes("not implemented") ||
    lower.includes("unknown command")
  ) {
    return tr("error.unsupported");
  }
  return tr("shell.about.readFailed", { error: localizeHostError(raw) });
}

function formatPlatformName(raw?: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "macos" || lower === "darwin") return "macOS";
  if (lower === "windows" || lower === "win32") return "Windows";
  if (lower === "linux") return "Linux";
  return raw;
}

async function loadAboutFacts(): Promise<void> {
  aboutError.set("");
  aboutLoading.set(true);
  try {
    const [nativeVersion, system] = await Promise.all([
      controllerAppVersion(),
      invokeCommand<{ platform?: string; arch?: string; osVersion?: string; os_version?: string }>(
        "get_system_info",
        {},
      ).catch(() => null),
    ]);
    const version = nativeVersion ?? (await invokeCommand<string>("get_app_version", {}));
    const os = system?.osVersion ?? system?.os_version ?? "";
    const shortPlatform = [formatPlatformName(system?.platform), system?.arch].filter(Boolean).join(" · ");
    aboutFacts.set({
      version: typeof version === "string" ? version : "",
      platform: os ? `${shortPlatform} (${os})` : shortPlatform,
      shortPlatform,
    });
  } catch (error) {
    aboutFacts.set(null);
    aboutError.set(error instanceof Error ? error.message : String(error));
  } finally {
    aboutLoading.set(false);
  }
}

export function openAboutDialog(): void {
  detailsOpen.set(false);
  copiedRecently.set(false);
  clearCopiedTimer();
  aboutOpen.set(true);
  void loadAboutFacts();
}

/** The version and platform as one copyable block (only what the host reported). */
function versionInfo(): string {
  const facts = aboutFacts();
  return [
    facts?.version ? `${tr("product.name")} ${facts.version}` : tr("product.name"),
    facts?.platform ? `${tr("shell.about.platform")}: ${facts.platform}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function copyVersionInfo(): void {
  void Clipboard.writeText(versionInfo()).then(
    () => {
      copiedRecently.set(true);
      clearCopiedTimer();
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copiedRecently.set(false);
      }, COPY_FEEDBACK_MS);
      pushToast(tr("shell.about.copied"), "success");
    },
    () => undefined,
  );
}

function openLink(url: string): void {
  void openUrl(url).catch(() => pushToast(tr("shell.about.openFailed"), "error"));
}

interface UpdateRowModel {
  text: string;
  busy: boolean;
  icon: IconName;
  iconTone: "muted" | "accent" | "success" | "danger";
  action: { label: string; run: () => void; id: string; primary?: boolean } | null;
}

/** The update status row model, driven by the host shell's update state. */
function statusRow(): UpdateRowModel {
  const source = updateSource();
  if (!source || !source.supported()) {
    return { text: tr("shell.updates.unsupported"), busy: false, icon: "refresh", iconTone: "muted", action: null };
  }
  const hasFailed = Boolean(source.failed?.());
  const failed = hasFailed ? tr("update.failed") : "";
  switch (source.phase()) {
    case "checking":
      return { text: tr("update.checking"), busy: true, icon: "refresh", iconTone: "accent", action: null };
    case "available":
      return {
        text: failed || tr("update.available", { version: source.version() }),
        busy: false,
        icon: "download",
        iconTone: hasFailed ? "danger" : "accent",
        action: { label: tr("update.download"), run: source.download, id: "about-update-download", primary: true },
      };
    case "downloading": {
      const percent = source.percent?.() ?? null;
      return {
        text: percent === null ? tr("update.downloadingStarted") : tr("update.downloading", { percent }),
        busy: true,
        icon: "download",
        iconTone: "accent",
        action: null,
      };
    }
    case "ready":
      return {
        text: failed || tr("update.available", { version: source.version() }),
        busy: false,
        icon: "download",
        iconTone: hasFailed ? "danger" : "accent",
        action: { label: tr("update.restart"), run: source.restart, id: "about-update-restart", primary: true },
      };
    case "installing":
      return { text: tr("update.restart"), busy: true, icon: "refresh", iconTone: "accent", action: null };
    default: {
      const upToDate = Boolean(source.upToDate?.());
      return {
        text: failed || (upToDate ? tr("update.upToDate") : tr("update.label")),
        busy: false,
        icon: upToDate && !hasFailed ? "check-circle" : "refresh",
        iconTone: hasFailed ? "danger" : upToDate ? "success" : "muted",
        action: { label: tr("update.check"), run: source.check, id: "about-update-check" },
      };
    }
  }
}

function updateIconColor(tone: UpdateRowModel["iconTone"]): string {
  if (tone === "accent") return palette().accent;
  if (tone === "success") return palette().success;
  if (tone === "danger") return palette().danger;
  return palette().textMuted;
}

export function AboutDialog() {
  cleanup(clearCopiedTimer);
  const closeDialog = () => aboutOpen.set(false);
  const updatesSupported = () => Boolean(updateSource()?.supported());
  const row = () => statusRow();

  return (
    <ModalDialog
      open={aboutOpen()}
      size="sm"
      accessibilityLabel={tr("shell.about.title")}
      onClose={closeDialog}
    >
      <View
        style={{
          position: "relative",
          width: "100%",
          maxWidth: layout.modalConfirmWidth,
          alignSelf: "center",
        }}
      >
        {/* Quiet floating dismiss control so the hero stays optically centered without a heavy footer bar. */}
        <View
          role="button"
          hitSlop={touchSlop(28)}
          tooltip={tr("common.close")}
          accessibilityLabel="about-close"
          onPress={closeDialog}
          style={{
            position: "absolute",
            top: -space.xs,
            right: -space.sm,
            zIndex: 2,
            width: 28,
            height: 28,
            borderRadius: radii.pill,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
            ...pressTransition(MOTION_DURATION.fast),
          }}
          hoverStyle={{ backgroundColor: palette().buttonSecondaryHover }}
          activeStyle={tactileActiveStyle(0.94, { backgroundColor: palette().buttonSecondaryPressed })}
          focusVisibleStyle={focusRingStyle()}
        >
          <Icon name="close" size={14} color={palette().textMuted} />
        </View>

        {/* Hero identity */}
        <View style={{ alignItems: "center", paddingTop: compactLayout() ? space.sm : space.md }}>
          <OpenBitFunLogoMark size={MARK_SIZE} color={palette().text} accessibilityLabel={tr("product.name")} />
          <Text
            style={{
              marginTop: space.md,
              color: palette().text,
              fontSize: textSize(20),
              fontWeight: "600",
              letterSpacing: textTracking(20),
              lineHeight: textLineHeight(20, 1.25),
              textAlign: "center",
            }}
          >
            {tr("product.name")}
          </Text>
          <If
            when={aboutLoading() && !aboutFacts()}
            else={
              <Text
                style={{
                  ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                  marginTop: space.xs,
                  textAlign: "center",
                  userSelect: "text",
                }}
              >
                {aboutFacts()?.version
                  ? tr("about.version", { version: aboutFacts()!.version })
                  : tr("shell.about.notAvailable")}
              </Text>
            }
          >
            <SkeletonBlock width={72} height={16} style={{ marginTop: space.xs, borderRadius: radii.xs }} />
          </If>
          <Text
            style={{
              ...textStyle("label", { color: palette().textSecondary }),
              fontWeight: "400",
              marginTop: space.md,
              textAlign: "center",
            }}
          >
            {tr("about.tagline")}
          </Text>
        </View>

        <If when={aboutError()}>
          {message => (
            <Text style={{ ...textStyle("caption", { color: palette().danger }), marginTop: space.md, textAlign: "center" }}>
              {formatAboutError(message())}
            </Text>
          )}
        </If>

        {/* Unified grouped rows: Updates (only when the host supports them), Release Notes, Licenses, and Details. */}
        <InsetGroup style={{ marginTop: space.xl }}>
          <If when={updatesSupported()}>
            <View
              accessibilityLabel="about-update"
              style={{
                minHeight: 44,
                paddingLeft: space.lg,
                paddingRight: space.md,
                paddingVertical: space.sm,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <View style={{ width: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <If
                  when={row().busy}
                  else={<Icon name={row().icon} size={16} color={updateIconColor(row().iconTone)} />}
                >
                  <BrandSpinner variant="matrix" size={14} color={palette().accent} />
                </If>
              </View>
              <Text
                style={{
                  ...textStyle("body"),
                  flex: 1,
                  minWidth: 0,
                  numberOfLines: 2,
                }}
              >
                {row().text}
              </Text>
              <If when={row().action}>
                {action => (
                  <Button
                    label={action().label}
                    variant={action().primary ? "primary" : "secondary"}
                    size="xs"
                    accessibilityLabel={action().id}
                    onPress={() => action().run()}
                  />
                )}
              </If>
            </View>
          </If>

          <InsetRow
            first={!updatesSupported()}
            icon="file-text"
            label={tr("about.releaseNotes")}
            accessibilityLabel="about-release-notes"
            trailing={<Icon name="external-link" size={13} color={palette().textMuted} />}
            onPress={() => openLink(RELEASE_NOTES_URL)}
          />

          <InsetRow
            icon="shield"
            label={tr("about.licenses")}
            accessibilityLabel="about-licenses"
            trailing={<Icon name="external-link" size={13} color={palette().textMuted} />}
            onPress={() => openLink(LICENSES_URL)}
          />

          <InsetRow
            icon="info"
            label={tr("about.details")}
            accessibilityLabel="about-details"
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <If when={!detailsOpen() && (aboutFacts()?.shortPlatform ?? "") ? aboutFacts()!.shortPlatform : ""}>
                  {platform => (
                    <Text
                      style={{
                        ...textStyle("caption", { color: palette().textMuted, tabular: true }),
                        numberOfLines: 1,
                      }}
                    >
                      {platform()}
                    </Text>
                  )}
                </If>
                <Icon
                  name={detailsOpen() ? "chevron-up" : "chevron-down"}
                  size={13}
                  color={palette().textMuted}
                />
              </View>
            }
            onPress={() => detailsOpen.update(open => !open)}
          />

          <If when={detailsOpen() ? versionInfo() : ""}>
            {info => (
              <View
                accessibilityLabel="about-details-well"
                style={{
                  position: "relative",
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  backgroundColor: palette().canvasSubtle,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: space.sm,
                }}
              >
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: space.lg,
                    right: 0,
                    height: 1,
                    backgroundColor: palette().borderSubtle,
                    pointerEvents: "none",
                  }}
                />
                <Text
                  style={{
                    ...textStyle("mono", { color: palette().textSecondary }),
                    flex: 1,
                    minWidth: 0,
                    userSelect: "text",
                  }}
                >
                  {info()}
                </Text>
                <View
                  role="button"
                  hitSlop={touchSlop(24)}
                  tooltip={tr("about.copy")}
                  accessibilityLabel="about-details-copy"
                  onPress={copyVersionInfo}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: radii.sm,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: "pointer",
                    userSelect: "none",
                    ...pressTransition(MOTION_DURATION.fast),
                  }}
                  hoverStyle={{ backgroundColor: palette().panelHover }}
                  activeStyle={tactileActiveStyle(0.94)}
                  focusVisibleStyle={focusRingStyle()}
                >
                  <Icon
                    name={copiedRecently() ? "check" : "copy"}
                    size={12}
                    color={copiedRecently() ? palette().success : palette().textMuted}
                  />
                </View>
              </View>
            )}
          </If>
        </InsetGroup>

        {/* Subtle legal colophon at the bottom */}
        <If when={hasBundledUiFonts()}>
          <Text
            style={{
              ...textStyle("micro", { color: palette().textMuted }),
              marginTop: space.lg,
              textAlign: "center",
              opacity: 0.78,
            }}
          >
            {tr("about.harmonyFonts")}
          </Text>
        </If>
      </View>
    </ModalDialog>
  );
}
