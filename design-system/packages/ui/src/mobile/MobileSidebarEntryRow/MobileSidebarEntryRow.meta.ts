import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarEntryRowMeta = {
  category: "mobile",
  description: "An assistant or mini-app entry row that pairs an 18px icon or mascot image with a muted label.",
  maturity: "stable",
  name: "MobileSidebarEntryRow",
  props: [
    { name: "icon", type: "ReactNode" },
    { name: "label", type: "ReactNode" },
  ],
  states: ["default", "hover", "focus-visible"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.hover",
    "color.sidebar.ink",
    "color.sidebar.muted",
    "type.body.md.fontSize",
    "type.body.md.fontWeight",
    "type.body.md.lineHeight",
    "radius.sm",
    "motion.duration.fast",
    "motion.easing.standard",
  ],
} as const satisfies ComponentMeta;
