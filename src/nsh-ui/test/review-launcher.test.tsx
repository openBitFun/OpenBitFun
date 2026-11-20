// Review launcher (wave 5): the "Review changes" sheet and `/review` ask the
// host's `launch_review` for everything — the dry-run reading of the changes,
// the refusals, and the child session the read-only reviewer runs in. The
// surface only sends the user's choices and opens the child it is given.

import { expect, open, test } from "nsh/test";
import { createBackend, withReviewLaunchFixtures } from "./support";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };

async function openSession(backend: { handlers: Record<string, (data: unknown) => unknown> }) {
  const app = await open("../App.tsx", { ...DESKTOP, host: { handlers: backend.handlers } });
  await app.waitFor("NSH skeleton");
  await app.press("NSH skeleton >> nth=0");
  await app.waitFor("Port the session list.");
  return app;
}

test("the sheet reads the changes, launches a strict review and opens its child session", async () => {
  const backend = withReviewLaunchFixtures(createBackend());
  const app = await openSession(backend);

  await app.press("thread-actions-trigger");
  await app.press("review-launch-open");
  await app.waitFor("label:review-launcher");
  await app.waitFor("text:src/old_name.rs → src/new_name.rs");
  await app.waitFor("text:3 files · 21 changed lines");
  expect(backend.reviewRequests[0]).toMatchObject({
    parentSessionId: "session-1",
    workspaceId: "workspace-1",
    intent: "review",
    files: [],
    dryRun: true,
  });

  // Strict, one file left out, a focus: the host reads the narrowed scope again.
  await app.press("review-intent-strict");
  await app.waitFor("text:A deeper read-only review with an independent quality check. Takes longer and uses more tokens.");
  await app.press("label:review-file-src/review.rs");
  await app.waitFor("label:review-include-all");
  await app.type("review-focus", "Check the rename for lost history");
  await app.waitUntil(() => backend.reviewRequests.some(request =>
    request.dryRun === true && JSON.stringify(request.files) === JSON.stringify(["src/lib.rs", "src/new_name.rs"]),
  ));

  await app.press("review-start");
  await app.waitUntil(() => backend.reviewRequests.some(request => request.dryRun !== true));
  const launch = backend.reviewRequests.find(request => request.dryRun !== true)!;
  expect(launch).toMatchObject({
    parentSessionId: "session-1",
    intent: "strict",
    files: ["src/lib.rs", "src/new_name.rs"],
    focus: "Check the rename for lost history",
    childSessionName: "Review: Strict",
    displayMessage: "Strict review of the workspace changes",
  });
  expect(String(launch.requestId)).toMatch(/^review_/);
  // The child the host created is the session on screen; the sheet is gone.
  await app.waitUntil(() => !app.shows("label:review-launcher"));
  await app.waitUntil(() =>
    backend.calls.some(call =>
      call.action === "get_session_transcript_view" &&
      String((call.request as Record<string, unknown>)?.sessionId ?? (call.request as Record<string, unknown>)?.session_id ?? "").startsWith("review_child_"),
    ),
  );
  await app.waitFor("Review: Strict");
  // Nothing about the plan was built here: no prompt, no manifest went out.
  expect(JSON.stringify(backend.reviewRequests)).not.toContain("deepReviewRunManifest");
  expect(backend.actions()).not.toContain("create_session");
});

test("/review in the composer is read by the host instead of being sent as a turn", async () => {
  const backend = withReviewLaunchFixtures(createBackend());
  const app = await openSession(backend);

  await app.type("composer", "/review strict watch the locking");
  await app.submit("composer");
  await app.waitUntil(() => backend.reviewRequests.length > 0);
  expect(backend.reviewRequests[0]).toMatchObject({
    parentSessionId: "session-1",
    commandText: "/review strict watch the locking",
    childSessionName: "Review: Strict",
  });
  expect(backend.reviewRequests[0].dryRun).toBeUndefined();
  expect(backend.actions()).not.toContain("submit_user_message");
  expect(app.value("composer")).toBe("");
  await app.waitFor("Review: Strict");
});

test("a target too large for one reviewer is narrowed in the sheet, then launched", async () => {
  const files = Array.from({ length: 82 }, (_, index) => ({ path: `src/f${index}.rs`, status: "modified" }));
  const backend = withReviewLaunchFixtures(createBackend(), { files });
  const app = await openSession(backend);

  await app.press("thread-actions-trigger");
  await app.press("review-launch-open");
  await app.waitFor(
    "text:This change touches 82 files. Review covers up to 80 files in one run; leave some out below, or choose Strict.",
  );
  await app.waitFor("label:review-file-src/f0.rs");
  expect(app.enabled("label:review-start")).toBe(false);

  await app.press("label:review-file-src/f0.rs");
  await app.press("label:review-file-src/f1.rs");
  await app.waitUntil(() => !app.shows("label:review-notice"));
  await app.press("review-start");
  await app.waitUntil(() => backend.reviewRequests.some(request => request.dryRun !== true));
  const launch = backend.reviewRequests.find(request => request.dryRun !== true)!;
  expect((launch.files as string[]).length).toBe(80);
  expect(launch.files).not.toContain("src/f0.rs");
  expect(launch.intent).toBe("review");
});

test("a remote workspace and an older host each say why there is no review", async () => {
  const remote = withReviewLaunchFixtures(
    createBackend({ currentWorkspaceId: "workspace-2" }),
  );
  const first = await open("../App.tsx", { ...DESKTOP, host: { handlers: remote.handlers } });
  await first.waitFor("NSH skeleton");
  await first.press("NSH skeleton >> nth=0");
  await first.press("thread-actions-trigger");
  await first.press("review-launch-open");
  await first.waitFor(
    "text:Review is not available for remote workspaces yet: exact diff evidence is only prepared for a local checkout.",
  );
  expect(first.enabled("label:review-start")).toBe(false);
  expect(remote.reviewRequests.every(request => request.dryRun === true)).toBe(true);

  const older = withReviewLaunchFixtures(createBackend(), { missing: true });
  const second = await openSession(older);
  await second.press("thread-actions-trigger");
  await second.press("review-launch-open");
  await second.waitFor("text:This backend cannot start a Review. Update the OpenBitFun host to use it.");
  expect(second.enabled("label:review-start")).toBe(false);
});
