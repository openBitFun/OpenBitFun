// Devices › Use on phone or in a browser.
//
// A phone or any browser opens the OpenBitFun web controller (or the phone
// app), signs in with this account's email and picks this computer from the
// account's devices; the connection runs through the server gateway and is
// end-to-end encrypted to this backend. The panel shows the address and its QR
// (the address only: nothing to pair, no network values).

import { Clipboard, openUrl, Text, View } from "nsh";
import { tr } from "../i18n";
import {
  loadSignedInControllers,
  signedInControllers,
  WEB_CONTROLLER_URL,
  webControllerLabel,
} from "../phoneStore";
import { compactLayout, palette, radii, space, textStyle } from "../theme";
import { Icon } from "../ui/icons";
import { pushToast } from "../ui/overlays";
import { Button } from "../ui/primitives";
import { InsetGroup, InsetRow, QrCodeView, StudioSection } from "../ui/studio";

async function copy(text: string): Promise<void> {
  try {
    await Clipboard.writeText(text);
    pushToast(tr("phone.copied"), "success");
  } catch {
    pushToast(tr("phone.copyFailed"), "danger");
  }
}

function open(url: string): void {
  void openUrl(url).catch(() => pushToast(tr("phone.openFailed", { url }), "danger"));
}

/** Phones and browsers signed in to this account now (never listed as unreachable devices). */
function SignedInControllers(props: { embedded?: boolean }) {
  return (
    <If when={signedInControllers()?.length ? signedInControllers() : null}>
      {controllers => (
        <View style={{ gap: space.xs, minWidth: 0 }}>
          <Text style={{ ...textStyle("caption", { color: palette().textElevatedMuted }), fontWeight: "600" }}>
            {tr("phone.signedInNow")}
          </Text>
          <If
            when={Boolean(props.embedded)}
            else={
              <InsetGroup accessibilityLabel="phone-controllers">
                <Each of={controllers()} key={controller => controller.deviceId}>
                  {(controller, index) => (
                    <InsetRow
                      first={index() === 0}
                      icon="smartphone"
                      label={controller().name ?? tr("phone.controllerUnnamed")}
                      detail={tr("phone.controllerSignedIn")}
                      accessibilityLabel={`phone-controller-${controller().deviceId}`}
                    />
                  )}
                </Each>
              </InsetGroup>
            }
          >
            <View
              accessibilityLabel="phone-controllers"
              style={{
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
                overflow: "hidden",
              }}
            >
              <Each of={controllers()} key={controller => controller.deviceId}>
                {(controller, index) => (
                  <View
                    accessibilityLabel={`phone-controller-${controller().deviceId}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.md,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      borderTopWidth: index() === 0 ? 0 : 1,
                      borderColor: palette().borderSubtle,
                    }}
                  >
                    <Icon name="smartphone" size={15} color={palette().textMuted} />
                    <Text
                      style={{
                        ...textStyle("label", { color: palette().text }),
                        flex: 1,
                        minWidth: 0,
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {controller().name ?? tr("phone.controllerUnnamed")}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.chip, flexShrink: 0 }}>
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: radii.pill,
                          backgroundColor: palette().success,
                        }}
                      />
                      <Text style={textStyle("caption", { color: palette().textMuted })}>
                        {tr("phone.controllerSignedIn")}
                      </Text>
                    </View>
                  </View>
                )}
              </Each>
            </View>
          </If>
        </View>
      )}
    </If>
  );
}

function PhoneQrBlock(props: { embedded?: boolean }) {
  return (
    <View style={{ gap: space.md, minWidth: 0 }}>
      <Text style={{ ...textStyle("label", { color: palette().textSecondary }), fontWeight: "400" }}>
        {tr("phone.intro", { url: webControllerLabel() })}
      </Text>
      <View
        accessibilityLabel="phone-web-controller"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.lg,
          alignItems: "center",
          ...(props.embedded
            ? {
                padding: space.md,
                borderRadius: radii.lg,
                borderCurve: "continuous" as const,
                borderWidth: 1,
                borderColor: palette().borderSubtle,
                backgroundColor: palette().surfaceTertiary,
              }
            : {}),
        }}
      >
        <QrCodeView value={WEB_CONTROLLER_URL} size={136} accessibilityLabel="phone-qr" />
        <View style={{ flex: 1, minWidth: 180, gap: space.sm, justifyContent: "center" }}>
          <Text style={textStyle("caption", { color: palette().textElevatedMuted })}>{tr("phone.qrHint")}</Text>
          <View
            style={{
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radii.sm,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: palette().borderSubtle,
              backgroundColor: palette().inputBg,
            }}
          >
            <Text
              accessibilityLabel="phone-url"
              style={{
                ...textStyle("mono", { color: palette().text }),
                userSelect: "text",
                numberOfLines: 1,
                textOverflow: "ellipsis",
              }}
            >
              {WEB_CONTROLLER_URL}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", paddingTop: space.hair }}>
            <Button
              label={tr("phone.copy")}
              variant="secondary"
              size={compactLayout() ? "md" : "sm"}
              leadingIcon="copy"
              accessibilityLabel="phone-copy-url"
              onPress={() => void copy(WEB_CONTROLLER_URL)}
            />
            <Button
              label={tr("phone.open")}
              variant="secondary"
              size={compactLayout() ? "md" : "sm"}
              leadingIcon="external-link"
              accessibilityLabel="phone-open-url"
              onPress={() => open(WEB_CONTROLLER_URL)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

/** Devices › Use on phone or in a browser. */
export function UseOnPhonePanel(props: { embedded?: boolean } = {}) {
  void loadSignedInControllers();
  if (props.embedded) {
    return (
      <View accessibilityLabel="use-on-phone" style={{ gap: space.lg, minWidth: 0 }}>
        <PhoneQrBlock embedded />
        <SignedInControllers embedded />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm, minWidth: 0 }}>
          <View style={{ paddingTop: 2, flexShrink: 0 }}>
            <Icon name="shield" size={13} color={palette().textMuted} />
          </View>
          <Text style={{ ...textStyle("caption", { color: palette().textMuted }), flex: 1, minWidth: 0 }}>
            {tr("phone.footnote")}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <StudioSection title={tr("phone.title")} footnote={tr("phone.footnote")} accessibilityLabel="use-on-phone">
      <View style={{ gap: space.lg, minWidth: 0 }}>
        <InsetGroup accessibilityLabel="phone-panel">
          <View style={{ padding: space.lg }}>
            <PhoneQrBlock />
          </View>
        </InsetGroup>
        <SignedInControllers />
      </View>
    </StudioSection>
  );
}
