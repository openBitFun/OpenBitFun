import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDesignSystemSkill, SKILL_PATH } from "../src/skill/buildSkill.ts";
import { skillSources } from "../scripts/skill-sources.mjs";

const repoRoot = new URL("../../../../", import.meta.url);

test("the committed SKILL.md matches the registry and token catalogs", async () => {
  const committed = await readFile(new URL(SKILL_PATH, repoRoot), "utf8");
  assert.equal(committed, buildDesignSystemSkill(skillSources()),
    "SKILL.md is stale: run `node scripts/generate-skill.mjs` in apps/design-lab");
});

test("the skill lists every published component and no raw colors", () => {
  const sources = skillSources();
  const skill = buildDesignSystemSkill(sources);
  for (const component of sources.components) assert.match(skill, new RegExp(`\\| \`${component.name}\` \\|`));
  assert.match(skill, /^---\nname: openbitfun-design-system\ndescription: /);
});
