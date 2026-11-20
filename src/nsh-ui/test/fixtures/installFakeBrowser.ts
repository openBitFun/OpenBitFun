// Stand-in web views for the native desktop fixture (`browserApp.tsx`): the
// headless test host shows no web pages, so each page's view is a fake that
// loads, evaluates and takes input the way `WebViewRef` does, and posts what
// it did to the test as `openbitfun.fakeBrowser`.
import { host } from "nsh";
import { installBrowserViewDriver, type BrowserInput, type BrowserPageEvents } from "../../src/browserStore";

function titleOf(url: string): string {
  return `Fake ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

installBrowserViewDriver({
  inputAvailable: true,
  createHandle(label: string, initialUrl: string, events: BrowserPageEvents) {
    let history = [initialUrl];
    let index = 0;
    const facts = (loading: boolean) => ({
      url: history[index],
      title: loading ? "" : titleOf(history[index]),
      loading,
      canGoBack: index > 0,
      canGoForward: index < history.length - 1,
    });
    const visit = () => {
      events.loadStart(facts(true));
      setTimeout(() => events.load(facts(false)), 0);
    };
    const report = (action: string, data: Record<string, unknown> = {}) =>
      host.post("openbitfun.fakeBrowser", { label, action, ...data });
    setTimeout(visit, 0);
    return {
      load: ({ src }) => {
        history = [...history.slice(0, index + 1), src];
        index = history.length - 1;
        report("load", { src });
        visit();
      },
      reload: () => {
        report("reload");
        visit();
      },
      goBack: () => {
        if (index > 0) index -= 1;
        visit();
      },
      goForward: () => {
        if (index < history.length - 1) index += 1;
        visit();
      },
      stopLoading: () => report("stop"),
      injectJavaScript: (script: string) => {
        // A script with a result (`browser.evaluate`) answers with its
        // envelope through the page's message channel, as a real page does.
        const nonce = /__openbitfunEvaluation: nonce/.test(script) ? /const nonce = ("[^"]+");/.exec(script)?.[1] : undefined;
        if (nonce) {
          const evaluated = /\(0, eval\)\(("(?:[^"\\]|\\.)*")\)/.exec(script)?.[1];
          const source = evaluated ? (JSON.parse(evaluated) as string) : "";
          report("evaluate", { script: source });
          const envelope = source.includes("throw")
            ? { ok: false, code: "ERR_NSH_WEBVIEW_SCRIPT", message: "boom" }
            : { ok: true, value: source.includes("document.title") ? titleOf(history[index]) : true };
          setTimeout(() => events.message(JSON.stringify({ __openbitfunEvaluation: JSON.parse(nonce), ...envelope })), 0);
          return;
        }
        report("inject", { script });
        if (script.includes("history.back()") && index > 0) {
          index -= 1;
          visit();
        }
      },
      sendInput: (input: BrowserInput) => report("input", { input }),
    };
  },
});

