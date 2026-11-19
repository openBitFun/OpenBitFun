// About OpenBitFun: what the desktop's own About dialog shows (product, version,
// platform, license, the source repository), read from the host that runs the
// window. `get_app_version` is the installed build; this frontend embeds no
// commit or branch metadata, so those rows say so instead of inventing values.

import { Clipboard, openUrl, signal, Text, View } from "nsh";
import { controllerAppVersion, invokeCommand, windowPlatform } from "../bridge";
import { peerScope } from "../peerState";
import { tr } from "../i18n";
import { fontMono, palette, radii, textLineHeight, textSize } from "../theme";
import { Icon } from "./icons";
import { ModalDialog, pushToast } from "./overlays";
import { Button, IconButton } from "./primitives";

export const GITHUB_REPOSITORY_URL = "https://github.com/GCWing/OpenBitFun";

interface AboutFacts {
  version: string;
  platform: string;
}

export const aboutOpen = signal(false);
const aboutFacts = signal<AboutFacts | null>(null);
const aboutError = signal("");

async function loadAboutFacts(): Promise<void> {
  aboutError.set("");
  try {
    // Both host reads are proxied while a peer is driven; About describes this window.
    const local = !peerScope();
    const [nativeVersion, system] = await Promise.all([
      controllerAppVersion(),
      local
        ? invokeCommand<{ platform?: string; arch?: string; osVersion?: string; os_version?: string }>(
            "get_system_info",
            {},
          ).catch(() => null)
        : Promise.resolve({ platform: windowPlatform() } as {
            platform?: string;
            arch?: string;
            osVersion?: string;
            os_version?: string;
          }),
    ]);
    const version =
      nativeVersion ?? (local ? await invokeCommand<string>("get_app_version", {}) : "");
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
  aboutOpen.set(true);
  void loadAboutFacts();
}

function AboutRow(props: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
  return (
    <View
      style={{
        minHeight: 34,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderBottomWidth: 1,
        borderColor: palette().borderSubtle,
      }}
    >
      <Text
        style={{
          width: 96,
          flexShrink: 0,
          color: palette().textMuted,
          fontSize: textSize(12),
          lineHeight: textLineHeight(12, 1.3),
        }}
      >
        {props.label}
      </Text>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: palette().text,
          fontFamily: props.mono ? fontMono : undefined,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.3),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {props.value}
      </Text>
      <If when={props.copyable && props.value !== tr("shell.about.notAvailable")}>
        <IconButton
          icon="copy"
          size="xs"
          accessibilityLabel={`about-copy-${props.label}`}
          tooltip={tr("shell.about.copy")}
          onPress={() => {
            void Clipboard.writeText(props.value).then(
              () => pushToast(tr("shell.about.copied"), "success"),
              () => undefined,
            );
          }}
        />
      </If>
    </View>
  );
}

export function AboutDialog() {
  const dash = () => tr("shell.about.notAvailable");
  return (
    <ModalDialog
      open={aboutOpen()}
      title={tr("shell.about.title")}
      size="sm"
      accessibilityLabel="about-dialog"
      onClose={() => aboutOpen.set(false)}
      footer={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button
            label={tr("shell.about.openGithub")}
            variant="secondary"
            size="sm"
            leadingIcon="star"
            accessibilityLabel="about-github"
            onPress={() => {
              void openUrl(GITHUB_REPOSITORY_URL).catch(() =>
                pushToast(tr("shell.about.openFailed"), "error"),
              );
            }}
          />
          <Button
            label={tr("common.close")}
            variant="primary"
            size="sm"
            onPress={() => aboutOpen.set(false)}
          />
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radii.lg,
              borderCurve: "continuous",
              backgroundColor: palette().accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="sparkles" size={22} color={palette().accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text
              style={{
                color: palette().text,
                fontSize: textSize(15),
                lineHeight: textLineHeight(15, 1.3),
                fontWeight: "600",
              }}
            >
              {tr("product.name")}
            </Text>
            <Text
              style={{
                color: palette().textMuted,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.35),
              }}
            >
              {tr("shell.about.tagline")}
            </Text>
          </View>
        </View>

        <If when={aboutError()}>
          {message => (
            <Text
              style={{
                color: palette().danger,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.4),
              }}
            >
              {tr("shell.about.readFailed", { error: message() })}
            </Text>
          )}
        </If>

        <View
          style={{
            borderRadius: radii.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            overflow: "hidden",
          }}
        >
          <AboutRow
            label={tr("shell.about.version")}
            value={aboutFacts()?.version || dash()}
            mono
            copyable
          />
          <AboutRow label={tr("shell.about.platform")} value={aboutFacts()?.platform || dash()} />
          <AboutRow label={tr("shell.about.commit")} value={dash()} mono />
          <AboutRow label={tr("shell.about.branch")} value={dash()} mono />
          <AboutRow label={tr("shell.about.license")} value="MIT License" />
        </View>
        <Text
          style={{
            color: palette().textMuted,
            fontSize: textSize(11),
            lineHeight: textLineHeight(11, 1.4),
          }}
        >
          {tr("shell.about.buildMetadataNote")}
        </Text>
      </View>
    </ModalDialog>
  );
}
