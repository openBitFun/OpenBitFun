// The OpenBitFun conversation (visual spec §4.2 and §4.3, ux-redesign §3.1,
// §3.2 and §8): the new-conversation screen with the backend's suggestions and
// Working now; an idempotent send; live job cards where the model dispatched
// them, updated in place; Steer and Stop calling the card's own verbs; a
// pending prompt answered on the card and sent to the device that asked; the
// "Super Agent allowed it" line; citation chips; the signed-out, off and
// unavailable states; the history slot; no device picker anywhere in the
// composer; and the model picker (Auto, or a device and one of its models).
import { expect, open, test } from "nsh/test";
import { createSuperagentFixture, type SuperagentFixtureOptions } from "./fixtures/superagentFixtures";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const PHONE = { width: 375, height: 812, platform: "web" as const };
const APP = "./fixtures/openbitfunApp.tsx";

async function openApp(options: SuperagentFixtureOptions = {}, viewport: typeof DESKTOP | typeof PHONE = DESKTOP) {
  const backend = createSuperagentFixture(options);
  const app = await open(APP, { ...viewport, host: { handlers: backend.handlers } });
  return { app, backend };
}

async function openRelease(options: SuperagentFixtureOptions = {}, viewport: typeof DESKTOP | typeof PHONE = DESKTOP) {
  const opened = await openApp(options, viewport);
  if (viewport === DESKTOP) {
    await opened.app.waitFor("id:conversation-conv-release");
    await opened.app.press("id:conversation-conv-release");
  }
  return opened;
}

test("the new conversation asks one question, offers the backend's suggestions and lists what needs you", async () => {
  const { app, backend } = await openApp();
  await app.waitFor("text:What should we work on?");
  await app.waitFor("id:sa-suggestions");
  expect(app.shows("label:super-composer-field")).toBe(true);
  // The backend's three suggestions; a press fills the composer without sending.
  for (const text of ["Run the tests on all my devices", "Update deps", "Summarize today's work"]) {
    expect([text, app.shows(`id:sa-suggestions >> text:${text}`)]).toEqual([text, true]);
  }
  await app.press("label:Update deps");
  expect(app.value("label:super-composer-field")).toBe("Update deps");
  expect(backend.callsOf("superagent_send")).toHaveLength(0);
  // Needs you and Working now are the backend's lists, in its order.
  await app.waitFor("id:working-now-needs-you");
  expect(app.shows("id:working-now-needs-you >> text:Needs you")).toBe(true);
  expect(app.shows("id:working-job-test-mac >> text:Test release 1.2 on macOS")).toBe(true);
  expect(app.shows("id:working-job-test-mac >> label:working-allow-job-test-mac")).toBe(true);
  expect(app.shows("id:working-now-working >> text:Working now")).toBe(true);
  expect(app.shows("id:working-job-test-linux >> text:linux-box")).toBe(true);
  expect(app.shows("id:working-job-test-win >> text:Waiting for win-pc")).toBe(true);
  // The status read names the UI locale; the history read names the client's zone.
  expect(backend.callsOf("superagent_status")[0]?.request.locale).toBe("en-US");
});

test("no device picker exists anywhere in the composer, on the desktop or the phone (only the model picker)", async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const { app } = await openApp({}, viewport);
    await app.waitFor("id:super-composer");
    // The composer holds the field, attach, the mic and the send circle, and nothing else.
    for (const forbidden of [
      "label:run-target",
      "label:composer-run-target",
      "label:device-picker",
      "label:Select device",
      "label:Choose a device",
      "id:super-composer >> label:mode",
      "id:super-composer >> label:model",
      "id:super-composer >> text:linux-box",
      "id:super-composer >> text:mac-mini",
      "id:super-composer >> text:This device",
      "id:super-composer >> text:Return to send · Shift+Return for a new line",
    ]) {
      expect([forbidden, app.shows(forbidden)]).toEqual([forbidden, false]);
    }
    expect(app.count("id:super-composer >> role:combobox")).toBe(0);
    expect(app.shows("id:super-composer >> label:super-composer-attach")).toBe(true);
    expect(app.shows("id:super-composer >> label:Send")).toBe(true);
    // The one model control: Auto until the user picks a device and model.
    expect(app.shows("id:super-composer >> label:sa-model-picker")).toBe(true);
  }
});

