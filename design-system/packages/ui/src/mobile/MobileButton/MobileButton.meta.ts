import type { ComponentMeta } from "../../registry.types";

export const mobileButtonMeta = {
  category: "mobile",
  description: "A touch-sized mobile text button with semantic appearances, slots, and loading state.",
  maturity: "stable",
  name: "MobileButton",
  props: [
    { defaultValue: "secondary", name: "appearance", type: '"primary" | "secondary" | "plain" | "danger"' },
    { defaultValue: "md", name: "size", type: '"sm" | "md" | "lg"' },
    { defaultValue: "false", name: "block", type: "boolean" },
    { defaultValue: "false", name: "loading", type: "boolean" },
  ],
  states: ["default", "hover", "active", "focus-visible", "disabled", "loading"],
  tokens: ["color.action.primary.background", "color.action.neutral.surface", "color.status.danger.surface", "radius.pill", "shadow.xs", "space.2", "control.mobileButton.heightSm", "control.mobileButton.heightMd", "control.mobileButton.heightLg", "control.mobileButton.paddingInlineSm", "control.mobileButton.paddingInlineMd", "control.mobileButton.paddingInlineLg", "control.mobileButton.minInlineSizeSm", "control.mobileButton.minInlineSizeMd", "control.mobileButton.minInlineSizeLg", "control.mobileButton.hitTarget"],
} as const satisfies ComponentMeta;
