// Review launcher (wave 5): the "Review changes" sheet and the `/review` command.
//
// The host owns everything a Review is made of — which changes form the target,
// the evidence, the run manifest, the prompt and the child session the read-only
// reviewer runs in (`launch_review`). This store only collects the user's choices
// (ordinary or strict, which changed files, an optional focus), asks the host for
// a dry-run reading of that scope, launches, and opens the child session the host
// created. A host without the command gets the "update the host" sentence; a
// remote workspace gets the host's own refusal, never a local fallback.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";
import { tr, type MessageKey } from "./i18n";
import { isMissingCommand } from "./settingsMutations";
import {
  activeSessionId,
  activeWorkspace,
  navigateScene,
  refreshSessionsSilently,
  selectSession,
  sessions,
} from "./state";
import { pushToast } from "./ui/overlays";

export type ReviewIntent = "review" | "strict";

export interface ReviewLaunchFile {
  path: string;
  previousPath?: string;
  status: string;
}

/** The host's answer, dry run or launch. */
export interface ReviewLaunchAnswer {
  status: "prepared" | "started" | "uncertain" | "refused";
  code?: string;
  message?: string;
  intent: ReviewIntent;
  mode?: string;
  agentType?: string;
  fileCount: number;
  changedLineCount?: number;
  completeness?: string;
  limitations?: string[];
  files?: ReviewLaunchFile[];
  paths?: string[];
  requestId?: string;
  childSessionId?: string;
  childSessionName?: string;
}

export const reviewLauncherOpen = signal(false);
export const reviewIntent = signal<ReviewIntent>("review");
export const reviewFocus = signal("");
/** Every change the host listed for the whole workspace, in its order. */
export const reviewAllFiles = signal<ReviewLaunchFile[]>([]);
/** Paths left out of the scope; empty means every change. */
export const reviewExcluded = signal<string[]>([]);
/** The host's reading of the current scope. */
export const reviewPreview = signal<ReviewLaunchAnswer | null>(null);
export const reviewPreviewLoading = signal(false);
export const reviewLaunching = signal(false);
/** Why the sheet cannot launch right now (refusal, host update, failure); empty otherwise. */
export const reviewNotice = signal("");
/** The host has no `launch_review`: the sheet says so and offers no launch. */
export const reviewUnsupported = signal(false);

let previewTicket = 0;
// One id per sheet: a retry after an unacknowledged start finds the child the
// host already created instead of starting a second reviewer.
let launchRequestId = "";

function newRequestId(): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `review_${Date.now().toString(36)}_${random}`;
}

const REFUSAL_KEYS: Record<string, MessageKey> = {
  review_no_workspace_changes: "review.refusal.noChanges",
  review_path_outside_workspace: "review.refusal.outsideWorkspace",
  review_scope_missing: "review.refusal.scopeMissing",
  review_scope_unchanged: "review.refusal.scopeUnchanged",
  review_target_too_large: "review.refusal.tooLarge",
  review_remote_workspace_unsupported: "review.refusal.remoteWorkspace",
  review_not_git_repository: "review.refusal.notGitRepository",
};

/** The sentence a refusal shows: this surface's copy for codes it knows, else the host's. */
export function reviewRefusalText(answer: ReviewLaunchAnswer): string {
  const key = answer.code ? REFUSAL_KEYS[answer.code] : undefined;
  if (!key) return answer.message ?? tr("review.refusal.generic");
  return tr(key, {
    count: answer.fileCount,
    paths: (answer.paths ?? []).join(", "),
  });
}

/** Whether a composer line is a Review command (`/review`, `/review strict …`, `/DeepReview …`). */
export function isReviewCommand(text: string): boolean {
  return /^\/(review|deepreview|deep[-_]review)(\s|$)/i.test(text.trim());
}

/** The scope the host is asked for: the included paths, or `[]` for every change. */
export function reviewScopePaths(): string[] {
  const excluded = new Set(reviewExcluded());
  if (excluded.size === 0) return [];
  return reviewAllFiles()
    .map(file => file.path)
    .filter(path => !excluded.has(path));
}

export function reviewSelectedCount(): number {
  const excluded = new Set(reviewExcluded());
  return reviewAllFiles().filter(file => !excluded.has(file.path)).length;
}

function scopeRequest(): Record<string, unknown> | null {
  const parentSessionId = activeSessionId();
  if (!parentSessionId) return null;
  const workspace = activeWorkspace();
  return {
    parentSessionId,
    ...(workspace?.id ? { workspaceId: workspace.id } : {}),
    ...(workspace?.rootPath ? { workspacePath: workspace.rootPath } : {}),
    intent: reviewIntent(),
    files: reviewScopePaths(),
    focus: reviewFocus().trim(),
  };
}

function reportFailure(error: unknown): void {
  if (isMissingCommand(error, "launch_review")) {
    reviewUnsupported.set(true);
    reviewNotice.set(tr("review.hostUpdateRequired"));
    return;
  }
  reviewNotice.set(error instanceof Error ? error.message : String(error));
}

