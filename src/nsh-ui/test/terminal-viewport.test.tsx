import { expect, open, test } from "nsh/test";

test("a new terminal keeps the whole first prompt visible", async () => {
  const app = await open("./fixtures/terminalScene.tsx", { platform: "windows", width: 800, height: 850 });
  async function checkFirstRow(prompt: string) {
    await app.waitFor(prompt);
    expect(app.layout(prompt)?.clipped).toBe(false);
    await app.drag(prompt, { y: 80 });
    await app.drag(prompt, { y: -80 });
    expect(app.layout(prompt)?.clipped).toBe(false);
  }
  await checkFirstRow("terminal-1 %");
  await app.press("New shell");
  await checkFirstRow("terminal-2 %");
});
