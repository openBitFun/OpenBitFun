import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarSessionRowMeta = {
  category: "mobile",
  description: "A 40px recent-session row in deep ink with an optional 6px running/error status dot and a timestamp that fades in on hover.",
  maturity: "stable",
  name: "MobileSidebarSessionRow",
  props: [
    { name: "label", type: "ReactNode" },
    { name: "status", type: "\"running\" | \"error\"" },
    { name: "time", type: "ReactNode" },
    { defaultValue: "false", name: "selected", type: "boolean" },
  ],
  states: ["default", "hover", "focus-visible", "selected"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.hover",
    "color.sidebar.selection",
    "color.sidebar.ink",
    "color.sidebar.deep",
    "color.sidebar.subtle",
    "color.status.danger.emphasis",
    "color.status.success.emphasis",
    "type.body.lg.fontSize",
    "type.body.lg.fontWeight",
    "type.body.lg.lineHeight",
    "type.label.xs.fontSize",
    "type.label.xs.fontWeight",
    "type.label.xs.lineHeight",
    "radius.sm",
    "motion.duration.fast",
    "motion.easing.standard",
  ],
} as const satisfies ComponentMeta;