/** Asks the host to read the current scope without creating anything. */
export async function previewReview(): Promise<void> {
  const request = scopeRequest();
  if (!request) return;
  const ticket = ++previewTicket;
  reviewPreviewLoading.set(true);
  try {
    const answer = await invokeCommand<ReviewLaunchAnswer>("launch_review", { ...request, dryRun: true });
    if (ticket !== previewTicket) return;
    reviewUnsupported.set(false);
    reviewPreview.set(answer);
    // The unscoped reading is the list the user narrows from.
    if ((request.files as string[]).length === 0) reviewAllFiles.set(answer.files ?? []);
    reviewNotice.set(answer.status === "refused" ? reviewRefusalText(answer) : "");
  } catch (error) {
    if (ticket !== previewTicket) return;
    reviewPreview.set(null);
    reportFailure(error);
  } finally {
    if (ticket === previewTicket) reviewPreviewLoading.set(false);
  }
}

/** Opens the sheet for the session on screen and reads its workspace changes. */
export function openReviewLauncher(options: { intent?: ReviewIntent; focus?: string } = {}): void {
  reviewIntent.set(options.intent ?? "review");
  reviewFocus.set(options.focus ?? "");
  reviewExcluded.set([]);
  reviewAllFiles.set([]);
  reviewPreview.set(null);
  reviewNotice.set("");
  reviewLaunching.set(false);
  launchRequestId = newRequestId();
  reviewLauncherOpen.set(true);
  void previewReview();
}

export function closeReviewLauncher(): void {
  previewTicket += 1;
  reviewLauncherOpen.set(false);
  reviewPreviewLoading.set(false);
}

export function chooseReviewIntent(intent: ReviewIntent): void {
  if (reviewIntent() === intent) return;
  reviewIntent.set(intent);
  void previewReview();
}

export function toggleReviewFile(path: string): void {
  const excluded = reviewExcluded();
  reviewExcluded.set(excluded.includes(path) ? excluded.filter(item => item !== path) : [...excluded, path]);
  void previewReview();
}

export function includeAllReviewFiles(): void {
  if (reviewExcluded().length === 0) return;
  reviewExcluded.set([]);
  void previewReview();
}

/** Shows the child session the host created and started. */
async function openReviewChild(answer: ReviewLaunchAnswer, intent: ReviewIntent): Promise<void> {
  const childId = answer.childSessionId;
  if (!childId) return;
  if (!sessions().some(row => row.sessionId === childId)) {
    sessions.update(rows => [
      {
        sessionId: childId,
        sessionName: answer.childSessionName ?? childName(intent),
        agentType: answer.agentType,
        lastActiveAt: Date.now(),
      },
      ...rows,
    ]);
  }
  navigateScene("sessions");
  selectSession(childId);
  void refreshSessionsSilently();
}

function childName(intent: ReviewIntent): string {
  return intent === "strict" ? tr("review.childNameStrict") : tr("review.childName");
}

async function runLaunch(request: Record<string, unknown>, intent: ReviewIntent): Promise<ReviewLaunchAnswer | null> {
  const answer = await invokeCommand<ReviewLaunchAnswer>("launch_review", {
    ...request,
    requestId: launchRequestId || newRequestId(),
    childSessionName: childName(intent),
    displayMessage: intent === "strict" ? tr("review.displayStrict") : tr("review.displayStandard"),
  });
  if (answer.status === "refused") {
    reviewNotice.set(reviewRefusalText(answer));
    return answer;
  }
  await openReviewChild(answer, intent);
  if (answer.status === "uncertain") pushToast(tr("review.uncertain"), "warning", 5200);
  return answer;
}

/** Launches the Review the sheet describes. */
export async function launchReviewFromSheet(): Promise<void> {
  const request = scopeRequest();
  if (!request || reviewLaunching() || reviewUnsupported()) return;
  reviewLaunching.set(true);
  reviewNotice.set("");
  try {
    const answer = await runLaunch(request, reviewIntent());
    if (answer && answer.status !== "refused") {
      launchRequestId = "";
      closeReviewLauncher();
    }
  } catch (error) {
    reportFailure(error);
  } finally {
    reviewLaunching.set(false);
  }
}

/**
 * Runs a typed `/review …` line for the session on screen. The host reads the
 * line (intent and focus); a refusal or an older host opens the sheet, where the
 * reason is shown and the scope can be changed. Returns whether it handled the line.
 */
export async function launchReviewFromCommand(text: string): Promise<boolean> {
  const parentSessionId = activeSessionId();
  if (!parentSessionId || !isReviewCommand(text)) return false;
  const workspace = activeWorkspace();
  launchRequestId = newRequestId();
  const intent: ReviewIntent = /^\/(deepreview|deep[-_]review)\b|^\/review\s+strict\b/i.test(text.trim())
    ? "strict"
    : "review";
  try {
    const answer = await runLaunch(
      {
        parentSessionId,
        ...(workspace?.id ? { workspaceId: workspace.id } : {}),
        ...(workspace?.rootPath ? { workspacePath: workspace.rootPath } : {}),
        commandText: text.trim(),
      },
      intent,
    );
    if (answer?.status === "refused") {
      const notice = reviewNotice();
      openReviewLauncher({ intent });
      reviewNotice.set(notice);
    }
  } catch (error) {
    openReviewLauncher({ intent });
    reportFailure(error);
  }
  return true;
}
