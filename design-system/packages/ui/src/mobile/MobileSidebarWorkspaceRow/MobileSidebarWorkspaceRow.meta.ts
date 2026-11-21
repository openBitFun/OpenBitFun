import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarWorkspaceRowMeta = {
  category: "mobile",
  description: "A 36px workspace row with a rotating chevron; expanding reveals nested session children and deepens the label color.",
  maturity: "stable",
  name: "MobileSidebarWorkspaceRow",
  props: [
    { name: "label", type: "ReactNode" },
    { name: "expanded", type: "boolean" },
    { name: "onExpandChange", type: "(expanded: boolean) => void" },
    { name: "children", type: "ReactNode" },
  ],
  states: ["default", "hover", "focus-visible", "expanded", "collapsed"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.hover",
    "color.sidebar.ink",
    "color.sidebar.muted",
    "color.sidebar.subtle",
    "type.body.md.fontSize",
    "type.body.md.fontWeight",
    "type.body.md.lineHeight",
    "radius.sm",
    "motion.duration.fast",
    "motion.easing.standard",
  ],
} as const satisfies ComponentMeta;
