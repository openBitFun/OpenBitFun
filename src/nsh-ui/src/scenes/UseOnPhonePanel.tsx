// Devices › Use on phone or in a browser.
//
// A phone or any browser opens the OpenBitFun web controller (or the phone
// app), signs in with this account's email and picks this computer from the
// account's devices; the connection runs through the server gateway and is
// end-to-end encrypted to this backend. The panel shows the address and its QR
// (the address only: nothing to pair, no network values).

import { Clipboard, openUrl, Text, View } from "nsh";
import { tr } from "../i18n";
import { meshPathLabel } from "../meshPath";
import {
  loadSignedInControllers,
  signedInControllers,
  WEB_CONTROLLER_URL,
  webControllerLabel,
  type SignedInController,
} from "../phoneStore";
import { fontMono, palette, radii, textLineHeight, textSize, textStyle } from "../theme";
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

function controllerDetail(controller: SignedInController): string {
  const path = meshPathLabel({
    reachable: true,
    path: controller.path ?? undefined,
    route: controller.route ?? undefined,
    relayVia: controller.relayVia,
    latencyMs: controller.latencyMs ?? undefined,
  });
  return path ? `${tr("phone.controllerSignedIn")} · ${path}` : tr("phone.controllerSignedIn");
}

/** Phones and browsers signed in to this account now (never listed as unreachable devices). */
function SignedInControllers() {
  return (
    <If when={signedInControllers()?.length ? signedInControllers() : null}>
      {controllers => (
        <View style={{ gap: 6 }}>
          <Text style={textStyle("caption")}>{tr("phone.signedInNow")}</Text>
          <InsetGroup accessibilityLabel="phone-controllers" style={{ backgroundColor: palette().canvas }}>
            <Each of={controllers()} key={controller => controller.deviceId}>
              {(controller, index) => (
                <InsetRow
                  first={index() === 0}
                  icon="smartphone"
                  label={controller().name ?? tr("phone.controllerUnnamed")}
                  detail={controllerDetail(controller())}
                  accessibilityLabel={`phone-controller-${controller().deviceId}`}
                />
              )}
            </Each>
          </InsetGroup>
        </View>
      )}
    </If>
  );
}

/** Devices › Use on phone or in a browser. */
export function UseOnPhonePanel() {
  void loadSignedInControllers();
  return (
    <StudioSection title={tr("phone.title")} footnote={tr("phone.footnote")} accessibilityLabel="use-on-phone">
      <InsetGroup accessibilityLabel="phone-panel">
        <View style={{ gap: 14, padding: 16 }}>
          <Text style={textStyle("caption")}>{tr("phone.intro", { url: webControllerLabel() })}</Text>
          <View
            accessibilityLabel="phone-web-controller"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}
          >
            <View style={{ padding: 6, borderRadius: radii.md, borderCurve: "continuous", backgroundColor: "#ffffff" }}>
              <QrCodeView value={WEB_CONTROLLER_URL} size={160} accessibilityLabel="phone-qr" />
            </View>
            <View style={{ flex: 1, minWidth: 200, gap: 8 }}>
              <Text style={textStyle("caption")}>{tr("phone.qrHint")}</Text>
              <Text
                accessibilityLabel="phone-url"
                style={{
                  fontFamily: fontMono,
                  fontSize: textSize(12),
                  color: palette().text,
                  lineHeight: textLineHeight(12, 1.45),
                }}
              >
                {WEB_CONTROLLER_URL}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  label={tr("phone.copy")}
                  variant="ghost"
                  size="sm"
                  leadingIcon="copy"
                  accessibilityLabel="phone-copy-url"
                  onPress={() => void copy(WEB_CONTROLLER_URL)}
                />
                <Button
                  label={tr("phone.open")}
                  variant="ghost"
                  size="sm"
                  leadingIcon="external-link"
                  accessibilityLabel="phone-open-url"
                  onPress={() => open(WEB_CONTROLLER_URL)}
                />
              </View>
            </View>
          </View>
          <SignedInControllers />
        </View>
      </InsetGroup>
    </StudioSection>
  );
}