test("the model picker offers Auto and every device's models; a new conversation sends its pick with the first message", async () => {
  const { app, backend } = await openApp();
  await app.waitFor("id:sa-suggestions");
  expect(app.shows("id:super-composer >> text:Auto")).toBe(true);
  await app.press("label:sa-model-picker");
  await app.waitFor("label:sa-model-auto");
  // The cloud node's groups, with the offline device's models not pickable.
  expect(app.shows("text:mac-mini")).toBe(true);
  expect(app.shows("text:win-pc · Offline")).toBe(true);
  expect(app.shows("label:sa-model-dev-mac-gpt")).toBe(true);
  const refused = await app.press("label:sa-model-dev-win-local").then(() => "", (error: unknown) => String(error));
  expect(refused).toContain("disabled");
  await app.press("label:sa-model-dev-mac-gpt");
  await app.waitFor("id:super-composer >> text:GPT-5 · mac-mini");
  // Nothing is sent before the first message: there is no conversation yet.
  expect(backend.callsOf("superagent_set_model")).toHaveLength(0);
  await app.type("label:super-composer-field", "Update deps");
  await app.press("label:Send");
  await app.waitFor("id:sa-conversation-header");
  const send = backend.callsOf("superagent_send")[0]!;
  expect(send.request.model).toEqual({ deviceId: "dev-mac", modelId: "gpt" });
  // The open conversation shows the cloud node's projection of its pick.
  await app.waitFor("id:super-composer >> text:GPT-5 · mac-mini");
});

test("an open conversation changes its model at once and goes back to Auto", async () => {
  const { app, backend } = await openRelease();
  await app.waitFor("id:sa-conversation-header >> text:Release 1.2");
  expect(app.shows("id:super-composer >> text:Auto")).toBe(true);
  await app.press("label:sa-model-picker");
  await app.press("label:sa-model-dev-mac-sonnet");
  await app.waitUntil(() => backend.callsOf("superagent_set_model").length === 1);
  expect(backend.callsOf("superagent_set_model")[0]!.request).toEqual({
    conversationId: "conv-release",
    deviceId: "dev-mac",
    modelId: "sonnet",
  });
  await app.waitFor("id:super-composer >> text:Claude Sonnet · mac-mini");
  expect(app.shows("id:sa-model-note")).toBe(false);
  await app.press("label:sa-model-picker");
  await app.press("label:sa-model-auto");
  await app.waitUntil(() => backend.callsOf("superagent_set_model").length === 2);
  expect(backend.callsOf("superagent_set_model")[1]!.request).toEqual({
    conversationId: "conv-release",
    deviceId: null,
    modelId: null,
  });
  await app.waitFor("id:super-composer >> text:Auto");
});

test("a pick whose device is offline says so under the composer", async () => {
  const { app } = await openRelease({ picks: { "conv-release": { deviceId: "dev-win", modelId: "local" } } });
  await app.waitFor("id:super-composer >> text:Local model · win-pc");
  await app.waitFor("id:sa-model-note");
  expect(
    app.shows("text:The device of this model is offline. Super Agent answers at once until it is back; pick Auto or another model to continue."),
  ).toBe(true);
});

