import { MobileSceneGallery } from "../preview/MobileSceneGallery";
import { useI18n } from "../i18n";
import type { ColorScheme, ContrastMode, DensityMode, TokenOverrides } from "@openbitfun/ui";

interface MobilePatternsPageProps {
  colorScheme: ColorScheme;
  contrast: ContrastMode;
  density: DensityMode;
  tokenOverrides: TokenOverrides;
}

/** Handheld counterpart of the Patterns page: the phone-screen scene gallery
    gets a full page instead of living inside each component's details panel. */
export function MobilePatternsPage({ colorScheme, contrast, density, tokenOverrides }: MobilePatternsPageProps) {
  const { t } = useI18n();
  return (
    <main className="lab-page lab-page--mobile-patterns" id="mobile-patterns">
      <header className="page-heading">
        <h1>{t("scenes.mobile.label")}</h1>
      </header>
      <MobileSceneGallery colorScheme={colorScheme} contrast={contrast} density={density} tokenOverrides={tokenOverrides} />
    </main>
  );
}
