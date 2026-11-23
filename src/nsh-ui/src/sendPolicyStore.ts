// What the composer does with a message written while a turn is still running.
//
// The desktop surface stores this as `app.flow_chat.send_during_turn` and offers
// two policies: queue it until the running turn finishes (the default) or send
// it into the running turn (live steering). The host skips the field while the
// policy is the default, so an absent value means `queue`.
//
// It lives in its own store rather than in the settings table because the
// composer reads it on every send, not only while the Settings scene is open.

import { signal } from "nsh";
import { getConfig, setConfig } from "./api";
import { runStep } from "./state";

export type MidTurnSendPolicy = "immediate" | "queue";

export const MID_TURN_POLICIES: ReadonlyArray<{
  value: MidTurnSendPolicy;
  label: string;
  hint: string;
}> = [
  { value: "queue", label: "Queue", hint: "A message written during a turn waits until it finishes" },
  { value: "immediate", label: "Steer now", hint: "A message written during a turn reaches that turn" },
];

const CONFIG_PATH = "app.flow_chat.send_during_turn";

export const midTurnSendPolicy = signal<MidTurnSendPolicy>("queue");
export const sendPolicyNotice = signal("");

let requested = false;

/** Reads the policy once; repeated calls are free. */
export function ensureSendPolicy(): void {
  if (requested) return;
  requested = true;
  void loadSendPolicy();
}

export async function loadSendPolicy(): Promise<void> {
  requested = true;
  await runStep(async () => {
    try {
      const stored = await getConfig(CONFIG_PATH, true);
      midTurnSendPolicy.set(stored === "immediate" ? "immediate" : "queue");
    } catch {
      // A host that does not store the field applies its own default.
      midTurnSendPolicy.set("queue");
    }
  });
}

export async function chooseMidTurnSendPolicy(policy: MidTurnSendPolicy): Promise<void> {
  await runStep(async () => {
    try {
      await setConfig(CONFIG_PATH, policy);
      midTurnSendPolicy.set(policy);
      const label = MID_TURN_POLICIES.find(entry => entry.value === policy)?.label ?? policy;
      sendPolicyNotice.set(`Saved ${label}`);
    } catch (error) {
      sendPolicyNotice.set(error instanceof Error ? error.message : String(error));
    }
  });
}
