// The shared atoms (visual spec §3) as a screen draws them: state marks and
// their words, quiet device badges, the tile-less device glyph, the dot
// variants, the tooltip that a phone tap must not leave behind, and the
// AttentionItem shell's collapsed, answered and unanswerable states.
import { expect, open, test } from "nsh/test";

const DESKTOP = { width: 1440, height: 900, platform: "macos" as const };
const GALLERY = "./fixtures/foundationsGallery.tsx";

test("every state draws its word, which is also the mark's label", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Foundations");
  for (const word of ["Working", "Needs you", "Done", "Failed", "Idle", "Stopped", "Queued", "Waiting for linux-box", "Thinking…"]) {
    expect([word, app.shows(`text:${word}`)]).toEqual([word, true]);
    expect([word, app.shows(`label:${word}`)]).toEqual([word, true]);
  }
  // A seen "done" keeps its word but loses its color.
  expect(app.spanStyle("id:mark-done >> text:Done").color).not.toBe(app.spanStyle("id:mark-done-seen >> text:Done").color);
  expect(app.shows("text:Working · 2 min")).toBe(true);
});

test("the state words follow the locale", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.press("Use Chinese");
  await app.waitFor("text:需要你处理");
  expect(app.shows("text:等待 linux-box")).toBe(true);
  expect(app.shows("text:· 离线 · 3 h ago")).toBe(true);
});

test("a device badge names only its exception", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Foundations");
  expect(app.shows("id:badge-offline >> text:linux-box")).toBe(true);
  expect(app.shows("id:badge-offline >> text:· Offline · 3 h ago")).toBe(true);
  expect(app.shows("id:badge-update >> text:· Update needed")).toBe(true);
  // A healthy device draws its name and nothing else.
  expect(app.shows("id:badge-healthy >> text:studio-mac")).toBe(true);
  expect(app.shows("id:badge-healthy >> text:· Offline")).toBe(false);
  // The update word is a warning; offline stays muted.
  const update = app.spanStyle("id:badge-update >> text:· Update needed").color;
  const offline = app.spanStyle("id:badge-offline >> text:· Offline · 3 h ago").color;
  expect(update).not.toBe(offline);
});

test("the device glyph is a plain glyph: an idle device gets no tile and no warning dot", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Foundations");
  const glyph = app.viewStyle("id:glyph-idle");
  expect(glyph).not.toBeNull();
  expect(glyph?.backgroundColor ?? null).toBeNull();
  // The old tile drew a status dot over the glyph; idle mapped it to warning.
  const ring = app.viewStyle("id:dot-ring");
  const half = app.viewStyle("id:dot-half");
  const solid = app.viewStyle("id:dot-solid");
  expect(solid?.backgroundColor).toBeTruthy();
  expect(ring?.backgroundColor ?? null).toBeNull();
  expect(half?.backgroundColor ?? null).toBeNull();
});

test("a hover tooltip shows on the desktop and never on a phone", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Foundations");
  await app.hover("Tip button");
  await app.waitFor("text:Gallery tip");

  const phone = await open(GALLERY, { width: 375, height: 812, platform: "web" as const });
  await phone.press("Use compact");
  await phone.press("Tip button");
  await phone.hover("Tip button");
  await phone.wait(800);
  expect(phone.shows("text:Gallery tip")).toBe(false);
});

test("the attention shell collapses a long request, and an answered or unanswerable item drops its actions", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Foundations");
  expect(app.shows("id:attention-open >> text:Fix flaky test")).toBe(true);
  expect(app.shows("id:attention-open >> text:cargo test --workspace")).toBe(true);
  expect(app.shows("id:attention-open >> text:Allow once")).toBe(true);
  expect(app.shows("id:attention-open >> label:Open")).toBe(true);
  await app.press("id:attention-open >> text:Show all");
  expect(app.shows("id:attention-open >> text:Show all")).toBe(false);

  expect(app.shows("id:attention-answered >> text:Answered on linux-box")).toBe(true);
  expect(app.shows("text:Allow twice")).toBe(false);

  expect(app.shows("id:attention-blocked >> text:Update OpenBitFun on linux-box to answer here.")).toBe(true);
  expect(app.shows("text:Allow thrice")).toBe(false);
  expect(app.shows("id:attention-blocked >> label:Open")).toBe(true);
});

test("the empty state is centered text with no box", async () => {
  const app = await open(GALLERY, DESKTOP);
  await app.waitFor("Nothing needs you");
  expect(app.shows("text:Requests from your devices show up here.")).toBe(true);
});
