// Records the desktop presence windows for `test/desktop-presence.test.tsx`:
// each window still opens as an NSH window (so its content renders headless),
// and the test learns what was opened, changed and closed through the
// `openbitfun.presence` host post. A settled move the test plays arrives as the
// `openbitfun.presenceMove` host event, as the platform's `boundsChange` would.
import { host } from "nsh";
import { installPresenceWindowDriver, type PresenceWindowEvents } from "../../src/desktopPresence";

const events = new Map<string, PresenceWindowEvents>();
const nshDriver = installPresenceWindowDriver(null);

installPresenceWindowDriver({
  open(render, options, windowEvents) {
    events.set(options.id, windowEvents);
    host.post("openbitfun.presence", {
      action: "open",
      id: options.id,
      level: options.level ?? null,
      position: (options.defaultPosition as { x: number; y: number } | undefined) ?? null,
      size: options.defaultSize ?? null,
    });
    const window = nshDriver.open(render, options, windowEvents);
    return {
      set: attributes => {
        host.post("openbitfun.presence", { action: "set", id: options.id, level: attributes.level ?? null });
        window.set(attributes);
      },
      focus: () => {
        host.post("openbitfun.presence", { action: "focus", id: options.id });
        window.focus();
      },
      close: () => {
        host.post("openbitfun.presence", { action: "close", id: options.id });
        events.delete(options.id);
        window.close();
      },
      setSize: size => window.setSize(size),
    };
  },
});

host.on<{ id: string; x: number; y: number; width: number; height: number }>("openbitfun.presenceMove", move => {
  events.get(move.id)?.onBounds?.({ x: move.x, y: move.y, width: move.width, height: move.height });
});
