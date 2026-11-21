// About OpenBitFun (visual spec §4.11): the mark, the installed version, one
// status row for updates, and the links. The version and platform are read from
// the host that runs the window; this frontend embeds no commit or branch, so
// Details lists only what the host reports. The update state is the shell's
// (`App.tsx` owns the update commands): it hands it over with
// `installAboutUpdates`, and without one the row says updates come from the
// desktop app instead of failing.

import { Clipboard, openUrl, signal, Text, View } from "nsh";
import { controllerAppVersion, invokeCommand } from "../bridge";
import { tr } from "../i18n";
import { controlHeight, layout, palette, radii, space, textStyle } from "../theme";
import { Icon } from "./icons";
import { ModalDialog, pushToast } from "./overlays";
import { Button } from "./primitives";
import { BitMatrixMark } from "./SignInView";
import { InsetGroup } from "./studio";
import { paintTransition } from "./motion";

export const GITHUB_REPOSITORY_URL = "https://github.com/GCWing/OpenBitFun";
const RELEASE_NOTES_URL = `${GITHUB_REPOSITORY_URL}/releases`;
const LICENSES_URL = `${GITHUB_REPOSITORY_URL}/blob/main/LICENSE`;

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
}

export const aboutOpen = signal(false);
const aboutFacts = signal<AboutFacts | null>(null);
const aboutError = signal("");
const detailsOpen = signal(false);

async function loadAboutFacts(): Promise<void> {
  aboutError.set("");
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
    const platform = [system?.platform, system?.arch].filter(Boolean).join(" · ");
    aboutFacts.set({
      version: typeof version === "string" ? version : "",
      platform: os ? `${platform} (${os})` : platform,
    });
  } catch (error) {
    aboutFacts.set(null);
    aboutError.set(error instanceof Error ? error.message : String(error));
  }
}

export function openAboutDialog(): void {
  detailsOpen.set(false);
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
    () => pushToast(tr("shell.about.copied"), "success"),
    () => undefined,
  );
}

function openLink(url: string): void {
  void openUrl(url).catch(() => pushToast(tr("shell.about.openFailed"), "error"));
}

/** The left words and the right action of the status row, by update phase. */
function statusRow(): { text: string; action: { label: string; run: () => void; id: string } | null } {
  const source = updateSource();
  if (!source || !source.supported()) {
    return { text: tr("shell.updates.unsupported"), action: null };
  }
  const failed = source.failed?.() ? tr("update.failed") : "";
  switch (source.phase()) {
    case "checking":
      return { text: tr("update.checking"), action: null };
    case "available":
      return {
        text: failed || tr("update.available", { version: source.version() }),
        action: { label: tr("update.download"), run: source.download, id: "about-update-download" },
      };
    case "downloading": {
      const percent = source.percent?.() ?? null;
      return {
        text: percent === null ? tr("update.downloadingStarted") : tr("update.downloading", { percent }),
        action: null,
      };
    }
    case "ready":
      return {
        text: failed || tr("update.available", { version: source.version() }),
        action: { label: tr("update.restart"), run: source.restart, id: "about-update-restart" },
      };
    case "installing":
      return { text: tr("update.restart"), action: null };
    default:
      return {
        text: failed || (source.upToDate?.() ? tr("update.upToDate") : ""),
        action: { label: tr("update.check"), run: source.check, id: "about-update-check" },
      };
  }
}

function StatusRow() {
  return (
    <InsetGroup accessibilityLabel="about-update">
      <View
        style={{
          minHeight: STATUS_ROW_HEIGHT,
          paddingHorizontal: space.lg,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
        }}
      >
        <Text
          style={{
            ...textStyle("body"),
            flex: 1,
            minWidth: 0,
            numberOfLines: 2,
          }}
        >
          {statusRow().text}
        </Text>
        <If when={statusRow().action}>
          {action => (
            <Button
              label={action().label}
              variant={action().id === "about-update-restart" ? "primary" : "secondary"}
              size="sm"
              accessibilityLabel={action().id}
              onPress={() => action().run()}
            />
          )}
        </If>
      </View>
    </InsetGroup>
  );
}

