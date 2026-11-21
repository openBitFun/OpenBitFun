// One short line saying how OpenBitFun Link reaches a device or a signed-in
// phone, from the generic `route` / `path` fields of `mesh_list_devices` (never
// from the mesh implementation).

import { tr } from "./i18n";

/** The routes a backend names for a mesh device (`mesh_list_devices` `route`). */
export type MeshRoute = "direct_lan" | "direct_ipv4" | "direct_ipv6" | "relayed_peer" | "relayed_server";

/** The fields of one `mesh_list_devices` row the path line reads. */
export interface MeshPathFacts {
  reachable: boolean;
  /** `"p2p" | "relayed"`; every backend sends it. */
  path?: string;
  /** How the mesh reaches the device (`MeshRoute`); newer backends only. */
  route?: string;
  /** The account device id relaying the traffic when `route` is `relayed_peer` (when the backend names it). */
  relayVia?: string | null;
  latencyMs?: number;
}

/**
 * The path line. `nameOf` resolves the relaying device's directory name. A
 * backend that sends only `path` gets the coarse line; a device the mesh cannot
 * reach, or one without either field, gets no line (`""`).
 */
export function meshPathLabel(
  entry: MeshPathFacts,
  nameOf: (deviceId: string) => string | null | undefined = () => null,
): string {
  if (!entry.reachable) return "";
  let label = "";
  switch (entry.route) {
    case "direct_lan":
      label = tr("devices.path.sameNetwork");
      break;
    case "direct_ipv6":
      label = tr("devices.path.directIpv6");
      break;
    case "direct_ipv4":
      label = tr("devices.path.direct");
      break;
    case "relayed_peer": {
      const name = entry.relayVia ? nameOf(entry.relayVia)?.trim() : "";
      label = tr("devices.path.viaPeer", { name: name || tr("devices.path.anotherDevice") });
      break;
    }
    case "relayed_server":
      label = tr("devices.path.viaServer");
      break;
    default:
      label =
        entry.path === "p2p"
          ? tr("devices.path.direct")
          : entry.path === "relayed"
            ? tr("devices.path.relayed")
            : "";
  }
  if (!label) return "";
  return typeof entry.latencyMs === "number" && Number.isFinite(entry.latencyMs)
    ? tr("devices.path.withLatency", { path: label, ms: String(Math.max(1, Math.round(entry.latencyMs))) })
    : label;
}
