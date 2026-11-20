// MiniApp market (Spaces > Market / Submissions) state and host commands.
//
// The market is the host's: `miniapp_market_browse` pages the catalogue,
// `miniapp_market_get_listing` reads one listing (with this account's rating and
// favourite), `miniapp_market_installed_status` / `miniapp_market_installed_origins`
// say which listing is installed here, and `miniapp_market_install` downloads,
// verifies and installs a release. The host decides whether an install needs a
// permission or overwrite confirmation and refuses until it gets one; this store
// shows that refusal as a prompt and repeats the request with the flag the user
// granted, instead of computing a permission diff of its own. Everything runs on
// the backend this surface drives (a peer, when one is selected): a Space installs
// on that machine.

import { signal } from "nsh";
import { invokeCommand, invokeRawCommand } from "./bridge";
import { isCommandUnavailable } from "./hostCommands";
import { isAuthRequiredError, tr } from "./i18n";
import { isAccountSignedIn, loadAccountState } from "./homeStore";
import { peerScope } from "./peerState";
import { loadSpaces, openSpaceWindow, spaceWindowBlockedReason } from "./spacesStore";
import { activeWorkspace } from "./state";
import { pushToast } from "./ui/overlays";

export type SpacesView = "library" | "market" | "submissions";
export type MarketSort = "newest" | "downloads" | "rating";

