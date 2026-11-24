// The OpenBitFunControl presentation surface: the host resolves where an Agent
// request leads (`destination`), this UI opens that screen and reports back.
import { expect, open, test } from "nsh/test";
import { showAllSessions, createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

async function request(app: Awaited<ReturnType<typeof open>>, payload: Record<string, unknown>): Promise<void> {
  await app.host.send("openbitfun.event", { event: "agentic://openbitfun-control-request", payload });
}

test("an Agent request opens the screen the host resolved and reports it", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showAllSessions(app, "NSH skeleton");
  // The window declares itself the presentation surface without claiming creation support.
  expect(backend.calls.find(call => call.action === "mark_openbitfun_control_surface_ready")?.request).toEqual({});

  await request(app, {
    requestId: "r-1",
    action: "open",
    capabilityId: "setting.tools.mcp",
    destination: { kind: "settings", pageId: "tools.mcp" },
  });
  await app.waitFor("MCP servers");
  expect(backend.controlReports?.[0]).toMatchObject({
    requestId: "r-1",
    success: true,
    result: { opened: true, surface: "desktop", target: "settings:mcp" },
  });

  await request(app, {
    requestId: "r-2",
    action: "open",
    capabilityId: "feature.git",
    destination: { kind: "scene", sceneId: "git" },
  });
  await app.waitUntil(() => (backend.controlReports?.length ?? 0) >= 2);
  expect(backend.controlReports?.[1]).toMatchObject({ requestId: "r-2", success: true, result: { target: "scene:git" } });

  await request(app, {
    requestId: "r-3",
    action: "execute",
    capabilityId: "feature.skills",
    operationId: "open",
    destination: { kind: "action", actionId: "surface.skills.open" },
  });
  await app.waitUntil(() => (backend.controlReports?.length ?? 0) >= 3);
  expect(backend.controlReports?.[2]).toMatchObject({ requestId: "r-3", success: true, result: { executed: true } });
});

test("a destination this UI has no screen for fails loudly instead of pretending", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showAllSessions(app, "NSH skeleton");
  await request(app, {
    requestId: "r-pet",
    action: "open",
    capabilityId: "setting.application.pet",
    destination: { kind: "settings", pageId: "application.pet" },
  });
  await app.waitUntil(() => (backend.controlReports?.length ?? 0) >= 1);
  expect(backend.controlReports?.[0]).toMatchObject({ requestId: "r-pet", success: false });
  expect(String(backend.controlReports?.[0]?.error)).toContain("settings page application.pet");

  // An older host sends no destination: the surface says the host needs an update.
  await request(app, { requestId: "r-old", action: "open", capabilityId: "setting.tools.mcp" });
  await app.waitUntil(() => (backend.controlReports?.length ?? 0) >= 2);
  expect(backend.controlReports?.[1]).toMatchObject({ requestId: "r-old", success: false });
  expect(String(backend.controlReports?.[1]?.error)).toContain("update the OpenBitFun host");
});

test("a persisted language change from the executor is applied and acknowledged", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await showAllSessions(app, "NSH skeleton");
  await app.host.send("openbitfun.event", {
    event: "agentic://openbitfun-control-effect",
    payload: { requestId: "e-1", phase: "commit", changedPaths: ["app.language"], value: "zh-CN" },
  });
  // The shell repaints in the new language (the sidebar's Library row).
  await app.waitFor("资源库");
  expect(backend.controlReports?.[0]).toMatchObject({ requestId: "e-1", success: true, result: { status: "applied" } });
});