test("sending is idempotent: a retry after a lost send keeps its clientMessageId, then the thread opens", async () => {
  const { app, backend } = await openApp({ failFirstSend: "entry_lost: the connection moved" });
  await app.waitFor("label:super-composer-field");
  await app.waitFor("id:sa-suggestions");
  await app.type("label:super-composer-field", "Run the tests on all my devices");
  await app.press("label:Send");
  await app.waitFor("id:sa-send-error");
  expect(app.shows("text:Couldn't confirm. Try again.")).toBe(true);
  // The text comes back so the user sends the same message again.
  expect(app.value("label:super-composer-field")).toBe("Run the tests on all my devices");
  await app.press("label:Send");
  await app.waitFor("id:sa-conversation-header");
  const sends = backend.callsOf("superagent_send");
  expect(sends).toHaveLength(2);
  expect(sends[0]?.request.clientMessageId).toBe(sends[1]?.request.clientMessageId);
  expect(sends[0]?.request.message).toBe("Run the tests on all my devices");
  expect(sends[0]?.request.conversationId).toBeUndefined();
  await app.waitFor("text:Run the tests on all my devices");
  expect(app.shows("id:sa-send-error")).toBe(false);
});

test("the conversation draws its cards where the model dispatched them, with the backend's states", async () => {
  const { app } = await openRelease();
  await app.waitFor("id:sa-conversation-header >> text:Release 1.2");
  expect(app.shows("text:Build on the linux box, then test it on all three.")).toBe(true);
  // One card for the build, then a stack of three for the tests.
  await app.waitFor("id:job-job-build");
  expect(app.shows("id:job-job-build >> text:Build release 1.2")).toBe(true);
  expect(app.shows("id:job-job-build >> text:Done · 4 min")).toBe(true);
  expect(app.shows("id:job-job-build >> text:release/1.2")).toBe(true);
  expect(app.shows("id:job-job-build >> text:+3 −1")).toBe(true);
  expect(app.shows("id:job-job-test-mac >> text:Needs you · now")).toBe(true);
  expect(app.shows("id:job-job-test-mac >> text:Wants to run")).toBe(true);
  expect(app.shows("id:job-job-test-mac >> text:pnpm e2e")).toBe(true);
  expect(app.shows("id:job-job-test-mac >> text:Allow once")).toBe(true);
  expect(app.shows("id:job-job-test-linux >> text:Working · 2 min")).toBe(true);
  expect(app.shows("id:job-job-test-linux >> text:cargo test 812/1400")).toBe(true);
  expect(app.shows("id:job-job-test-win >> text:Waiting for win-pc")).toBe(true);
  expect(app.shows("id:job-job-test-win >> text:Starts when it's online, expires in 23 h")).toBe(true);
  // Diffstats and branches are never colored: the same muted ink as the branch.
  expect(app.spanStyle("id:job-job-build >> text:+3 −1").color).toBe(app.spanStyle("id:job-job-build >> text:release/1.2").color);
});

test("the answeredBy line says what Super Agent allowed and shows the details on request", async () => {
  const { app } = await openRelease();
  await app.waitFor("id:job-answered-job-test-linux");
  expect(app.shows("id:job-answered-job-test-linux >> text:Super Agent allowed it · 2 min ago")).toBe(true);
  expect(app.shows("text:cargo test --workspace")).toBe(false);
  await app.press("id:job-answered-job-test-linux >> label:Details");
  await app.waitFor("text:cargo test --workspace");
  // A card the user's own answer settled has no such line.
  expect(app.shows("id:job-answered-job-build")).toBe(false);
});

test("a card updates in place when the cloud node pushes it", async () => {
  const { app, backend } = await openRelease();
  await app.waitFor("id:job-job-test-linux >> text:Working · 2 min");
  const card = backend.setCard("job-test-linux", { state: "done", summaryLine: undefined, updatedMs: Date.now() });
  await app.host.send("openbitfun.event", {
    event: "superagent://card-changed",
    payload: { conversationId: "conv-release", card },
  });
  await app.waitFor("id:job-job-test-linux >> text:Done · now");
  expect(app.shows("id:job-job-test-linux >> text:cargo test 812/1400")).toBe(false);
  expect(app.count("id:job-job-test-linux")).toBe(1);
});

