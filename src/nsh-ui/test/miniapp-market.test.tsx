import { expect, open, test } from "nsh/test";
import { createMiniAppMarketBackend } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const ORIGIN_STANDUP = {
  "app-standup": { listingId: "lst-standup", releaseId: "lst-standup-r3", releaseNumber: 3, packageSha256: "sha-lst-standup-3" },
};

function marketCalls(backend: ReturnType<typeof createMiniAppMarketBackend>, action: string) {
  return backend.calls.filter(call => call.action === action);
}

/** Spaces is a Library tab (visual spec §4.8): open the Library, then the tab. */
async function openSpaces(app: Awaited<ReturnType<typeof open>>): Promise<void> {
  await app.waitFor("toggle-drawer");
  // A medium window keeps the sidebar as an overlay drawer: open it first.
  if (!app.shows("nav-library") && !app.shows("phone-tab-library")) await app.press("toggle-drawer");
  if (!app.shows("library-tab-spaces")) await app.press(app.shows("nav-library") ? "nav-library" : "phone-tab-library");
  await app.press("library-tab-spaces");
}

async function openMarket(backend: ReturnType<typeof createMiniAppMarketBackend>) {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.waitFor("label:spaces-view-market");
  await app.press("label:spaces-view-market");
  return app;
}

test("market: browses the host catalogue, filters, pages and marks installed listings", async () => {
  const backend = createMiniAppMarketBackend({}, { origins: ORIGIN_STANDUP, secondPage: true });
  const app = await openMarket(backend);

  await app.waitFor("Standup Board");
  expect(app.texts()).toContain("Weather Glance");
  const first = marketCalls(backend, "miniapp_market_browse")[0];
  expect(first.raw).toBe(false);
  expect(first.request).toMatchObject({ query: "", category: "all", sort: "newest", cursor: null, limit: 20 });
  // The installed origins come from the host, read without a request struct.
  const originsCall = marketCalls(backend, "miniapp_market_installed_origins")[0];
  expect(originsCall.raw).toBe(true);
  await app.waitFor("label:market-installed-standup-board");
  expect(app.shows("label:market-installed-weather-glance")).toBe(false);
  // The host's numbers, one quiet line.
  expect(app.texts().some(text => text.includes("1,280 downloads") && text.includes("42 favorites"))).toBe(true);

  // Load more follows the host's cursor and appends.
  await app.press("label:market-load-more");
  await app.waitFor("Later Space");
  expect(marketCalls(backend, "miniapp_market_browse").at(-1)?.request).toMatchObject({ cursor: "page-2" });

  // Typing re-reads with the query after the debounce.
  await app.type("label:market-search", "weather");
  await app.waitUntil(() =>
    marketCalls(backend, "miniapp_market_browse").some(
      call => (call.request as Record<string, unknown>).query === "weather",
    ),
  );
  await app.waitUntil(() => !app.texts().includes("Standup Board"));
  expect(app.texts()).toContain("Weather Glance");

  // Category and sort are host parameters too.
  await app.clear("label:market-search");
  await app.press("label:market-category");
  await app.press("label:market-category-utilities");
  await app.waitUntil(() =>
    marketCalls(backend, "miniapp_market_browse").some(
      call => (call.request as Record<string, unknown>).category === "utilities",
    ),
  );
  await app.press("label:market-sort");
  await app.press("Top rated");
  await app.waitUntil(() =>
    marketCalls(backend, "miniapp_market_browse").some(
      call => (call.request as Record<string, unknown>).sort === "rating",
    ),
  );
});

