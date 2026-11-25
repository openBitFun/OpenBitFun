// The platform's own "back" for the app's scene history (`navHistory` in
// state.ts). A phone or a browser has a system back the desktop does not:
// without this, Android's back button leaves the app from any screen and the
// browser's back leaves the page, instead of returning to the previous scene.
//
// - Android: `BackHandler`'s press goes back one scene while there is one;
//   at the first scene it is not handled, so the system leaves the app as usual.
//   Modals and sheets still close first (NSH runs their back before ours).
// - Web: each scene the user moves to gets a history entry (`scene=` in the
//   page's fragment), so the browser's back and forward move through scenes.
// Desktops and iOS have no system back for scenes and install nothing.

import { cleanup, effect, platform, untracked, UrlScheme } from "nsh";
import { BackHandler } from "nsh/mobile";
import { goBackScene, goForwardScene, navHistory, navIndex } from "./state";

function installAndroidBack(): void {
  const stop = BackHandler.on("press", () => {
    if (untracked(navIndex) <= 0) return false;
    goBackScene();
    return true;
  });
  cleanup(stop);
}

/**
 * The page's address with `scene=<scene>` in its fragment. The fragment's
 * other parameters stay: the web loader reads its own there (`file=`), and a
 * reload must find them.
 */
export function addressForScene(url: string, scene: string): string {
  const hash = url.indexOf("#");
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const params = new URLSearchParams(hash >= 0 ? url.slice(hash + 1) : "");
  params.set("scene", scene);
  return `${base}#${params.toString()}`;
}

function installWebHistory(): void {
  let synced = untracked(navIndex);
  // The browser moved: the scene follows, and the entry it moved to stays.
  let browserMoves = 0;
  const stop = UrlScheme.on("change", change => {
    if (change.reason === "back" && untracked(navIndex) > 0) {
      browserMoves += 1;
      goBackScene();
    } else if (change.reason === "forward" && untracked(navIndex) < untracked(navHistory).length - 1) {
      browserMoves += 1;
      goForwardScene();
    }
  });
  cleanup(stop);
  effect(() => {
    const index = navIndex();
    const scene = navHistory()[index];
    untracked(() => {
      if (browserMoves > 0) {
        browserMoves -= 1;
        synced = index;
        return;
      }
      const url = UrlScheme.url();
      if (!url || !scene) return;
      // A scene the user moved to is an entry of its own; an in-app back
      // replaces the entry it leaves, so the browser never shows a stale one.
      UrlScheme.setUrl(addressForScene(url, scene), { history: index > synced ? "push" : "replace" });
      synced = index;
    });
  });
}

/** Installs the system back for scenes on the platforms that have one. Call from the app root. */
export function installSystemBack(): void {
  if (platform.os === "android") installAndroidBack();
  else if (platform.os === "web") installWebHistory();
}
