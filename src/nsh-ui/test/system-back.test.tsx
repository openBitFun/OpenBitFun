// Android's back button and the browser's back return to the previous scene
// instead of leaving the app; at the first scene Android leaves as usual.
import { expect, open, test } from "nsh/test";
import { addressForScene } from "../src/navigationHistory";
import { createBackend, showAllSessions } from "./support";

test("the scene fragment keeps the loader's own parameters", () => {
  expect(addressForScene("https://x.test/app/?d=1#file=app.1.js", "settings")).toBe(
    "https://x.test/app/?d=1#file=app.1.js&scene=settings",
  );
  expect(addressForScene("https://x.test/app/#file=a.js&scene=inbox", "library")).toBe(
    "https://x.test/app/#file=a.js&scene=library",
  );
  expect(addressForScene("https://x.test/app/", "sessions")).toBe("https://x.test/app/#scene=sessions");
});

test("Android's back returns to the previous scene", async () => {
  const backend = createBackend();
  const app = await open("../App.tsx", { width: 400, height: 860, platform: "android", host: { handlers: backend.handlers } });
  await showAllSessions(app, "NSH skeleton");
  await app.press("label:all-sessions-scene >> NSH skeleton >> nth=0");
  await app.waitUntil(() => !app.shows("label:all-sessions-scene"));
  await app.back();
  await app.waitFor("label:all-sessions-scene");
});
