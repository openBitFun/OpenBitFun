// The desktop sign-in (visual spec §4.1). This host has no email-code command,
// so Continue starts its browser sign-in (`account_github_start`), the code is
// confirmed on the sign-in page, and `account_github_poll` finishes it; then
// "{device} is ready". The copy is the one the browser launcher uses.
import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const FIXTURE = "./fixtures/signInFixture.tsx";

function accountHost() {
  const base = createBackend();
  const invoke = base.handlers["openbitfun.invoke"];
  const calls: string[] = [];
  let polls = 0;
  let signedIn = false;
  const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const action = ((data ?? {}) as { action?: string }).action ?? "";
    calls.push(action);
    switch (action) {
      case "account_status":
        return ok(signedIn ? { logged_in: true, user_id: "user-42" } : { logged_in: false, user_id: null });
      case "account_github_info":
        return ok(signedIn ? { user: { githubId: 42, login: "me", avatarUrl: "" }, email: "me@example.com", isAdmin: false } : null);
      case "account_github_start":
        return ok({ userCode: "WXYZ-5678", verificationUri: "https://example.com/device", deviceCode: "dc-1", interval: 5 });
      case "account_github_poll":
        polls += 1;
        if (polls === 1) return ok({ status: "pending" });
        signedIn = true;
        return ok({ status: "authorized" });
      case "account_logout":
        signedIn = false;
        return ok(null);
      default:
        return invoke(data);
    }
  };
  return { base, calls };
}

test("first run: the sign-in column, the browser step, then the device is ready", async () => {
  const { base, calls } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });

  await app.waitFor("text:Your agents, on every device");
  expect(app.shows("text:Sign in to talk to OpenBitFun and reach all your devices from here.")).toBe(true);
  expect(app.shows("text:Use on this device only")).toBe(true);
  // No GitHub wording anywhere in the sign-in.
  expect(app.texts().some(text => /github/i.test(text))).toBe(false);

  await app.press("label:account-auth-continue");
  await app.waitFor("text:WXYZ-5678");
  await app.waitFor("text:Finish in your browser");
  expect(calls).toContain("account_github_start");
  expect(app.openedUrls()).toContain("https://example.com/device");

  await app.press("label:home-github-poll");
  await app.waitUntil(() => calls.filter(action => action === "account_github_poll").length === 1);
  await app.press("label:home-github-poll");
  await app.waitFor("label:account-auth-ready");
  await app.press("label:account-auth-start");
  await app.waitFor("text:welcome done");
});

test("use on this device only leaves the sign-in without an account", async () => {
  const { base, calls } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("label:account-auth-local-only");
  await app.press("label:account-auth-local-only");
  await app.waitFor("text:local only");
  expect(calls).not.toContain("account_github_start");
});

test("the account dialog shows the same steps and the signed-in account", async () => {
  const { base } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.press("label:account-auth-local-only");
  await app.press("Open account");
  await app.waitFor("label:account-auth-modal");
  await app.press("label:account-auth-continue");
  await app.waitFor("text:WXYZ-5678");
  await app.press("label:home-github-poll");
  await app.press("label:home-github-poll");
  // Signed in: the dialog closes with a toast; reopened, it names the account.
  await app.waitFor("text:Signed in as me@example.com");
  await app.press("Open account");
  await app.waitFor("text:Signed in as me@example.com");
  await app.press("label:account-auth-sign-out");
  await app.waitFor("label:account-auth-continue");
});
