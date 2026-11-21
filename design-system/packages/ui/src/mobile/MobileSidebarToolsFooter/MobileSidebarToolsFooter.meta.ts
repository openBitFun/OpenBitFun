import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarToolsFooterMeta = {
  category: "mobile",
  description: "The sidebar's bottom bar: a tools pill on the left, a flexible spacer, and a 32px settings icon button on the right.",
  maturity: "stable",
  name: "MobileSidebarToolsFooter",
  props: [
    { name: "leading", type: "ReactNode" },
    { name: "onToolsClick", type: "() => void" },
    { name: "onSettingsClick", type: "() => void" },
    { defaultValue: "\"Settings\"", name: "settingsLabel", type: "string" },
  ],
  states: ["default", "hover", "focus-visible"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.hover",
    "color.sidebar.ink",
    "color.sidebar.muted",
    "color.sidebar.line",
    "type.body.md.fontSize",
    "type.body.md.fontWeight",
    "type.body.md.lineHeight",
    "radius.md",
    "motion.duration.fast",
    "motion.easing.standard",
  ],
} as const satisfies ComponentMeta;
