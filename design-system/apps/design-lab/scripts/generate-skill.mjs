/* Writes the committed SKILL.md from the registry and token catalogs. Run after changing a
   component's meta or a token: node scripts/generate-skill.mjs (from apps/design-lab). */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesignSystemSkill, SKILL_PATH } from "../src/skill/buildSkill.ts";
import { skillSources } from "./skill-sources.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const target = path.join(repoRoot, SKILL_PATH);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, buildDesignSystemSkill(skillSources()));
console.log(`Wrote ${path.relative(repoRoot, target)}`);
