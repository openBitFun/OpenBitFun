// Devices › Use on phone: the same-network QR and the anywhere route over the
// account's device mesh (EasyTier join values, secret hidden until revealed,
// mesh pairing QR), plus the explicit states of a signed-out mesh and an
// older backend.

import { expect, open, test } from "nsh/test";
import { createDeviceBackend, withPhoneFixtures } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("same network: turning on the LAN, then a one-time QR", async () => {
  const { backend, phoneCalls } = withPhoneFixtures(createDeviceBackend());
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("label:use-on-phone");
  await app.waitFor("Turn on access from the local network first.");
  expect(app.shows("label:phone-pair-lan")).toBe(false);

  await app.press("label:phone-lan-off >> text:Turn on");
  await app.waitFor("label:phone-pair-lan");
  expect(phoneCalls.find(call => call.command === "obp_set_lan_enabled")?.request).toEqual({ enabled: true });

  await app.press("label:phone-pair-lan");
  await app.waitFor("label:phone-qr-lan");
  await app.waitFor("text:https://192.168.1.5:47611/pair?code=code1");
  expect(phoneCalls.find(call => call.command === "obp_create_pairing")?.request).toEqual({ via: "lan" });
});

test("anywhere: EasyTier join values with the secret hidden, then the mesh pairing QR", async () => {
  const { backend, phoneCalls } = withPhoneFixtures(createDeviceBackend());
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("label:use-on-phone");

  await app.press("label:phone-route-mesh");
  await app.waitFor("text:obf-0123456789abcdef");
  await app.waitFor("text:wss://remote.openbitfun.com:443/mesh/et/");
  await app.waitFor("text:1. Install EasyTier on the phone");
  expect(app.shows("text:fixture-mesh-secret-0123456789")).toBe(false);
  expect(app.shows("label:phone-join-qr")).toBe(false);

  await app.press("label:phone-secret-toggle");
  await app.waitFor("text:fixture-mesh-secret-0123456789");
  await app.waitFor("label:phone-join-qr");
  await app.press("label:phone-secret-toggle");
  await app.waitUntil(() => !app.shows("label:phone-join-qr"));

  await app.waitFor(
    "text:With EasyTier connected, scan this code. The phone opens https://10.126.126.3:47612 in its browser.",
  );
  await app.press("label:phone-pair-mesh");
  await app.waitFor("label:phone-qr-mesh");
  await app.waitFor("text:https://10.126.126.3:47612/pair?code=code1");
  await app.waitFor("text:Certificate sha256:meshfp");
  expect(phoneCalls.filter(call => call.command === "obp_create_pairing").map(call => call.request)).toEqual([
    { via: "mesh" },
  ]);
  // Back to the same network: the mesh QR does not linger there.
  await app.press("label:phone-route-lan");
  expect(app.shows("label:phone-qr-mesh")).toBe(false);
});

test("anywhere: a signed-out mesh and an older backend say so instead of a QR", async () => {
  const signedOut = withPhoneFixtures(createDeviceBackend(), {
    meshError: "mesh_signed_out: sign in to reach your other devices",
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: signedOut.backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.press("label:phone-route-mesh");
  await app.waitFor("Sign in to OpenBitFun to use your device mesh.");
  expect(app.shows("label:phone-pair-mesh")).toBe(false);

  const older = withPhoneFixtures(createDeviceBackend(), {
    meshError: "unsupported_in_native_host: mesh_phone_join_info",
  });
  const second = await open("../App.tsx", { ...DESKTOP, host: { handlers: older.backend.handlers } });
  await second.waitFor("NSH skeleton");
  await second.press("Devices");
  await second.press("label:phone-route-mesh");
  await second.waitFor("This OpenBitFun backend cannot pair phones over the device mesh. Update the app on this computer.");
  expect(second.shows("text:obf-0123456789abcdef")).toBe(false);
});
