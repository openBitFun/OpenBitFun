// The account identity projection (wave 23): every surface shows the
// backend's `account_identity` (the email for an email account, the GitHub
// login for a GitHub account) and nothing else: never the identity service's
// internal `user-<hash>` handle, never the directory's account id.

import { expect, open, test } from "nsh/test";
import { createBackend, fleetDeviceRow, fleetObpHost } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const HANDLE = "user-87b544d554494ceaa50e23d89550a954";
const EMAIL_IDENTITY = { provider: "email", accountId: "email-7", displayName: "me@example.com", initial: "M" };
const GITHUB_IDENTITY = { provider: "github", accountId: "42", displayName: "octocat", initial: "O" };

function identityHost(identity: Record<string, unknown> | null) {
  const base = createBackend();
  const invoke = base.handlers["openbitfun.invoke"];
  base.handlers["openbitfun.invoke"] = (data: unknown) => {
    const action = ((data ?? {}) as { action?: string }).action ?? "";
    if (action === "account_status") {
      return { ok: true, value: identity ? { logged_in: true, user_id: identity.accountId } : { logged_in: false, user_id: null }, transport: "dev" };
    }
    if (action === "account_identity") return { ok: true, value: identity, transport: "dev" };
    return invoke(data);
  };
  return base;
}

function noHandle(texts: string[]): boolean {
  return !texts.some(text => text.includes(HANDLE) || text.includes("email-7") || text.includes("@user-"));
}

test("the sidebar account row shows the email and its initial", async () => {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: identityHost(EMAIL_IDENTITY).handlers } });
  await app.waitFor("label:account-row >> text:me@example.com");
  expect(app.shows("label:account-row >> text:M")).toBe(true);
  expect(noHandle(app.texts())).toBe(true);
});

test("a GitHub account shows its login through the same projection", async () => {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: identityHost(GITHUB_IDENTITY).handlers } });
  await app.waitFor("label:account-row >> text:octocat");
  expect(app.shows("label:account-row >> text:O")).toBe(true);
  expect(app.texts().some(text => text.includes("@octocat"))).toBe(false);
});

test("Settings › Account names the account by the projection", async () => {
  const backend = identityHost(EMAIL_IDENTITY);
  const host = fleetObpHost(backend, {
    fleet: { protocol: 1, cursorState: {}, deviceId: "dev-a" },
    navigator: {
      revision: 1,
      full: true,
      devices: [fleetDeviceRow("dev-a", "MacBook", [])],
      removedDeviceIds: [],
      totals: { running: 0, waiting: 0, unread: 0 },
    },
  });
  const app = await open("./fixtures/settingsApp.tsx", { ...DESKTOP, host: { handlers: host.handlers } });
  await app.press("nav-settings-page-profile");
  await app.waitFor("text:Signed in as me@example.com");
  expect(noHandle(app.texts())).toBe(true);
});
