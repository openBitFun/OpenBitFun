// Test stand-in for a backend-served page: the shared UI over the backend
// protocol (`webSocketConnection.ts`) and the browser-tab shell, with the
// socket carried over the test's host channel. Each frame the UI sends goes to
// the `openbitfun.obpSend` host call, which answers with the frames the
// backend would send back; pushed frames arrive as `openbitfun.obpFrames`.

import { host } from "nsh";
import { installWebSocketBackend } from "../../src/servedBackend";
import type { ObpSocket } from "../../src/webSocketConnection";

function createHostSocket(url: string): ObpSocket {
  const socket: ObpSocket = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data: string) {
      void host.call<string[]>("openbitfun.obpSend", { url, frame: data }, { timeout: 0 }).then(
        replies => {
          for (const reply of replies ?? []) socket.onmessage?.({ data: reply });
        },
        () => socket.onclose?.({ code: 1006, reason: "host refused" }),
      );
    },
    close(code?: number, reason?: string) {
      (socket as { readyState: number }).readyState = 3;
      socket.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
    },
  };
  host.on<string[]>("openbitfun.obpFrames", frames => {
    for (const frame of frames) socket.onmessage?.({ data: frame });
  });
  setTimeout(() => {
    (socket as { readyState: number }).readyState = 1;
    socket.onopen?.({});
  }, 0);
  return socket;
}

installWebSocketBackend("ws://127.0.0.1:47610/obp", { createSocket: createHostSocket });