/** The catalogue categories the market accepts (`MARKET_CATEGORIES`), plus `all`. */
export const MARKET_CATEGORIES = [
  "all",
  "developer",
  "productivity",
  "data",
  "creative",
  "education",
  "utilities",
  "entertainment",
  "other",
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export const MARKET_PAGE_SIZE = 20;
/** Release rows shown before "Show all releases". */
export const MARKET_RELEASES_COLLAPSED = 3;

export interface MarketPermissions {
  fs?: { read?: string[]; write?: string[] };
  shell?: { allow?: string[] };
  net?: { allow?: string[] };
  node?: { enabled?: boolean };
  ai?: { enabled?: boolean };
  agent?: { enabled?: boolean };
  notifications?: { system?: boolean };
  host?: Record<string, boolean>;
}

export interface MarketListing {
  listingId: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  ownerLogin: string;
  latestRelease: number;
  minOpenBitFunVersion: string;
  permissions: MarketPermissions;
  ratingAverage: number;
  ratingCount: number;
  favoriteCount: number;
  downloadCount: number;
  publishedAt: number;
  isFavorited: boolean | null;
  myRating: number | null;
}

export interface MarketRelease {
  releaseId: string;
  releaseNumber: number;
  minOpenBitFunVersion: string;
  changelog: string;
  publishedAt: number;
  yanked: boolean;
}

export interface MarketListingDetail extends MarketListing {
  changelog: string;
  license: string;
  repositoryUrl: string;
  releases: MarketRelease[];
}

export interface MarketOrigin {
  listingId: string;
  releaseId: string;
  releaseNumber: number;
}

export interface MarketInstalledStatus {
  appId: string;
  origin: MarketOrigin;
  localOverride: boolean;
}

export type MarketSubmissionStatus = "draft" | "submitted" | "approved" | "rejected" | "withdrawn";

export interface MarketSubmission {
  submissionId: string;
  slug: string;
  name: string;
  icon: string;
  releaseNumber: number;
  status: MarketSubmissionStatus | string;
  rejectionReason: string;
  updatedAt: number;
}

export interface MarketPackageInspection {
  name: string;
  description: string;
  packageSha256: string;
  permissions: MarketPermissions;
  /** Permission ids the host reports as added by this package. */
  added: string[];
}

/** What the host asked the user to confirm before it installs. */
export type MarketInstallPrompt =
  | { kind: "permissions"; detail: string; confirm: InstallConfirm }
  | { kind: "overwrite"; confirm: InstallConfirm };

interface InstallConfirm {
  permissions: boolean;
  overwrite: boolean;
}

// ── View ──────────────────────────────────────────────────────────────────────
export const spacesView = signal<SpacesView>("library");

// ── Catalogue ─────────────────────────────────────────────────────────────────
export const marketQuery = signal("");
export const marketCategory = signal<MarketCategory>("all");
export const marketSort = signal<MarketSort>("newest");
export const marketItems = signal<MarketListing[]>([]);
export const marketNextCursor = signal<string | null>(null);
export const marketLoading = signal(false);
export const marketLoadingMore = signal(false);
/** True until the first catalogue read of this view answered. */
export const marketInitialLoad = signal(true);
export const marketError = signal("");
/** The host has no market commands at all (an older backend or peer). */
export const marketUnsupported = signal(false);
/** Listing id -> installed origin, from `miniapp_market_installed_origins`. */
export const marketOrigins = signal<Record<string, MarketOrigin & { appId: string }>>({});

// ── Listing detail ────────────────────────────────────────────────────────────
export const marketDetailSlug = signal<string | null>(null);
export const marketDetail = signal<MarketListingDetail | null>(null);
export const marketDetailLoading = signal(false);
export const marketDetailError = signal("");
export const marketInstalled = signal<MarketInstalledStatus | null>(null);
export const marketActionBusy = signal(false);
export const marketInstalling = signal(false);
export const marketReleasesExpanded = signal(false);
export const marketInstallPrompt = signal<MarketInstallPrompt | null>(null);
/** Set when the host answered that the market needs a signed-in account. */
export const marketSignInRequired = signal(false);

// ── Submissions ───────────────────────────────────────────────────────────────
export const submissions = signal<MarketSubmission[]>([]);
export const submissionsLoading = signal(false);
export const submissionsLoaded = signal(false);
export const submissionsError = signal("");
export const submissionsSignInRequired = signal(false);
export const withdrawingSubmissionId = signal<string | null>(null);
export const confirmingWithdrawId = signal<string | null>(null);

// ── Package import ────────────────────────────────────────────────────────────
export const packageImportOpen = signal(false);
export const packageImportPath = signal("");
export const packageInspection = signal<MarketPackageInspection | null>(null);
export const packageImportBusy = signal(false);
export const packageImportError = signal("");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * The market adapter answers its client errors as JSON (`{ code, message }`);
 * the install transaction answers plain sentences. Both read as one message.
 */
export function marketErrorMessage(error: unknown): string {
  const text = errorText(error).trim();
  if (text.startsWith("{")) {
    try {
      const parsed = asRecord(JSON.parse(text));
      const message = str(parsed.message);
      if (message) return message;
    } catch {
      // Not JSON after all: the text itself is the message.
    }
  }
  return text;
}

/** Whether the host refused because the market needs a signed-in account. */
export function isMarketAuthError(error: unknown): boolean {
  const text = errorText(error);
  if (text.startsWith("{")) {
    try {
      const code = str(asRecord(JSON.parse(text)).code).toLowerCase();
      if (/unauthori[sz]ed|unauthenticated|auth_required|login_required|not_signed_in|sign_in_required/.test(code)) {
        return true;
      }
    } catch {
      // Fall through to the text rules.
    }
  }
  return isAuthRequiredError(marketErrorMessage(error));
}

function normalizePermissions(value: unknown): MarketPermissions {
  return asRecord(value) as MarketPermissions;
}

export function normalizeListing(raw: unknown): MarketListing {
  const rec = asRecord(raw);
  const owner = asRecord(rec.owner);
  const favorited = rec.isFavorited;
  const myRating = rec.myRating;
  return {
    listingId: str(rec.listingId),
    slug: str(rec.slug),
    name: str(rec.name) || str(rec.slug),
    description: str(rec.description),
    icon: str(rec.icon) || "box",
    category: str(rec.category) || "other",
    tags: strings(rec.tags),
    ownerLogin: str(owner.login),
    latestRelease: num(rec.latestRelease),
    minOpenBitFunVersion: str(rec.minOpenBitFunVersion),
    permissions: normalizePermissions(rec.permissions),
    ratingAverage: num(rec.ratingAverage),
    ratingCount: num(rec.ratingCount),
    favoriteCount: num(rec.favoriteCount),
    downloadCount: num(rec.downloadCount),
    publishedAt: num(rec.publishedAt),
    isFavorited: typeof favorited === "boolean" ? favorited : null,
    myRating: typeof myRating === "number" && myRating >= 1 && myRating <= 5 ? myRating : null,
  };
}

function normalizeDetail(raw: unknown): MarketListingDetail {
  const rec = asRecord(raw);
  const license = asRecord(rec.license);
  const releases = (Array.isArray(rec.releases) ? rec.releases : []).map(item => {
    const release = asRecord(item);
    return {
      releaseId: str(release.releaseId),
      releaseNumber: num(release.releaseNumber),
      minOpenBitFunVersion: str(release.minOpenBitFunVersion),
      changelog: str(release.changelog),
      publishedAt: num(release.publishedAt),
      yanked: release.yanked === true,
    };
  });
  // The host lists releases in its own order; newest first is how both the
  // desktop and this view read them, so sort by the number the host sent.
  releases.sort((a, b) => b.releaseNumber - a.releaseNumber);
  return {
    ...normalizeListing(rec),
    changelog: str(rec.changelog),
    license: str(license.spdxExpression) || str(license.customUrl),
    repositoryUrl: str(rec.repositoryUrl),
    releases,
  };
}

function normalizeOrigin(raw: unknown): MarketOrigin {
  const rec = asRecord(raw);
  return {
    listingId: str(rec.listingId),
    releaseId: str(rec.releaseId),
    releaseNumber: num(rec.releaseNumber),
  };
}

function normalizeSubmission(raw: unknown): MarketSubmission {
  const rec = asRecord(raw);
  return {
    submissionId: str(rec.submissionId),
    slug: str(rec.slug),
    name: str(rec.name) || str(rec.slug),
    icon: str(rec.icon) || "box",
    releaseNumber: num(rec.releaseNumber),
    status: str(rec.status) || "draft",
    rejectionReason: str(rec.rejectionReason),
    updatedAt: num(rec.updatedAt) || num(rec.createdAt),
  };
}

/** "Update the host" when the backend has no such command, else the host's own message. */
function describeFailure(error: unknown, command: string): string {
  if (isCommandUnavailable(error, command)) return tr("market.hostOutdated");
  return marketErrorMessage(error);
}

// ── Catalogue reads ───────────────────────────────────────────────────────────

let browseTicket = 0;

/** Reads the first catalogue page for the current query, category and sort. */
export async function loadMarket(): Promise<void> {
  const ticket = ++browseTicket;
  marketLoading.set(true);
  marketError.set("");
  try {
    const page = asRecord(
      await invokeCommand<unknown>("miniapp_market_browse", {
        query: marketQuery().trim(),
        category: marketCategory(),
        sort: marketSort(),
        cursor: null,
        limit: MARKET_PAGE_SIZE,
      }),
    );
    if (ticket !== browseTicket) return;
    marketUnsupported.set(false);
    marketItems.set((Array.isArray(page.items) ? page.items : []).map(normalizeListing).filter(item => item.slug));
    marketNextCursor.set(str(page.nextCursor) || null);
  } catch (error) {
    if (ticket !== browseTicket) return;
    marketItems.set([]);
    marketNextCursor.set(null);
    marketUnsupported.set(isCommandUnavailable(error, "miniapp_market_browse"));
    marketError.set(describeFailure(error, "miniapp_market_browse"));
  } finally {
    if (ticket === browseTicket) {
      marketLoading.set(false);
      marketInitialLoad.set(false);
    }
  }
}

/** Appends the next page the host offered (`nextCursor`). */
export async function loadMoreMarket(): Promise<void> {
  const cursor = marketNextCursor();
  if (!cursor || marketLoadingMore() || marketLoading()) return;
  const ticket = browseTicket;
  marketLoadingMore.set(true);
  try {
    const page = asRecord(
      await invokeCommand<unknown>("miniapp_market_browse", {
        query: marketQuery().trim(),
        category: marketCategory(),
        sort: marketSort(),
        cursor,
        limit: MARKET_PAGE_SIZE,
      }),
    );
    if (ticket !== browseTicket) return;
    const seen = new Set(marketItems().map(item => item.listingId));
    const next = (Array.isArray(page.items) ? page.items : [])
      .map(normalizeListing)
      .filter(item => item.slug && !seen.has(item.listingId));
    marketItems.update(items => [...items, ...next]);
    marketNextCursor.set(str(page.nextCursor) || null);
  } catch (error) {
    pushToast(tr("market.loadMoreFailed", { error: marketErrorMessage(error) }), "error");
  } finally {
    marketLoadingMore.set(false);
  }
}

let queryTimer: ReturnType<typeof setTimeout> | null = null;

/** Typing re-reads after 180 ms, as the desktop's catalogue does. */
export function setMarketQuery(value: string): void {
  marketQuery.set(value);
  if (queryTimer !== null) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => {
    queryTimer = null;
    void loadMarket();
  }, 180);
}

