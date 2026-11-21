import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarHeaderMeta = {
  category: "mobile",
  description: "The sidebar's top bar: a brand title on the left and 32px icon-button slots (search, collapse) on the right.",
  maturity: "stable",
  name: "MobileSidebarHeader",
  props: [
    { name: "brand", type: "ReactNode" },
    { name: "trailing", type: "ReactNode" },
  ],
  states: ["default"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.ink",
    "type.title.sm.fontSize",
    "type.title.sm.fontWeight",
    "type.title.sm.lineHeight",
  ],
} as const satisfies ComponentMeta;
