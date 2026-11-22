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
import { compactLayout, palette, space, textStyle } from "../theme";
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
function SignedInControllers() {
  return (
    <If when={signedInControllers()?.length ? signedInControllers() : null}>
      {controllers => (
        <View style={{ gap: space.sm, minWidth: 0 }}>
          <Text style={textStyle("label", { color: palette().textSecondary })}>{tr("phone.signedInNow")}</Text>
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
        </View>
      )}
    </If>
  );
}

function PhoneQrBlock() {
  return (
    <View style={{ gap: space.lg, minWidth: 0 }}>
      <Text style={textStyle("caption")}>{tr("phone.intro", { url: webControllerLabel() })}</Text>
      <View
        accessibilityLabel="phone-web-controller"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, alignItems: "flex-start" }}
      >
        <QrCodeView value={WEB_CONTROLLER_URL} size={160} accessibilityLabel="phone-qr" />
        <View style={{ flex: 1, minWidth: 160, gap: space.sm }}>
          <Text style={textStyle("caption")}>{tr("phone.qrHint")}</Text>
          <Text
            accessibilityLabel="phone-url"
            style={{
              ...textStyle("mono", { color: palette().text }),
              userSelect: "text",
            }}
          >
            {WEB_CONTROLLER_URL}
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
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
              variant="ghost"
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
        <PhoneQrBlock />
        <SignedInControllers />
        <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("phone.footnote")}</Text>
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