/** The status row is an `InsetRow` of 48 (visual spec §4.11). */
const STATUS_ROW_HEIGHT = space.x5l;

function LinkText(props: { label: string; accessibilityLabel: string; onPress: () => void; trailing?: "chevron-down" | "chevron-up" }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      style={{
        minHeight: controlHeight.xs,
        paddingHorizontal: space.xs,
        borderRadius: radii.sm,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        cursor: "pointer",
        ...paintTransition(),
      }}
      hoverStyle={{ backgroundColor: palette().panelHover }}
    >
      <Text style={textStyle("label", { color: palette().textSecondary })}>{props.label}</Text>
      <If when={props.trailing ?? ""}>
        {icon => <Icon name={icon() as "chevron-down"} size={space.md} color={palette().textMuted} />}
      </If>
    </View>
  );
}

function Dot() {
  return <Text style={textStyle("label", { color: palette().textMuted })}>·</Text>;
}

export function AboutDialog() {
  return (
    <ModalDialog
      open={aboutOpen()}
      size="sm"
      accessibilityLabel={tr("shell.about.title")}
      onClose={() => aboutOpen.set(false)}
      footer={
        <Button
          label={tr("common.close")}
          variant="secondary"
          size="md"
          accessibilityLabel="about-close"
          onPress={() => aboutOpen.set(false)}
        />
      }
    >
      <View style={{ width: "100%", maxWidth: layout.modalConfirmWidth, alignSelf: "center" }}>
        <View style={{ alignItems: "center" }}>
          <BitMatrixMark size={MARK_SIZE} />
          <Text style={{ ...textStyle("modalTitle"), marginTop: space.md, textAlign: "center" }}>
            {tr("product.name")}
          </Text>
          <Text
            style={{
              ...textStyle("label", { color: palette().textSecondary }),
              fontWeight: "400",
              marginTop: space.xs,
              textAlign: "center",
            }}
          >
            {aboutFacts()?.version ? tr("about.version", { version: aboutFacts()!.version }) : tr("shell.about.notAvailable")}
          </Text>
          <Text
            style={{
              ...textStyle("label", { color: palette().textMuted }),
              fontWeight: "400",
              marginTop: space.sm,
              textAlign: "center",
            }}
          >
            {tr("about.tagline")}
          </Text>
        </View>

        <If when={aboutError()}>
          {message => (
            <Text style={{ ...textStyle("caption", { color: palette().danger }), marginTop: space.md, textAlign: "center" }}>
              {tr("shell.about.readFailed", { error: message() })}
            </Text>
          )}
        </If>

        <View style={{ marginTop: space.xxl }}>
          <StatusRow />
        </View>

        <View
          style={{
            marginTop: space.lg,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: space.xs,
          }}
        >
          <LinkText label={tr("about.releaseNotes")} accessibilityLabel="about-release-notes" onPress={() => openLink(RELEASE_NOTES_URL)} />
          <Dot />
          <LinkText label={tr("about.licenses")} accessibilityLabel="about-licenses" onPress={() => openLink(LICENSES_URL)} />
          <Dot />
          <LinkText
            label={tr("about.details")}
            accessibilityLabel="about-details"
            trailing={detailsOpen() ? "chevron-up" : "chevron-down"}
            onPress={() => detailsOpen.update(open => !open)}
          />
        </View>
        {/* The 400 modal fits three links on a line; Copy sits under them rather than wrapping after a dot. */}
        <View style={{ marginTop: space.xs, flexDirection: "row", justifyContent: "center" }}>
          <LinkText label={tr("about.copy")} accessibilityLabel="about-copy" onPress={copyVersionInfo} />
        </View>

        <If when={detailsOpen() ? versionInfo() : ""}>
          {info => (
            <View
              accessibilityLabel="about-details-well"
              style={{
                marginTop: space.md,
                padding: space.md,
                borderRadius: radii.sm,
                backgroundColor: palette().surfaceTertiary,
              }}
            >
              <Text style={textStyle("mono")}>{info()}</Text>
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

const MARK_SIZE = 40;
