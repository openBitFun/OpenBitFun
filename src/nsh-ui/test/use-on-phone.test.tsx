// Devices › Use on phone or in a browser: the panel points at the web
// controller (address and its QR only). Nothing is paired and no network value
// is shown; the retired EasyTier-app route and the mesh pairing QR are gone.

import { expect, open, test } from "nsh/test";
import { createDeviceBackend, withMeshPeerFixtures, withPhoneFixtures } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

test("the web controller address and its QR, no join values or pairing", async () => {
  const { backend, phoneCalls } = withPhoneFixtures(createDeviceBackend());
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("label:use-on-phone");
  await app.waitFor("label:phone-qr");
  await app.waitFor("text:https://remote.openbitfun.com/app/");
  await app.waitFor(
    "text:On your phone or any computer, open remote.openbitfun.com/app (or the OpenBitFun app) and sign in with the email of this account. Your devices are listed there; pick this computer to use it.",
  );
  // No EasyTier steps, network values or pairing offer any more.
  expect(app.shows("text:obf-0123456789abcdef")).toBe(false);
  expect(app.shows("label:phone-secret-toggle")).toBe(false);
  expect(app.shows("label:phone-pair-mesh")).toBe(false);
  expect(app.shows("label:phone-route-lan")).toBe(false);
  expect(phoneCalls.some(call => call.command === "mesh_phone_join_info")).toBe(false);
  expect(phoneCalls.some(call => call.command === "obp_create_pairing")).toBe(false);

  await app.press("label:phone-copy-url");
  await app.waitUntil(() => app.clipboard() === "https://remote.openbitfun.com/app/");
  await app.press("label:phone-open-url");
  await app.waitUntil(() => app.openedUrls().includes("https://remote.openbitfun.com/app/"));
});

test("phones and browsers signed in now are listed as signed-in clients, never as unreachable devices", async () => {
  const { backend } = withPhoneFixtures(createDeviceBackend());
  withMeshPeerFixtures(backend, {
    meshDevices: [
      { deviceId: "phone-1", name: "Alice's iPhone", role: "controller", reachable: false, path: "relayed", route: "relayed_server", hops: 2, capabilities: [] },
      { deviceId: "obf-gateway-lwb", name: null, role: "controller", reachable: false, path: "relayed", hops: 2, capabilities: [] },
      { deviceId: "desk-2", name: "Studio Mac", role: "device", reachable: true, path: "p2p", route: "direct_lan", hops: 1, capabilities: ["obp_v1", "mesh_v1"] },
    ],
  });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("Devices");
  await app.waitFor("label:phone-controllers");
  await app.waitFor("label:phone-controller-phone-1");
  await app.waitFor("Alice's iPhone");
  await app.waitFor("text:Signed in to this account · Relayed via OpenBitFun server");
  // A controller without a directory name is still a signed-in client.
  await app.waitFor("label:phone-controller-obf-gateway-lwb");
  await app.waitFor("Phone or browser");
  // Devices (hosts) are not listed here.
  expect(app.shows("label:phone-controller-desk-2")).toBe(false);
});
