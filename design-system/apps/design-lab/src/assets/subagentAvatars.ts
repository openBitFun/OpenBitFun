// Design Lab owns the preview catalog of the authored subagent character family.
// The artwork lives with the other brand assets in @openbitfun/ui; this file only
// enumerates it (no runtime product code). Keep the legacy `robot-XX` ids and the
// `subagent-identity-v1` seed unchanged: they map sessions to characters.
import robot01 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-01.svg";
import robot02 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-02.svg";
import robot03 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-03.svg";
import robot04 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-04.svg";
import robot05 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-05.svg";
import robot06 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-06.svg";
import robot07 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-07.svg";
import robot08 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-08.svg";
import robot09 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-09.svg";
import robot10 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-10.svg";
import robot11 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-11.svg";
import robot12 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-12.svg";
import robot13 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-13.svg";
import robot14 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-14.svg";
import robot15 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-15.svg";
import robot16 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-16.svg";
import robot17 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-17.svg";
import robot18 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-18.svg";
import robot19 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-19.svg";
import robot20 from "../../../../packages/ui/src/brand/assets/subagent-avatars/robot-20.svg";

export const SUBAGENT_AVATAR_CATALOG_VERSION = "subagent-identity-v1";

export const SUBAGENT_AVATAR_CATALOG = [
  { id: "robot-01", src: robot01 },
  { id: "robot-02", src: robot02 },
  { id: "robot-03", src: robot03 },
  { id: "robot-04", src: robot04 },
  { id: "robot-05", src: robot05 },
  { id: "robot-06", src: robot06 },
  { id: "robot-07", src: robot07 },
  { id: "robot-08", src: robot08 },
  { id: "robot-09", src: robot09 },
  { id: "robot-10", src: robot10 },
  { id: "robot-11", src: robot11 },
  { id: "robot-12", src: robot12 },
  { id: "robot-13", src: robot13 },
  { id: "robot-14", src: robot14 },
  { id: "robot-15", src: robot15 },
  { id: "robot-16", src: robot16 },
  { id: "robot-17", src: robot17 },
  { id: "robot-18", src: robot18 },
  { id: "robot-19", src: robot19 },
  { id: "robot-20", src: robot20 },
] as const;

export type SubagentAvatarId = typeof SUBAGENT_AVATAR_CATALOG[number]["id"];