export function setMarketCategory(value: MarketCategory): void {
  if (marketCategory() === value) return;
  marketCategory.set(value);
  void loadMarket();
}

export function setMarketSort(value: MarketSort): void {
  if (marketSort() === value) return;
  marketSort.set(value);
  void loadMarket();
}

/** Which listings are installed on the host (keyed by listing id). */
export async function loadMarketOrigins(): Promise<void> {
  try {
    const raw = asRecord(await invokeRawCommand<unknown>("miniapp_market_installed_origins", {}));
    const byListing: Record<string, MarketOrigin & { appId: string }> = {};
    for (const [appId, value] of Object.entries(raw)) {
      const origin = normalizeOrigin(value);
      if (origin.listingId) byListing[origin.listingId] = { ...origin, appId };
    }
    marketOrigins.set(byListing);
  } catch {
    // An older host cannot say which listings are installed; the cards then
    // carry no "Installed" mark and the detail asks per listing.
    marketOrigins.set({});
  }
}

/** Entering the Market view: the catalogue, the installed origins, the account. */
export function enterMarket(): void {
  void loadMarket();
  void loadMarketOrigins();
  void loadAccountState().catch(() => undefined);
}

// ── Listing detail ────────────────────────────────────────────────────────────

let detailTicket = 0;

