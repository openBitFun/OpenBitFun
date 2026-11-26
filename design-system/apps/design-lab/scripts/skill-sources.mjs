import { componentPlatforms, componentRegistry } from "@openbitfun/ui/registry";
import { tokenCatalog } from "@openbitfun/design-tokens";
import { themeTokenCatalog } from "@openbitfun/theme-openbitfun";

/* Collects the skill sources from the built packages, in the shape buildDesignSystemSkill takes. */
export function skillSources() {
  return {
    components: componentRegistry.map(component => ({
      name: component.name,
      description: component.description,
      platform: componentPlatforms(component)[0],
      props: component.props,
    })),
    systemTokens: tokenCatalog,
    themeTokens: themeTokenCatalog,
  };
}
