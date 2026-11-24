// Dialogs that hold typed input, or a flow waiting on something outside the app,
// must survive the stray click that brings the user back to the window: the
// backdrop no longer closes them, a first Escape over typed input only warns,
// and the sign-in code step comes back where it was when the dialog is reopened.
import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
/**
 * A tall phone window: the dialog is a sheet at the bottom, so the middle of the
 * backdrop (where a test press lands) is uncovered, as a stray tap above a sheet is.
 */
const TALL_PHONE = { width: 400, height: 1800, platform: "macos" as const };
const SIGN_IN_FIXTURE = "./fixtures/signInFixture.tsx";

function accountHost() {
  const base = createBackend();
  const invoke = base.handlers["openbitfun.invoke"];
  const calls: Array<{ action: string; request: unknown }> = [];
  let identity: { provider: string; accountId: string; displayName: string; initial: string } | null = null;
  const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown };
    const action = args.action ?? "";
    calls.push({ action, request: args.request });
    switch (action) {
      case "account_status":
        return ok(identity ? { logged_in: true, user_id: identity.accountId } : { logged_in: false, user_id: null });
      case "account_identity":
        return ok(identity);
      case "account_email_start":
        return ok({ challengeId: "ch-1", email: "me@example.com", codeLength: 8, retryAfterSeconds: 60, expiresAt: null });
      case "account_email_verify": {
        const request = (args.request ?? {}) as { code?: string };
        if (request.code !== "12345678") return { ok: false, error: "invalid_code: The verification code is incorrect." };
        identity = { provider: "email", accountId: "email-7", displayName: "me@example.com", initial: "M" };
        return ok({ identity });
      }
      default:
        return invoke(data);
    }
  };
  return { base, calls };
}

test("a stray click while the code is on its way keeps the sign-in, and reopening resumes at the code", async () => {
  const { base, calls } = accountHost();
  const app = await open("../App.tsx", { ...TALL_PHONE, host: { handlers: base.handlers } });
  const openAccount = async () => {
    await app.press("phone-account");
    await app.press("settings-compact-page-profile");
    await app.press("settings-account-sign-in");
    await app.waitFor("label:account-auth-modal");
  };
  await app.waitFor("phone-account");
  await openAccount();
  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.waitFor("label:account-auth-code-input");

  // Back from the mail app: the tap beside the sheet does not close it.
  await app.press("id:account-auth-modal-backdrop");
  expect(app.shows("label:account-auth-code-input")).toBe(true);

  // Closed on purpose, then opened again: still at the code, no second mail sent.
  await app.press("label:modal-close");
  await app.waitFor("label:account-auth-modal", { state: "gone" });
  await app.press("settings-account-sign-in");
  await app.waitFor("label:account-auth-code-input");
  expect(calls.filter(call => call.action === "account_email_start")).toHaveLength(1);

  // The code as the mail groups it signs in by itself once complete.
  await app.type("account-auth-code-input", "1234-5678");
  await app.waitUntil(() => calls.some(call => call.action === "account_email_verify"));
  expect(calls.find(call => call.action === "account_email_verify")?.request).toEqual({
    challengeId: "ch-1",
    code: "12345678",
  });
  await app.waitFor("label:account-auth-modal", { state: "gone" });
});

test("a wrong code is cleared from the error line as soon as the code is edited", async () => {
  const { base } = accountHost();
  const app = await open(SIGN_IN_FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.type("account-auth-code-input", "00000000");
  await app.waitFor("text:That code didn't work. Check it or send a new one.");
  await app.clear("account-auth-code-input");
  await app.type("account-auth-code-input", "1");
  await app.waitFor("text:That code didn't work. Check it or send a new one.", { state: "gone" });
});

test("a dialog with typed input stays on a backdrop click and asks for a second Escape", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...TALL_PHONE, host: { handlers: backend.handlers } });
  const openNewWorkspace = async () => {
    if (!app.shows("device-new-workspace")) await app.press("device-open-local");
    await app.press("device-new-workspace");
    await app.waitFor("new-workspace-modal");
  };
  await app.waitFor("device-open-local");

  // Untouched, a tap beside the sheet closes it.
  await openNewWorkspace();
  await app.press("id:new-workspace-modal-backdrop");
  await app.waitFor("new-workspace-modal", { state: "gone" });

  // Typed into, it stays.
  await openNewWorkspace();
  await app.type("new-workspace-name", "half-typed");
  await app.press("id:new-workspace-modal-backdrop");
  expect(app.shows("new-workspace-modal")).toBe(true);
  expect(app.value("new-workspace-name")).toBe("half-typed");

  // The first Escape warns, the second closes.
  await app.keyboard.press("escape");
  await app.wait(200);
  console.log("AFTER_ESC " + JSON.stringify(app.texts().slice(-8)));
  await app.waitFor("label:modal-escape-again");
  expect(app.shows("new-workspace-modal")).toBe(true);
  await app.wait(300);
  await app.keyboard.press("escape");
  await app.waitFor("new-workspace-modal", { state: "gone" });
});

test("a select opens on its current value and Up / Down / Return choose without the pointer", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("nav-library");
  await app.press("sidebar-new-workspace");
  await app.waitFor("new-workspace-modal");
  // Folder is the current environment; one step down is Docker.
  await app.press("new-workspace-env-mode");
  await app.waitFor("label:new-ws-env-container");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  // Docker on this machine asks which container.
  await app.waitFor("new-workspace-env-select");
  expect(app.shows("label:new-ws-env-container")).toBe(false);
});