export async function openMarketListing(slug: string): Promise<void> {
  if (!slug) return;
  const ticket = ++detailTicket;
  marketDetailSlug.set(slug);
  marketDetail.set(null);
  marketInstalled.set(null);
  marketDetailError.set("");
  marketInstallPrompt.set(null);
  marketSignInRequired.set(false);
  marketReleasesExpanded.set(false);
  marketDetailLoading.set(true);
  try {
    const detail = normalizeDetail(await invokeCommand<unknown>("miniapp_market_get_listing", { slug }));
    if (ticket !== detailTicket) return;
    marketDetail.set(detail);
    await refreshInstalledStatus(detail.listingId, ticket);
  } catch (error) {
    if (ticket !== detailTicket) return;
    marketDetailError.set(describeFailure(error, "miniapp_market_get_listing"));
  } finally {
    if (ticket === detailTicket) marketDetailLoading.set(false);
  }
}

async function refreshInstalledStatus(listingId: string, ticket = detailTicket): Promise<void> {
  try {
    const raw = await invokeCommand<unknown>("miniapp_market_installed_status", { listingId });
    if (ticket !== detailTicket) return;
    if (!raw) {
      marketInstalled.set(null);
      return;
    }
    const rec = asRecord(raw);
    marketInstalled.set({
      appId: str(rec.appId),
      origin: normalizeOrigin(rec.origin),
      localOverride: rec.localOverride === true,
    });
  } catch {
    if (ticket !== detailTicket) return;
    // Without the status the detail offers a fresh install; the host itself
    // refuses an install that would collide with an installed copy.
    marketInstalled.set(null);
  }
}

export function closeMarketListing(): void {
  detailTicket += 1;
  marketDetailSlug.set(null);
  marketDetail.set(null);
  marketInstalled.set(null);
  marketDetailError.set("");
  marketInstallPrompt.set(null);
  marketSignInRequired.set(false);
  marketDetailLoading.set(false);
}

/** Re-reads the open listing (its rating and favourite are per account). */
export async function refreshMarketListing(): Promise<void> {
  const slug = marketDetailSlug();
  if (!slug) return;
  const ticket = detailTicket;
  try {
    const detail = normalizeDetail(await invokeCommand<unknown>("miniapp_market_get_listing", { slug }));
    if (ticket === detailTicket) marketDetail.set(detail);
  } catch {
    // The listing on screen stays as it was.
  }
}

/**
 * Whether the user must sign in before a personal action. Only this machine's
 * account is known here: while a peer is driven its own account answers, so the
 * request goes through and the peer's refusal (if any) is shown.
 */
function needsLocalSignIn(): boolean {
  return !peerScope() && !isAccountSignedIn();
}

function applyListingPatch(patch: Partial<MarketListing>): void {
  const detail = marketDetail();
  if (!detail) return;
  marketDetail.set({ ...detail, ...patch });
  marketItems.update(items => items.map(item => (item.listingId === detail.listingId ? { ...item, ...patch } : item)));
}

function handlePersonalActionError(error: unknown): void {
  if (isMarketAuthError(error)) {
    marketSignInRequired.set(true);
    return;
  }
  pushToast(tr("market.actionFailed", { error: marketErrorMessage(error) }), "error");
}

