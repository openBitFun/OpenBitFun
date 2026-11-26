import { useMemo, useState, type CSSProperties } from "react";
import {
  canonicalIconNames,
  Icon,
  SearchField,
  TabGroup,
  ThemeRoot,
  type ColorScheme,
  type ContrastMode,
} from "@openbitfun/ui";
import { useI18n, type MessageKey } from "../i18n";
import "../preview/ComponentShowcase.css";

type IconPlatform = "web" | "mobile";
type IconInk = "default" | "subtle";

interface IconsPageProps {
  colorScheme: ColorScheme;
  contrast: ContrastMode;
}

/* Web renders under comfortable density (stroke 1.6); Mobile renders under touch density, which
   remaps control.icon.strokeWidth to 1.8. The library shows one catalog through both rules, so
   a glyph never needs a second, platform-specific drawing. */
const platformDensity = { mobile: "touch", web: "comfortable" } as const;

const inkVariable: Readonly<Record<IconInk, string>> = {
  default: "var(--openbitfun-color-icon-default)",
  subtle: "var(--openbitfun-color-icon-subtle)",
};

const ruleRows: readonly { ink: IconInk; token: string; usage: MessageKey }[] = [
  { ink: "default", token: "color.icon.default", usage: "icons.rule.defaultUsage" },
  { ink: "subtle", token: "color.icon.subtle", usage: "icons.rule.subtleUsage" },
];

const sizeRows = [
  ["xs", "control.icon.sizeXs"],
  ["sm", "control.icon.sizeSm"],
  ["md", "control.icon.sizeMd"],
  ["lg", "control.icon.sizeLg"],
] as const;

export function IconsPage({ colorScheme, contrast }: IconsPageProps) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<IconPlatform>("web");
  const [ink, setInk] = useState<IconInk>("default");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const visibleNames = useMemo(
    () => canonicalIconNames.filter(name => name.includes(normalizedQuery)),
    [normalizedQuery],
  );
  const inkStyle = { color: inkVariable[ink] } as CSSProperties;

  return (
    <main className="lab-page lab-page--colors lab-page--icons" id="icons">
      <header className="colors-page-heading">
        <div className="colors-heading-copy">
          <h1>{t("nav.icons")}</h1>
          <p>{t("icons.intro", { count: canonicalIconNames.length })}</p>
        </div>
      </header>

      <section className="colors-doc-card">
        <header className="colors-card-heading">
          <h2>{t("icons.rule.title")}</h2>
        </header>
        <div className="semantic-color-table-scroll">
          <table className="icons-rule-table">
            <thead>
              <tr>
                <th scope="col">{t("icons.rule.level")}</th>
                <th scope="col">{t("colors.column.token")}</th>
                <th scope="col">{t("icons.rule.sample")}</th>
                <th scope="col">{t("colors.column.description")}</th>
              </tr>
            </thead>
            <tbody>
              {ruleRows.map(row => (
                <tr key={row.token}>
                  <th scope="row">{t(row.ink === "default" ? "icons.ink.default" : "icons.ink.subtle")}</th>
                  <td><code>{row.token}</code></td>
                  <td>
                    <span className="icons-rule-sample" style={{ color: inkVariable[row.ink] }}>
                      <Icon name="settings" size="md" /><Icon name="chevron-right" size="md" /><Icon name="plus" size="md" />
                    </span>
                  </td>
                  <td>{t(row.usage)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{t("icons.rule.stroke")}</th>
                <td><code>control.icon.strokeWidth</code></td>
                <td>{t("icons.rule.strokeValues")}</td>
                <td>{t("icons.rule.strokeUsage")}</td>
              </tr>
              <tr>
                <th scope="row">{t("icons.rule.size")}</th>
                <td>{sizeRows.map(([, token]) => <code key={token}>{token} </code>)}</td>
                <td>
                  <span className="icons-rule-sample" style={{ color: inkVariable.default }}>
                    {sizeRows.map(([size]) => <Icon key={size} name="session" size={size} />)}
                  </span>
                </td>
                <td>{t("icons.rule.sizeUsage")}</td>
              </tr>
              <tr>
                <th scope="row">{t("icons.rule.exception")}</th>
                <td>—</td>
                <td>—</td>
                <td>{t("icons.rule.exceptionUsage")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="colors-doc-card icons-catalog-card">
        <header className="colors-card-heading icons-catalog-heading">
          <h2>{t("icons.catalog.title")}</h2>
          <div className="icons-catalog-tools">
            <TabGroup aria-label={t("colors.platform.label")} size="sm" value={platform}
              onValueChange={value => setPlatform(value as IconPlatform)}
              items={[
                { value: "web", label: t("icons.platform.web") },
                { value: "mobile", label: t("icons.platform.mobile") },
              ]} />
            <TabGroup aria-label={t("icons.rule.level")} size="sm" value={ink}
              onValueChange={value => setInk(value as IconInk)}
              items={[
                { value: "default", label: t("icons.ink.default") },
                { value: "subtle", label: t("icons.ink.subtle") },
              ]} />
            <SearchField aria-label={t("preview.searchIcons")} placeholder={t("preview.searchIcons")} value={query}
              onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} clearLabel={t("design.clear")}
              leadingIcon={<Icon name="search" />} />
          </div>
        </header>
        <ThemeRoot colorScheme={colorScheme} contrast={contrast} density={platformDensity[platform]}>
          <div className="design-icon-directory icons-catalog-grid" style={inkStyle}>
            {visibleNames.map(name => (
              <div key={name} className="icons-catalog-item">
                <Icon name={name} size="lg" />
                <span>{name}</span>
              </div>
            ))}
            {visibleNames.length === 0 && <p>{t("search.noResults", { query })}</p>}
          </div>
        </ThemeRoot>
      </section>
    </main>
  );
}
