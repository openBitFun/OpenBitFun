import type { ComponentMeta } from "../../registry.types";

export const mobileSidebarMeta = {
  category: "mobile",
  description: "A mobile sidebar container that stacks a header, a scrolling body and a footer over the muted sidebar surface.",
  maturity: "stable",
  name: "MobileSidebar",
  props: [
    { name: "header", type: "ReactNode" },
    { name: "footer", type: "ReactNode" },
    { name: "children", type: "ReactNode" },
  ],
  states: ["default"],
  tokens: [
    "color.sidebar.bg",
    "color.sidebar.ink",
  ],
} as const satisfies ComponentMeta;
