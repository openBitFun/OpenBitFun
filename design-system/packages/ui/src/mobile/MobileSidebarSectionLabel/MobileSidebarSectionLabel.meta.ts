import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarSectionLabelMeta = {
  category: "mobile",
  description: "A 28px-tall muted section heading with 0.02em letter spacing and an optional trailing action such as an add button.",
  maturity: "stable",
  name: "MobileSidebarSectionLabel",
  props: [
    { name: "children", type: "ReactNode" },
    { name: "action", type: "ReactNode" },
  ],
  states: ["default", "hover"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.subtle",
    "color.sidebar.hover",
    "color.sidebar.ink",
    "type.label.xs.fontSize",
    "type.label.xs.fontWeight",
    "type.label.xs.lineHeight",
  ],
} as const satisfies ComponentMeta;
