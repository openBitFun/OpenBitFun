/* Builds the OpenBitFun design-system SKILL.md from the published registry and token catalogs.
   Everything listed in the skill comes from those sources, so the skill cannot name a component or
   token the packages do not ship. The same function feeds the Design Lab Skill page and the
   committed file, and a test keeps the two in step. Plain TypeScript with no Lab imports, so Node
   can run it directly with type stripping. */

export interface SkillComponent {
  name: string;
  description: string;
  platform: string;
  props: readonly { name: string }[];
}

export interface SkillToken {
  name: string;
}

export interface SkillSources {
  components: readonly SkillComponent[];
  systemTokens: readonly SkillToken[];
  themeTokens: readonly SkillToken[];
}

export const SKILL_NAME = "openbitfun-design-system";
export const SKILL_PATH = "design-system/skills/openbitfun-design-system/SKILL.md";

const importPaths: Readonly<Record<string, string>> = {
  web: "@openbitfun/ui",
  mobile: "@openbitfun/ui/mobile",
};

function tokenGroups(tokens: readonly SkillToken[], depth: number): string[] {
  const groups = new Map<string, number>();
  for (const token of tokens) {
    const key = token.name.split(".").slice(0, depth).join(".");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `\`${key}.*\` (${count})`);
}

function componentTable(components: readonly SkillComponent[]): string {
  const rows = [...components].sort((a, b) => a.name.localeCompare(b.name)).map(component => {
    const props = component.props.map(prop => prop.name).join(", ") || "—";
    const description = component.description.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
    return `| \`${component.name}\` | ${description} | ${props} |`;
  });
  return ["| Component | Purpose | Props |", "| --- | --- | --- |", ...rows].join("\n");
}

export function buildDesignSystemSkill(sources: SkillSources): string {
  const web = sources.components.filter(component => component.platform === "web");
  const mobile = sources.components.filter(component => component.platform === "mobile");
  const mobileLayout = sources.systemTokens
    .filter(token => /^(layout\.mobile|control\.mobile)/.test(token.name))
    .map(token => `\`${token.name}\``);

  return `---
name: ${SKILL_NAME}
description: Build, edit or review OpenBitFun Web and mobile interfaces using only the published @openbitfun/ui components and OpenBitFun design tokens. Use whenever generating UI code, page layouts or Design Lab scenes for OpenBitFun, and refuse to invent components, tokens, colors or sizes the library does not ship.
---

# OpenBitFun design system

Generated from the \`@openbitfun/ui\` registry (${sources.components.length} components) and the token catalogs (${sources.systemTokens.length} system tokens, ${sources.themeTokens.length} theme tokens). Do not edit by hand; regenerate from Design Lab.

## Hard rules

1. **Components come from this library only.** Use the components listed below, imported from \`${importPaths.web}\` (Web), \`${importPaths.mobile}\` (mobile), \`@openbitfun/ui/flow-chat\` or \`@openbitfun/ui/brand\`. Render inside \`ThemeRoot\`. If nothing fits, stop and name the missing piece; never hand-roll a look-alike.
2. **Pick by platform.** Desktop and Web surfaces use Web components; handheld surfaces use \`Mobile*\` components. Do not mix both in one surface.
3. **Tokens only.** Every color, size, radius, spacing, type and motion value is a \`--openbitfun-*\` CSS variable from the catalogs below. No hex, rgb or hsl literals, and no names that are not listed (for example \`type-title-*\` does not exist). If a value is missing, report it as "to be confirmed" instead of inventing one.
4. **Icons.** Use \`Icon\`. Primary action icons take \`color.icon.default\`, indicator icons (chevrons, group add, collapse) take \`color.icon.subtle\`, applied directly with no extra opacity. Stroke width comes from \`control.icon.strokeWidth\` (1.6 at desktop density, 1.8 at touch density).
5. **Focus.** Standalone controls use the outset ring (\`outline: focus.width solid color.focus.ring\`, offset \`focus.offset\`). Items inside clipping or scrolling parents use an inset box-shadow ring. Text entry only changes its border to \`color.field.borderFocus\`; picker triggers add the ring.
6. **Hover and press.** Neutral controls lay \`color.action.neutral.surfaceHover\` / \`surfacePressed\`; hover never changes icon ink, elevation or size. Mobile gates hover behind \`(hover: hover) and (pointer: fine)\`.
7. **Mobile pages follow the OpenBitFun mobile demo.** Only three page shells exist: the mini app page (56px header with back, title and a trailing action over a body inset 20px), the recent home (floating sidebar button, brand mark, greeting and a docked composer) and the sidebar drawer (295px panel over a dimmed page). Do not invent chat, settings or other scenes the demo does not have.
8. **Touch targets.** Mobile controls keep a 44px hit target even when they draw smaller (\`control.mobileButton.hitTarget\`).

## Workflow

1. Restate the request as surfaces and states, and pick the platform.
2. Map every element to a listed component; note anything that has no match.
3. Compose with the components' own props and slots. Write CSS only for layout between components, using tokens.
4. Check: no raw colors, no unlisted tokens, no invented components, icons and focus follow the rules.
5. For mobile work, compare against the demo in Design Lab → Demo comparison; every measured value should match within 1px.

## Web components (${web.length})

${componentTable(web)}

## Mobile components (${mobile.length})

${componentTable(mobile)}

## Tokens

CSS variables are \`--openbitfun-\` plus the token name in kebab case, for example \`layout.mobilePage.headerHeight\` → \`--openbitfun-layout-mobile-page-header-height\`.

System token groups: ${tokenGroups(sources.systemTokens, 2).join(", ")}.

Theme token groups: ${tokenGroups(sources.themeTokens, 2).join(", ")}.

Mobile geometry tokens (from the mobile demo): ${mobileLayout.join(", ")}.
`;
}