test("Steer and Stop call the card's own verbs", async () => {
  const { app, backend } = await openRelease();
  await app.waitFor("id:job-job-test-linux");
  await app.hover("id:job-job-test-linux");
  await app.waitFor("id:job-steer-job-test-linux");
  await app.press("id:job-steer-job-test-linux");
  await app.waitFor("label:job-steer-field-job-test-linux");
  await app.type("label:job-steer-field-job-test-linux", "Skip the UI tests");
  await app.submit("label:job-steer-field-job-test-linux");
  await app.waitFor("id:job-job-test-linux >> text:Sent");
  const steer = backend.callsOf("superagent_job_action").find(call => call.request.action === "message");
  expect(steer?.request.jobId).toBe("job-test-linux");
  expect(steer?.request.text).toBe("Skip the UI tests");
  expect(typeof steer?.request.clientMessageId).toBe("string");

  await app.hover("id:job-job-test-linux");
  await app.press("id:job-stop-job-test-linux");
  await app.waitFor("text:Stopped · linux-box");
  const stop = backend.callsOf("superagent_job_action").find(call => call.request.action === "cancel");
  expect(stop?.request.jobId).toBe("job-test-linux");
  // A finished job offers Stop only as a disallowed verb, with its reason.
  await app.hover("id:job-job-build");
  await app.waitFor("id:job-stop-job-build");
  expect(app.viewStyle("id:job-stop-job-build")?.opacity).toBeLessThan(1);
});

test("a pending prompt answered on the card goes to the device that asked", async () => {
  const { app, backend } = await openRelease();
  await app.waitFor("id:job-job-test-mac >> text:pnpm e2e");
  await app.press("label:allow-once-perm-e2e");
  await app.waitUntil(() => backend.callsOf("dispatch_target_answer").length > 0);
  const answer = backend.callsOf("dispatch_target_answer")[0];
  expect(answer?.request).toEqual({ jobId: "job-test-mac", requestId: "perm-e2e", reply: "once" });
  // Never through the model.
  expect(backend.callsOf("superagent_send")).toHaveLength(0);
});

test("a citation chip scrolls to its card and highlights it", async () => {
  const { app } = await openRelease();
  await app.waitFor("id:cite-job-build");
  expect(app.shows("id:cite-job-build >> text:Build release 1.2 · linux-box")).toBe(true);
  expect(app.viewStyle("id:job-job-build")?.backgroundColor ?? null).toBeNull();
  await app.press("id:cite-job-build");
  await app.waitUntil(() => Boolean(app.viewStyle("id:job-job-build")?.backgroundColor));
});

test("streamed text and the thinking line follow the running turn", async () => {
  const { app } = await openRelease({ turnStep: "model_round" });
  await app.waitFor("id:sa-thinking");
  await app.host.send("openbitfun.event", {
    event: "superagent://turn-delta",
    payload: { conversationId: "conv-release", turnId: "turn-3", step: "model_round", text: "All three passed" },
  });
  await app.waitFor("text:All three passed");
  expect(app.shows("id:sa-thinking")).toBe(false);
  // While a turn runs, the send circle is Stop and cancels the turn, not the jobs.
  expect(app.shows("id:super-composer >> label:Stop")).toBe(true);
});

test("signed out, off and unavailable replace the composer's bottom row with the reason and one action", async () => {
  const signedOut = await openApp({ signedIn: false });
  await signedOut.app.waitFor("id:super-composer-blocked");
  expect(signedOut.app.shows("text:Sign in to use Super Agent · Your sessions on this device still work.")).toBe(true);
  expect(signedOut.app.shows("id:super-composer-blocked >> text:Sign in")).toBe(true);
  expect(signedOut.app.shows("label:Send")).toBe(false);

  const off = await openApp({ enabled: false });
  await off.app.waitFor("text:Super Agent is off · Turn it on to start work on any of your devices.");
  await off.app.press("id:super-composer-blocked >> text:Turn on");
  await off.app.waitFor("label:Send");
  expect(off.backend.callsOf("superagent_enable")).toHaveLength(1);

  const old = await openApp({ statusError: "unknown command: superagent_status" });
  await old.app.waitFor("text:Super Agent isn't available right now. This device needs an update to use it.");
  expect(old.app.shows("id:super-composer-blocked >> text:Try again")).toBe(true);
  // The field stays visible but takes no message.
  expect(old.app.shows("label:super-composer-field")).toBe(true);
});

