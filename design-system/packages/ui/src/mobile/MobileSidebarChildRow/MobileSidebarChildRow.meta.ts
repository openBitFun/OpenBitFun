import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarChildRowMeta = {
  category: "mobile",
  description: "A 36px indented child row beneath an expanded workspace, led by a 6px status dot and rendered in muted ink.",
  maturity: "stable",
  name: "MobileSidebarChildRow",
  props: [
    { name: "label", type: "ReactNode" },
    { defaultValue: "false", name: "selected", type: "boolean" },
  ],
  states: ["default", "hover", "focus-visible", "selected"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.hover",
    "color.sidebar.ink",
    "color.sidebar.muted",
    "color.sidebar.subtle",
    "type.body.sm.fontSize",
    "type.body.sm.fontWeight",
    "type.body.sm.lineHeight",
    "radius.sm",
    "motion.duration.fast",
    "motion.easing.standard",
  ],
} as const satisfies ComponentMeta;