export async function toggleMarketFavorite(): Promise<void> {
  const detail = marketDetail();
  if (!detail || marketActionBusy()) return;
  if (needsLocalSignIn()) {
    marketSignInRequired.set(true);
    return;
  }
  marketActionBusy.set(true);
  try {
    const result = asRecord(
      await invokeCommand<unknown>("miniapp_market_set_favorite", {
        slug: detail.slug,
        enabled: !(detail.isFavorited === true),
      }),
    );
    applyListingPatch({ isFavorited: result.isFavorited === true, favoriteCount: num(result.count) });
  } catch (error) {
    handlePersonalActionError(error);
  } finally {
    marketActionBusy.set(false);
  }
}

/** Rates the open listing 1–5; pressing the current rating again clears it (`value: null`). */
export async function rateMarketListing(value: number): Promise<void> {
  const detail = marketDetail();
  if (!detail || marketActionBusy()) return;
  if (needsLocalSignIn()) {
    marketSignInRequired.set(true);
    return;
  }
  marketActionBusy.set(true);
  try {
    const next = detail.myRating === value ? null : value;
    const result = asRecord(
      await invokeCommand<unknown>("miniapp_market_set_rating", { slug: detail.slug, value: next }),
    );
    const mine = result.myRating;
    applyListingPatch({
      ratingAverage: num(result.average),
      ratingCount: num(result.count),
      myRating: typeof mine === "number" ? mine : null,
    });
  } catch (error) {
    handlePersonalActionError(error);
  } finally {
    marketActionBusy.set(false);
  }
}

/** Whether the listing has a newer release than the installed copy. */
export function marketCanUpdate(): boolean {
  const detail = marketDetail();
  const installed = marketInstalled();
  return Boolean(detail && installed && detail.latestRelease > installed.origin.releaseNumber);
}

/** Whether the installed release was yanked from the market. */
export function marketInstalledYanked(): boolean {
  const detail = marketDetail();
  const installed = marketInstalled();
  if (!detail || !installed) return false;
  return detail.releases.some(release => release.releaseId === installed.origin.releaseId && release.yanked);
}

/**
 * Why this listing cannot be installed or opened here, or "". A Space that
 * reads or writes `{workspace}` runs against a local workspace; the desktop
 * refuses it in a remote one, and so does this view.
 */
export function marketWorkspaceBlockedReason(detail: MarketListing | null = marketDetail()): string {
  if (!detail) return "";
  const workspace = activeWorkspace();
  if (!workspace || workspace.workspaceKind !== "remote") return "";
  const fs = detail.permissions.fs ?? {};
  const paths = [...(fs.read ?? []), ...(fs.write ?? [])];
  return paths.includes("{workspace}") ? tr("market.remoteWorkspaceUnsupported") : "";
}

const PERMISSION_PREFIX = "Permission confirmation required:";

/**
 * Installs (or updates) the open listing's latest release. The host asks for a
 * confirmation by refusing: `Permission confirmation required: …` when the
 * release adds or widens permissions, and a local-customisation refusal when an
 * update would overwrite local edits. Each refusal becomes a prompt whose
 * confirm repeats the request with that flag granted.
 */
export async function installMarketListing(
  confirm: InstallConfirm = { permissions: false, overwrite: false },
): Promise<void> {
  const detail = marketDetail();
  if (!detail || marketInstalling()) return;
  const blocked = marketWorkspaceBlockedReason(detail);
  if (blocked) {
    pushToast(blocked, "error");
    return;
  }
  const installed = marketInstalled();
  marketInstallPrompt.set(null);
  marketInstalling.set(true);
  try {
    const result = asRecord(
      await invokeCommand<unknown>("miniapp_market_install", {
        slug: detail.slug,
        releaseNumber: detail.latestRelease,
        existingAppId: installed?.appId ?? null,
        confirmPermissions: confirm.permissions,
        confirmOverwrite: confirm.overwrite,
      }),
    );
    const app = asRecord(result.app);
    const origin = normalizeOrigin(result.origin);
    const appId = str(app.id);
    marketInstalled.set({ appId, origin, localOverride: false });
    if (origin.listingId) {
      marketOrigins.update(current => ({ ...current, [origin.listingId]: { ...origin, appId } }));
    }
    pushToast(
      tr(result.updated === true ? "market.updated" : "market.installed", { name: str(app.name) || detail.name }),
      "success",
    );
    void loadSpaces();
  } catch (error) {
    const message = marketErrorMessage(error);
    if (message.startsWith(PERMISSION_PREFIX)) {
      marketInstallPrompt.set({
        kind: "permissions",
        detail: message.slice(PERMISSION_PREFIX.length).trim(),
        confirm,
      });
    } else if (/local customi[sz]ations/i.test(message) && !confirm.overwrite) {
      marketInstallPrompt.set({ kind: "overwrite", confirm });
    } else if (isMarketAuthError(error)) {
      marketSignInRequired.set(true);
    } else {
      pushToast(tr("market.installFailed", { error: describeFailure(error, "miniapp_market_install") }), "error");
    }
  } finally {
    marketInstalling.set(false);
  }
}

