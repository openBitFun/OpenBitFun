// Devices › Use on phone or in a browser.
//
// A phone or another computer uses this desktop by opening the OpenBitFun web
// controller (or the phone app) and signing in with the same account: it lists
// the account's devices and connects through the server gateway, end-to-end
// encrypted to this backend (`src/controller/`). Nothing is paired and no
// network value is shown, so the panel only points at the address. The old
// EasyTier-app route (`mesh_phone_join_info`) and the mesh pairing QR are
// retired.

import { signal } from "nsh";
import { invokeCommand } from "./bridge";

/** The web controller's address on the OpenBitFun domain. */
export const WEB_CONTROLLER_URL = "https://remote.openbitfun.com/app/";

/** The address as the panel prints it (no scheme, no trailing slash). */
export function webControllerLabel(url: string = WEB_CONTROLLER_URL): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}


/**
 * A phone app or browser signed in to this account right now: a controller
 * node of the account's device network (it drives devices and serves no
 * backend, so it is never an unreachable device). The backend names the role
 * (`mesh_list_devices` `role: "controller"`); older backends name none.
 */
export interface SignedInController {
  deviceId: string;
  name: string | null;
  route: string | null;
  relayVia: string | null;
  path: string | null;
  latencyMs: number | null;
}

/** The controllers signed in now; `null` when this backend cannot say (no mesh, not the owner). */
export const signedInControllers = signal<SignedInController[] | null>(null);

export async function loadSignedInControllers(): Promise<void> {
  try {
    const rows = await invokeCommand<Array<Record<string, unknown>>>("mesh_list_devices");
    const text = (value: unknown) => (typeof value === "string" && value ? value : null);
    signedInControllers.set(
      (Array.isArray(rows) ? rows : [])
        .filter(row => row && row.role === "controller")
        .map(row => ({
          deviceId: text(row.deviceId) ?? "",
          name: text(row.name),
          route: text(row.route),
          relayVia: text(row.relayVia),
          path: text(row.path),
          latencyMs: typeof row.latencyMs === "number" ? row.latencyMs : null,
        })),
    );
  } catch {
    signedInControllers.set(null);
  }
}