test("market: listing detail shows host permissions and releases, favorites and rates", async () => {
  const backend = createMiniAppMarketBackend({}, { origins: ORIGIN_STANDUP });
  const app = await openMarket(backend);

  await app.waitFor("label:market-card-standup-board");
  await app.press("label:market-card-standup-board");
  await app.waitFor("Drafts your daily update from yesterday's commits.");
  expect(marketCalls(backend, "miniapp_market_get_listing")[0].request).toMatchObject({ slug: "standup-board" });
  await app.waitUntil(() => marketCalls(backend, "miniapp_market_installed_status").length > 0);
  expect(marketCalls(backend, "miniapp_market_installed_status")[0].request).toMatchObject({ listingId: "lst-standup" });

  expect(app.texts()).toContain("Read files: {workspace}");
  expect(app.texts()).toContain("Use AI models");
  expect(app.texts()).toContain("License: MIT");
  // Releases newest first, three shown, the rest behind a toggle; the yanked one is marked.
  await app.waitFor("label:market-release-4");
  expect(app.shows("label:market-release-1")).toBe(false);
  expect(app.texts()).toContain("Withdrawn");
  await app.press("label:market-releases-toggle");
  await app.waitFor("label:market-release-1");

  // Installed at release 3, the listing is at 4: Update leads, Open is secondary.
  await app.waitFor("label:market-install");
  expect(app.texts()).toContain("Update");
  expect(app.shows("label:market-open")).toBe(true);

  await app.press("label:market-favorite");
  await app.waitUntil(() => marketCalls(backend, "miniapp_market_set_favorite").length === 1);
  expect(marketCalls(backend, "miniapp_market_set_favorite")[0].request).toMatchObject({
    slug: "standup-board",
    enabled: true,
  });
  await app.waitFor("43");

  await app.press("label:market-rate-4");
  await app.waitUntil(() => marketCalls(backend, "miniapp_market_set_rating").length === 1);
  expect(marketCalls(backend, "miniapp_market_set_rating")[0].request).toMatchObject({
    slug: "standup-board",
    value: 4,
  });
  await app.waitFor("4.5 · 19 ratings");
});

test("market: install repeats the request with the confirmation the host asked for", async () => {
  const backend = createMiniAppMarketBackend();
  const app = await openMarket(backend);

  await app.waitFor("label:market-card-weather-glance");
  await app.press("label:market-card-weather-glance");
  await app.waitFor("label:market-install");
  await app.press("label:market-install");
  // The host refuses until the user allows the release's permissions.
  await app.waitFor("label:market-install-prompt");
  expect(backend.marketInstalls[0]).toMatchObject({
    slug: "weather-glance",
    releaseNumber: 1,
    existingAppId: null,
    confirmPermissions: false,
    confirmOverwrite: false,
  });
  expect(app.texts().some(text => text.includes("net.allow:api.open-meteo.com"))).toBe(true);
  await app.press("Allow and install");
  await app.waitFor("Installed Weather Glance.");
  expect(backend.marketInstalls).toHaveLength(2);
  expect(backend.marketInstalls[1]).toMatchObject({ confirmPermissions: true, confirmOverwrite: false });
  // Installed and current: Open leads, no install button.
  await app.waitFor("label:market-detail-installed");
  expect(app.shows("label:market-install")).toBe(false);
  expect(app.shows("label:market-open")).toBe(true);

  // The library re-reads and the card carries the market release.
  await app.press("label:market-close");
  await app.press("label:spaces-view-library");
  await app.waitFor("Weather Glance");
  expect(app.texts().some(text => text.includes("Market release 1"))).toBe(true);
});

test("market: an update over local changes asks before it overwrites", async () => {
  const backend = createMiniAppMarketBackend({}, { origins: ORIGIN_STANDUP, localOverrides: ["app-standup"] });
  const app = await openMarket(backend);

  await app.waitFor("label:market-card-standup-board");
  await app.press("label:market-card-standup-board");
  await app.waitFor("The installed copy has local changes.");
  await app.press("label:market-install");
  await app.waitFor("Replace local changes");
  expect(backend.marketInstalls[0]).toMatchObject({ existingAppId: "app-standup", confirmOverwrite: false });
  await app.press("Replace local changes");
  await app.waitFor("Updated Standup Board.");
  expect(backend.marketInstalls[1]).toMatchObject({
    existingAppId: "app-standup",
    releaseNumber: 4,
    confirmOverwrite: true,
  });
});

test("market: personal actions ask for sign-in instead of calling the market", async () => {
  const backend = createMiniAppMarketBackend({}, { signedIn: false });
  const app = await openMarket(backend);

  await app.waitFor("label:market-card-standup-board");
  await app.press("label:market-card-standup-board");
  await app.waitFor("label:market-favorite");
  await app.press("label:market-favorite");
  await app.waitFor("label:market-sign-in");
  expect(marketCalls(backend, "miniapp_market_set_favorite")).toHaveLength(0);
});

test("market: the market's own 401 envelope becomes the sign-in prompt", async () => {
  const backend = createMiniAppMarketBackend({}, { favoriteUnauthorized: true });
  const app = await openMarket(backend);

  await app.waitFor("label:market-card-standup-board");
  await app.press("label:market-card-standup-board");
  await app.waitFor("label:market-favorite");
  await app.press("label:market-favorite");
  await app.waitFor("label:market-sign-in");
  expect(marketCalls(backend, "miniapp_market_set_favorite")).toHaveLength(1);
});

