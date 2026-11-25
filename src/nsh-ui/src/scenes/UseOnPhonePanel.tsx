// Settings › Devices and chat apps › Open on your phone.
//
// A phone or any browser opens the OpenBitFun web controller (or the phone
// app), signs in with this account's email and picks this computer from the
// account's devices; the connection runs through the server gateway and is
// end-to-end encrypted to this backend. The sheet is the QR of the address, the
// address with Copy and Open, who is signed in now, and one security line
// (the address only: nothing to pair, no network values).

import { Clipboard, openUrl, Text, View } from "nsh";
import { tr } from "../i18n";
import {
  loadSignedInControllers,
  signedInControllers,
  WEB_CONTROLLER_URL,
  webControllerLabel,
} from "../phoneStore";
import { compactLayout, controlHeight, palette, radii, space, textStyle } from "../theme";
import { Icon } from "../ui/icons";
import { pushToast } from "../ui/overlays";
import { Button } from "../ui/primitives";
import { QrCodeView } from "../ui/studio";

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

/** The address in one quiet field with its two actions. */
function AddressRow() {
  return (
    <View
      accessibilityLabel="phone-web-controller"
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: 360,
        minHeight: controlHeight.md,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingLeft: space.md,
        paddingRight: space.xs,
        borderRadius: radii.md,
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
          flex: 1,
          minWidth: 0,
          userSelect: "text",
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {WEB_CONTROLLER_URL}
      </Text>
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
  );
}

/** Phones and browsers signed in to this account now, as one status line (never as unreachable devices). */
function SignedInLine() {
  return (
    <If when={signedInControllers()?.length ? signedInControllers() : null}>
      {controllers => (
        <View
          accessibilityLabel="phone-controllers"
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            columnGap: space.chip,
            rowGap: space.xs,
            maxWidth: "100%",
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: radii.pill, backgroundColor: palette().success }} />
          <Text style={textStyle("caption", { color: palette().textMuted })}>{tr("phone.signedInNow")}</Text>
          <Each of={controllers()} key={controller => controller.deviceId}>
            {(controller, index) => (
              <Text
                accessibilityLabel={`phone-controller-${controller().deviceId}`}
                style={{
                  ...textStyle("caption", { color: palette().textSecondary }),
                  maxWidth: 200,
                  numberOfLines: 1,
                  textOverflow: "ellipsis",
                }}
              >
                {`${index() > 0 ? "· " : ""}${controller().name ?? tr("phone.controllerUnnamed")}`}
              </Text>
            )}
          </Each>
        </View>
      )}
    </If>
  );
}

/** The body of the "Open on your phone" sheet. */
export function UseOnPhonePanel() {
  void loadSignedInControllers();
  return (
    <View
      accessibilityLabel="use-on-phone"
      style={{ alignItems: "center", gap: space.lg, minWidth: 0, paddingVertical: space.xs }}
    >
      <Text
        style={{
          ...textStyle("label", { color: palette().textSecondary }),
          fontWeight: "400",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        {tr("phone.intro", { url: webControllerLabel() })}
      </Text>
      <QrCodeView value={WEB_CONTROLLER_URL} size={compactLayout() ? 176 : 192} accessibilityLabel="phone-qr" />
      <AddressRow />
      <SignedInLine />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, maxWidth: 360 }}>
        <Icon name="shield" size={12} color={palette().textMuted} />
        <Text style={{ ...textStyle("caption", { color: palette().textMuted }), flexShrink: 1, textAlign: "center" }}>
          {tr("phone.footnote")}
        </Text>
      </View>
    </View>
  );
}
