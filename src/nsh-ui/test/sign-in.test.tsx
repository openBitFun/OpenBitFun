// The desktop sign-in (visual spec §4.1): in the app, like the browser and the
// phone. Continue sends the email code (`account_email_start`), the code step
// completes it (`account_email_verify`), then "{device} is ready". GitHub is the
// secondary option and the only one that opens the browser. Who is signed in
// is the backend's identity projection (`account_identity`): an email account
// shows its email, never its internal handle.
import { expect, open, test } from "nsh/test";
import { createBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const FIXTURE = "./fixtures/signInFixture.tsx";
const HANDLE = "user-87b544d554494ceaa50e23d89550a954";

type Identity = { provider: string; accountId: string; displayName: string; initial: string } | null;

function accountHost(options: { rateLimited?: boolean } = {}) {
  const base = createBackend();
  const invoke = base.handlers["openbitfun.invoke"];
  const calls: string[] = [];
  const requests: Array<{ action: string; request: unknown }> = [];
  let polls = 0;
  let identity: Identity = null;
  const ok = (value: unknown) => ({ ok: true, value, transport: "dev" });
  const fail = (error: string) => ({ ok: false, error });
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const args = (data ?? {}) as { action?: string; request?: unknown };
    const action = args.action ?? "";
    calls.push(action);
    requests.push({ action, request: args.request });
    switch (action) {
      case "account_status":
        // The directory's account id is never what the shell shows.
        return ok(identity ? { logged_in: true, user_id: identity.accountId } : { logged_in: false, user_id: null });
      case "account_identity":
        return ok(identity);
      case "account_email_start":
        if (options.rateLimited) return fail("rate_limited: Too many verification requests.");
        return ok({ challengeId: "ch-1", email: "me@example.com", codeLength: 8, retryAfterSeconds: 60, expiresAt: null });
      case "account_email_verify": {
        const request = (args.request ?? {}) as { challengeId?: string; code?: string };
        if (request.code !== "12345678") return fail("invalid_code: The verification code is incorrect.");
        identity = { provider: "email", accountId: "email-7", displayName: "me@example.com", initial: "M" };
        return ok({ identity });
      }
      case "account_github_start":
        return ok({ transactionId: "txn-1", authorizationUrl: "https://github.com/login/oauth/authorize?state=1", interval: 5 });
      case "account_github_poll":
        polls += 1;
        if (polls === 1) return ok({ status: "pending" });
        identity = { provider: "github", accountId: "42", displayName: "octocat", initial: "O" };
        return ok({ status: "authorized" });
      case "account_logout":
        identity = null;
        return ok(null);
      default:
        return invoke(data);
    }
  };
  return { base, calls, requests };
}

test("first run: email, then the code, in the app, then the device is ready", async () => {
  const { base, calls, requests } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });

  await app.waitFor("label:account-auth-email-input");
  expect(app.shows("text:Use on this device only")).toBe(true);
  expect(app.shows("label:account-auth-github")).toBe(true);

  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.waitFor("text:Check your email");
  await app.waitFor("text:Enter the code we sent to me@example.com.");
  expect(requests.find(entry => entry.action === "account_email_start")?.request).toMatchObject({
    email: "me@example.com",
    locale: "en-US",
  });
  // No browser: nothing was opened and the GitHub sign-in never started.
  expect(app.openedUrls()).toEqual([]);
  expect(calls).not.toContain("account_github_start");

  // The code as the mail groups it; complete, it signs in without a press.
  await app.type("account-auth-code-input", "1234 5678");
  await app.waitFor("label:account-auth-ready");
  expect(requests.find(entry => entry.action === "account_email_verify")?.request).toEqual({
    challengeId: "ch-1",
    code: "12345678",
  });
  await app.press("label:account-auth-start");
  await app.waitFor("text:welcome done");
});

test("a wrong code says so and can be typed again; another email goes back", async () => {
  const { base } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.type("account-auth-code-input", "00000000");
  await app.press("label:account-auth-verify");
  await app.waitFor("text:That code didn't work. Check it or send a new one.");
  // Another code waits for the service's retry-after.
  await app.waitFor("text:Send a new code in 60 s");
  await app.press("label:account-auth-other-email");
  await app.waitFor("label:account-auth-email-input");
});

test("refusals are worded by their code", async () => {
  const { base } = accountHost({ rateLimited: true });
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.waitFor("text:Too many attempts. Wait a minute and try again.");
});

test("use on this device only leaves the sign-in without an account", async () => {
  const { base, calls } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.waitFor("label:account-auth-local-only");
  await app.press("label:account-auth-local-only");
  await app.waitFor("text:local only");
  expect(calls).not.toContain("account_email_start");
  expect(calls).not.toContain("account_github_start");
});

test("the account dialog signs in with the code and names the account by its email", async () => {
  const { base } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.press("label:account-auth-local-only");
  await app.press("Open account");
  await app.waitFor("label:account-auth-modal");
  await app.type("account-auth-email-input", "me@example.com");
  await app.press("label:account-auth-continue");
  await app.type("account-auth-code-input", "12345678");
  // Signed in: the dialog closes with a toast; reopened, it names the account.
  await app.waitFor("text:Signed in as me@example.com");
  await app.press("Open account");
  await app.waitFor("text:Signed in as me@example.com");
  expect(app.texts().some(text => text.includes(HANDLE) || text.includes("email-7"))).toBe(false);
  await app.press("label:account-auth-sign-out");
  await app.waitFor("label:account-auth-continue");
});

test("GitHub is the secondary sign-in and the only one in the browser", async () => {
  const { base } = accountHost();
  const app = await open(FIXTURE, { ...DESKTOP, host: { handlers: base.handlers } });
  await app.press("label:account-auth-local-only");
  await app.press("Open account");
  await app.press("label:account-auth-github");
  await app.waitFor("text:Finish in your browser");
  expect(app.openedUrls()).toContain("https://github.com/login/oauth/authorize?state=1");
  await app.press("label:home-github-poll");
  await app.press("label:home-github-poll");
  await app.waitFor("text:Signed in as octocat");
});
