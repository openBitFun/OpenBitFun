import { useMemo, useState } from "react";
import { Button, Icon } from "@openbitfun/ui";
import { componentPlatforms, componentRegistry } from "@openbitfun/ui/registry";
import { tokenCatalog } from "@openbitfun/design-tokens";
import { themeTokenCatalog } from "@openbitfun/theme-openbitfun";
import { buildDesignSystemSkill, SKILL_NAME, SKILL_PATH } from "../skill/buildSkill";
import { useI18n } from "../i18n";

/* Skill page: the SKILL.md that limits an AI to this library, generated live from the same
   registry and token catalogs the Lab renders, plus how to install it, a prompt template and the
   checks that prove a result stays inside the system. */

const regenerateCommand = "cd design-system/apps/design-lab && node scripts/generate-skill.mjs";
/* The skill is a plain SKILL.md, so any agent that reads skill folders can load it. OpenBitFun
   reads the project .openbitfun/skills first and also the shared .agents, .codex and .claude roots. */
const installTargets = [
  { id: "openbitfun", label: "skill.install.openbitfun", dir: ".openbitfun/skills" },
  { id: "agents", label: "skill.install.agents", dir: ".agents/skills" },
  { id: "claude", label: "skill.install.claude", dir: ".claude/skills" },
  { id: "codex", label: "skill.install.codex", dir: ".codex/skills" },
] as const;
const installCommand = (dir: string) => `mkdir -p ${dir}/${SKILL_NAME} && cp ${SKILL_PATH} ${dir}/${SKILL_NAME}/SKILL.md`;
const verifyCommands = [
  "cd design-system/packages/ui && corepack pnpm test",
  "cd design-system/apps/design-lab && corepack pnpm test",
  "pnpm run theme:color-audit:all",
];

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="text" leadingIcon={<Icon name={copied ? "check-line" : "duplicate"} />}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); }}>
      {t(copied ? "skill.copied" : "skill.copy")}
    </Button>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="skill-code">
      <pre><code>{text}</code></pre>
      <CopyButton text={text} />
    </div>
  );
}

export function SkillPage() {
  const { t } = useI18n();
  const skill = useMemo(() => buildDesignSystemSkill({
    components: componentRegistry.map(component => ({
      name: component.name,
      description: component.description,
      platform: componentPlatforms(component)[0] ?? "web",
      props: component.props,
    })),
    systemTokens: tokenCatalog,
    themeTokens: themeTokenCatalog,
  }), []);
  const webCount = componentRegistry.filter(component => componentPlatforms(component)[0] === "web").length;
  const mobileCount = componentRegistry.length - webCount;
  const prompt = t("skill.prompt.template", { skill: SKILL_NAME });

  const download = () => {
    const url = URL.createObjectURL(new Blob([skill], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "SKILL.md";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="lab-page lab-page--skill" id="skill">
      <header className="page-heading">
        <h1>{t("nav.skill")}</h1>
        <p>{t("skill.intro", { components: componentRegistry.length, web: webCount, mobile: mobileCount, tokens: tokenCatalog.length + themeTokenCatalog.length })}</p>
      </header>

      <section className="skill-section">
        <h2>{t("skill.files.title")}</h2>
        <dl className="skill-facts">
          <dt>{t("skill.files.name")}</dt><dd><code>{SKILL_NAME}</code></dd>
          <dt>{t("skill.files.path")}</dt><dd><code>{SKILL_PATH}</code></dd>
          <dt>{t("skill.files.source")}</dt><dd>{t("skill.files.sourceValue")}</dd>
        </dl>
        <h3>{t("skill.files.install")}</h3>
        <p className="skill-note">{t("skill.files.installNote")}</p>
        {installTargets.map(target => (
          <div key={target.id} className="skill-install">
            <span className="skill-install-label">{t(target.label)}</span>
            <CodeBlock text={installCommand(target.dir)} />
          </div>
        ))}
        <div className="skill-install">
          <span className="skill-install-label">{t("skill.install.other")}</span>
          <p className="skill-note">{t("skill.install.otherNote")}</p>
        </div>
        <h3>{t("skill.files.regenerate")}</h3>
        <p className="skill-note">{t("skill.files.regenerateNote")}</p>
        <CodeBlock text={regenerateCommand} />
      </section>

      <section className="skill-section">
        <h2>{t("skill.prompt.title")}</h2>
        <p className="skill-note">{t("skill.prompt.note")}</p>
        <CodeBlock text={prompt} />
      </section>

      <section className="skill-section">
        <h2>{t("skill.verify.title")}</h2>
        <ol className="skill-steps">
          <li>{t("skill.verify.tests")}</li>
          <li>{t("skill.verify.demo")} <a href="#demo-compare">{t("nav.demoCompare")}</a></li>
          <li>{t("skill.verify.review")}</li>
        </ol>
        <CodeBlock text={verifyCommands.join("\n")} />
      </section>

      <section className="skill-section">
        <div className="skill-section-heading">
          <h2>{t("skill.full.title")}</h2>
          <div className="skill-actions">
            <CopyButton text={skill} />
            <Button size="sm" variant="text" leadingIcon={<Icon name="arrow-down" />} onClick={download}>{t("skill.download")}</Button>
          </div>
        </div>
        <pre className="skill-full"><code>{skill}</code></pre>
      </section>
    </main>
  );
}