test("market: a host without the market says so instead of showing an empty catalogue", async () => {
  const backend = createMiniAppMarketBackend({}, { marketMissing: true });
  const app = await openMarket(backend);

  await app.waitFor("label:market-unsupported");
  expect(app.texts()).toContain("This host has no Space market");
  expect(app.texts().some(text => text.includes("Update OpenBitFun on that machine"))).toBe(true);
  expect(app.shows("label:market-empty")).toBe(false);
});

test("submissions: lists the account's submissions and withdraws one after confirmation", async () => {
  const backend = createMiniAppMarketBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.press("label:spaces-view-submissions");

  await app.waitFor("Focus Timer");
  expect(marketCalls(backend, "miniapp_market_list_submissions")[0].raw).toBe(true);
  expect(app.texts()).toContain("In review");
  expect(app.texts()).toContain("Rejected");
  expect(app.texts()).toContain("Reason: Asks for shell access it does not use.");
  // Only drafts and submissions under review can be withdrawn.
  expect(app.shows("label:submission-withdraw-sub-2")).toBe(false);
  expect(app.texts().some(text => text.includes("publish new releases from the OpenBitFun market website"))).toBe(true);

  await app.press("label:submission-withdraw-sub-1");
  await app.waitFor("Withdraw Focus Timer from review?");
  expect(marketCalls(backend, "miniapp_market_withdraw_submission")).toHaveLength(0);
  await app.press("Withdraw >> nth=1");
  await app.waitUntil(() => marketCalls(backend, "miniapp_market_withdraw_submission").length === 1);
  expect(marketCalls(backend, "miniapp_market_withdraw_submission")[0].request).toMatchObject({
    submissionId: "sub-1",
  });
  await app.waitFor("label:submission-status-sub-1");
  await app.waitUntil(() => !app.shows("label:submission-withdraw-sub-1"));
});

test("submissions: signed out shows a sign-in state and reads nothing", async () => {
  const backend = createMiniAppMarketBackend({}, { signedIn: false });
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.press("label:spaces-view-submissions");
  await app.waitFor("label:submissions-sign-in");
  expect(marketCalls(backend, "miniapp_market_list_submissions")).toHaveLength(0);
});

test("package import: the host inspects the package before it installs it", async () => {
  const backend = createMiniAppMarketBackend();
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.waitFor("label:spaces-import-package");
  await app.press("label:spaces-import-package");
  await app.waitFor("label:package-import-path");

  await app.type("label:package-import-path", "/tmp/pocket.zip");
  await app.press("label:package-import-inspect");
  await app.waitFor("Select a .bfminiapp package.");

  await app.clear("label:package-import-path");
  await app.type("label:package-import-path", "/tmp/pocket.bfminiapp");
  await app.press("label:package-import-inspect");
  await app.waitFor("Pocket Notes");
  expect(marketCalls(backend, "miniapp_market_inspect_package").at(-1)?.request).toMatchObject({
    path: "/tmp/pocket.bfminiapp",
  });
  expect(app.texts()).toContain("System notifications");
  expect(app.texts()).toContain("Grants: notifications.system");
  expect(marketCalls(backend, "miniapp_market_import_package")).toHaveLength(0);

  await app.press("label:package-import-confirm");
  await app.waitFor("Imported Pocket Notes.");
  expect(marketCalls(backend, "miniapp_market_import_package")[0].request).toMatchObject({
    path: "/tmp/pocket.bfminiapp",
    confirmPermissions: true,
  });
});

test("market: a narrower window keeps the toolbar, catalogue and detail usable", async () => {
  const backend = createMiniAppMarketBackend();
  const app = await open("../App.tsx", { width: 800, height: 860, platform: "macos" as const, host: { handlers: backend.handlers } });
  await openSpaces(app);
  await app.waitFor("label:spaces-view-market");
  await app.press("label:spaces-view-market");
  await app.waitFor("label:market-card-standup-board");
  expect(app.shows("label:market-search")).toBe(true);
  expect(app.shows("label:market-category")).toBe(true);
  await app.press("label:market-card-standup-board");
  await app.waitFor("label:market-install");
});