test("a status read that failed while the entry's link reconnected is tried again by itself", async () => {
  const { app, backend } = await openApp({
    statusErrorOnce: "peer_unreachable: device cloud-1 did not answer over the mesh: the mesh connection was closed",
    // Every read the app makes on its own while starting fails; only the
    // store's own retry can bring the composer back.
    statusFailures: 2,
  });
  await app.waitFor("id:super-composer-blocked");
  await app.waitFor("label:Send", { timeout: 8000 });
  expect(backend.callsOf("superagent_status").length).toBeGreaterThanOrEqual(3);
});

test("the history slot draws the backend's groups and marks; rename and delete use the conversation verbs", async () => {
  const { app, backend } = await openApp();
  await app.waitFor("id:conversation-history >> text:Today");
  expect(app.shows("id:conversation-history >> text:Yesterday")).toBe(true);
  expect(app.shows("id:conversation-conv-release >> label:Needs you")).toBe(true);
  expect(app.shows("id:conversation-conv-812 >> label:Working")).toBe(true);
  // Unread is weight, not color.
  expect(app.spanStyle("id:conversation-conv-deps >> text:Bump deps").fontWeight).toBe(600);

  await app.hover("id:conversation-conv-812");
  await app.press("label:conversation-menu-conv-812");
  await app.press("label:Rename…");
  await app.waitFor("label:conversation-rename-field");
  await app.clear("label:conversation-rename-field");
  await app.type("label:conversation-rename-field", "Fix flaky test");
  await app.press("text:Save");
  await app.waitFor("id:conversation-history >> text:Fix flaky test");
  expect(backend.callsOf("superagent_rename_conversation")[0]?.request).toEqual({ conversationId: "conv-812", title: "Fix flaky test" });

  await app.hover("id:conversation-conv-deps");
  await app.press("label:conversation-menu-conv-deps");
  await app.press("label:Delete conversation…");
  await app.waitFor("text:Delete “Bump deps”?");
  expect(app.shows("text:Jobs it started keep running on their devices.")).toBe(true);
  await app.press("text:Delete");
  await app.waitFor("id:conversation-conv-deps", { state: "gone" });
  expect(backend.callsOf("superagent_delete_conversation")[0]?.request).toEqual({ conversationId: "conv-deps" });
});

test("on a phone a card is two lines and a tap opens Open · Steer · Stop", async () => {
  const { app } = await openApp({}, PHONE);
  await app.waitFor("id:working-job-test-linux");
  await app.press("id:working-job-test-linux");
  // Working now opens the job's session; the thread is reached from the history.
  const thread = await openRelease({}, DESKTOP);
  await thread.app.setViewport(PHONE.width, PHONE.height);
  await thread.app.waitFor("id:job-job-test-linux");
  expect(thread.app.shows("id:job-job-test-linux >> text:Working · 2 min")).toBe(true);
  expect(thread.app.shows("id:job-job-test-linux >> text:release/1.2")).toBe(false);
  await thread.app.press("id:job-job-test-linux >> label:Test release 1.2 on Linux · linux-box");
  await thread.app.waitFor("label:Steer");
  expect(thread.app.shows("label:Open")).toBe(true);
  expect(thread.app.shows("label:Stop")).toBe(true);
});

test("the copy follows the locale", async () => {
  const backend = createSuperagentFixture();
  const app = await open(APP, { ...DESKTOP, storage: { "openbitfun.nsh.locale.v1": "zh-CN" }, host: { handlers: backend.handlers } });
  await app.waitFor("text:今天要做什么？");
  await app.waitFor("text:需要你处理");
  expect(app.shows("text:正在运行")).toBe(true);
  expect(app.shows("text:今天")).toBe(true);
});