/** The user granted what the prompt asked; repeat the install with that flag. */
export function confirmMarketInstallPrompt(): void {
  const prompt = marketInstallPrompt();
  if (!prompt) return;
  const next =
    prompt.kind === "permissions"
      ? { ...prompt.confirm, permissions: true }
      : { ...prompt.confirm, overwrite: true };
  void installMarketListing(next);
}

export function cancelMarketInstallPrompt(): void {
  marketInstallPrompt.set(null);
}

/** Opens the installed copy in its own Space window. */
export function openInstalledMarketApp(): void {
  const installed = marketInstalled();
  if (!installed?.appId) return;
  const blocked = spaceWindowBlockedReason();
  if (blocked) {
    pushToast(blocked, "error");
    return;
  }
  void openSpaceWindow(installed.appId);
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function loadSubmissions(): Promise<void> {
  submissionsLoading.set(true);
  submissionsError.set("");
  submissionsSignInRequired.set(false);
  try {
    if (!peerScope()) {
      await loadAccountState().catch(() => undefined);
      if (!isAccountSignedIn()) {
        submissions.set([]);
        submissionsSignInRequired.set(true);
        return;
      }
    }
    const raw = await invokeRawCommand<unknown>("miniapp_market_list_submissions", {});
    submissions.set((Array.isArray(raw) ? raw : []).map(normalizeSubmission).filter(item => item.submissionId));
  } catch (error) {
    submissions.set([]);
    if (isMarketAuthError(error)) {
      submissionsSignInRequired.set(true);
    } else {
      submissionsError.set(describeFailure(error, "miniapp_market_list_submissions"));
    }
  } finally {
    submissionsLoading.set(false);
    submissionsLoaded.set(true);
  }
}

/** The market lets an author withdraw a draft or a submission under review. */
export function canWithdrawSubmission(status: string): boolean {
  return status === "draft" || status === "submitted";
}

export async function withdrawSubmission(submissionId: string): Promise<void> {
  if (!submissionId || withdrawingSubmissionId()) return;
  confirmingWithdrawId.set(null);
  withdrawingSubmissionId.set(submissionId);
  try {
    const updated = normalizeSubmission(
      await invokeCommand<unknown>("miniapp_market_withdraw_submission", { submissionId }),
    );
    submissions.update(list =>
      list.map(item => (item.submissionId === submissionId ? { ...item, ...updated, submissionId } : item)),
    );
    pushToast(tr("market.submissions.withdrawn"), "success");
  } catch (error) {
    pushToast(
      tr("market.submissions.withdrawFailed", {
        error: describeFailure(error, "miniapp_market_withdraw_submission"),
      }),
      "error",
    );
  } finally {
    withdrawingSubmissionId.set(null);
  }
}

// ── Package import ────────────────────────────────────────────────────────────

/**
 * Why a package cannot be imported here, or "". The package path is read by the
 * backend; while a peer is driven that is the peer's filesystem, which the
 * desktop refuses rather than resolve a controller path there.
 */
export function packageImportBlockedReason(): string {
  if (peerScope()) return tr("market.import.peerUnsupported");
  return "";
}

export function openPackageImport(): void {
  packageImportOpen.set(true);
  packageImportPath.set("");
  packageInspection.set(null);
  packageImportError.set("");
}

export function closePackageImport(): void {
  if (packageImportBusy()) return;
  packageImportOpen.set(false);
  packageInspection.set(null);
  packageImportError.set("");
}

export function setPackageImportPath(value: string): void {
  packageImportPath.set(value);
  packageInspection.set(null);
  packageImportError.set("");
}

/** Asks the host to validate the package and report what it would grant. */
export async function inspectPackage(): Promise<void> {
  const path = packageImportPath().trim();
  if (!path || packageImportBusy()) return;
  const blocked = packageImportBlockedReason();
  if (blocked) {
    packageImportError.set(blocked);
    return;
  }
  packageImportBusy.set(true);
  packageImportError.set("");
  try {
    const raw = asRecord(await invokeCommand<unknown>("miniapp_market_inspect_package", { path }));
    const diff = asRecord(raw.permissionDiff);
    packageInspection.set({
      name: str(raw.name),
      description: str(raw.description),
      packageSha256: str(raw.packageSha256),
      permissions: normalizePermissions(raw.permissions),
      added: [...strings(diff.added), ...strings(diff.expanded)],
    });
  } catch (error) {
    packageInspection.set(null);
    packageImportError.set(describeFailure(error, "miniapp_market_inspect_package"));
  } finally {
    packageImportBusy.set(false);
  }
}

/** Imports the inspected package; the user saw the host's permission list. */
export async function importInspectedPackage(): Promise<void> {
  const path = packageImportPath().trim();
  if (!path || !packageInspection() || packageImportBusy()) return;
  packageImportBusy.set(true);
  packageImportError.set("");
  try {
    const app = asRecord(
      await invokeCommand<unknown>("miniapp_market_import_package", { path, confirmPermissions: true }),
    );
    pushToast(tr("market.import.imported", { name: str(app.name) || packageInspection()?.name || "" }), "success");
    packageImportBusy.set(false);
    closePackageImport();
    void loadSpaces();
  } catch (error) {
    packageImportError.set(describeFailure(error, "miniapp_market_import_package"));
  } finally {
    packageImportBusy.set(false);
  }
}

// ── Display helpers (formatting host data, no derivation) ─────────────────────

/** One localized line per permission the listing declares, in the desktop's order. */
export function marketPermissionLines(permissions: MarketPermissions): string[] {
  const lines: string[] = [];
  const join = (values?: string[]) => (values ?? []).join(", ");
  if (permissions.fs?.read?.length) lines.push(tr("market.perm.fsRead", { value: join(permissions.fs.read) }));
  if (permissions.fs?.write?.length) lines.push(tr("market.perm.fsWrite", { value: join(permissions.fs.write) }));
  if (permissions.shell?.allow?.length) lines.push(tr("market.perm.shell", { value: join(permissions.shell.allow) }));
  if (permissions.net?.allow?.length) lines.push(tr("market.perm.net", { value: join(permissions.net.allow) }));
  if (permissions.node?.enabled) lines.push(tr("market.perm.node"));
  if (permissions.ai?.enabled) lines.push(tr("market.perm.ai"));
  if (permissions.agent?.enabled) lines.push(tr("market.perm.agent"));
  if (permissions.notifications?.system) lines.push(tr("market.perm.notifications"));
  const host = permissions.host ?? {};
  if (host.dialog) lines.push(tr("market.perm.dialog"));
  if (host.clipboard_read) lines.push(tr("market.perm.clipboardRead"));
  if (host.clipboard_write) lines.push(tr("market.perm.clipboardWrite"));
  if (host.open_external) lines.push(tr("market.perm.openExternal"));
  if (host.reveal_in_folder) lines.push(tr("market.perm.revealInFolder"));
  if (host.deck_render) lines.push(tr("market.perm.deckRender"));
  if (host.chat_composer) lines.push(tr("market.perm.chatComposer"));
  if (host.system_info) lines.push(tr("market.perm.systemInfo"));
  return lines;
}

export function marketCategoryLabel(category: string): string {
  switch (category) {
    case "all":
      return tr("market.cat.all");
    case "developer":
      return tr("market.cat.developer");
    case "productivity":
      return tr("market.cat.productivity");
    case "data":
      return tr("market.cat.data");
    case "creative":
      return tr("market.cat.creative");
    case "education":
      return tr("market.cat.education");
    case "utilities":
      return tr("market.cat.utilities");
    case "entertainment":
      return tr("market.cat.entertainment");
    default:
      return tr("market.cat.other");
  }
}

export function submissionStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return tr("market.submissions.statusDraft");
    case "submitted":
      return tr("market.submissions.statusSubmitted");
    case "approved":
      return tr("market.submissions.statusApproved");
    case "rejected":
      return tr("market.submissions.statusRejected");
    case "withdrawn":
      return tr("market.submissions.statusWithdrawn");
    default:
      return status;
  }
}
