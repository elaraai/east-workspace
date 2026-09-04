import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Which language(s) an East project is authored in. A project may be both. */
export type EastLanguage = "typescript" | "python";

const PACKAGE_SKILL_MAP: Record<string, string> = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3",
  "@elaraai/e3-ui": "e3-ui",
};

// The python distributions, matched against pyproject.toml / uv.lock text.
// Ordered longest-first and anchored with a non-name lookahead so
// `elaraai-east-py-std` never also counts as `elaraai-east-py`.
const PYTHON_SKILL_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/elaraai-east-py-datascience(?![\w-])/, "east-py-datascience"],
  [/elaraai-east-py-std(?![\w-])/, "east-py-std"],
  [/elaraai-east-py-io(?![\w-])/, "east-py-io"],
  [/elaraai-east-py(?![\w-])/, "east-py"],
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function findPackageJson(startDir: string): Promise<PackageJson | null> {
  let dir = startDir;
  while (true) {
    try {
      const content = await readFile(join(dir, "package.json"), "utf-8");
      return JSON.parse(content) as PackageJson;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/** The nearest `pyproject.toml` above `startDir`, as text (uv.lock alongside it
 * is read too: a workspace member's own pyproject may not name the East
 * distributions its lockfile resolves). */
export async function findPyProject(startDir: string): Promise<string | null> {
  let dir = startDir;
  while (true) {
    const texts: string[] = [];
    for (const name of ["pyproject.toml", "uv.lock"]) {
      try {
        texts.push(await readFile(join(dir, name), "utf-8"));
      } catch {
        /* not here */
      }
    }
    if (texts.length > 0) return texts.join("\n");
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function detectEastSkills(pkg: PackageJson | null): string[] {
  if (!pkg) return [];
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const skills: string[] = [];
  for (const [packageName, skillName] of Object.entries(PACKAGE_SKILL_MAP)) {
    if (packageName in allDeps) {
      skills.push(skillName);
    }
  }
  return skills;
}

/** The east-py skills a pyproject/uv.lock text depends on. */
export function detectPythonSkills(pyproject: string | null): string[] {
  if (pyproject === null) return [];
  const skills: string[] = [];
  for (const [pattern, skill] of PYTHON_SKILL_MAP) {
    if (pattern.test(pyproject)) skills.push(skill);
  }
  return skills;
}

export interface EastProjectInfo {
  isEast: boolean;
  skills: string[];
  /** The language(s) detected — drives which rule cheat-sheet an agent is given. */
  languages: EastLanguage[];
  pkg: PackageJson | null;
}

/**
 * What kind of East project `cwd` sits in.
 *
 * Both ecosystems count. A project whose East dependency is declared only in
 * `pyproject.toml` — no package.json anywhere — is an East project, and used
 * to report `isEast: false`, so the session and subagent hooks injected
 * nothing at all for it: no skill list, no rule cheat-sheet. (The diagnose and
 * pre-write hooks never consulted this, gating on an `import east` instead,
 * which is why diagnostics worked there while orientation did not.)
 */
export async function getEastProjectInfo(cwd: string): Promise<EastProjectInfo> {
  const pkg = await findPackageJson(cwd);
  const tsSkills = detectEastSkills(pkg);
  const pySkills = detectPythonSkills(await findPyProject(cwd));
  const languages: EastLanguage[] = [];
  if (tsSkills.length > 0) languages.push("typescript");
  if (pySkills.length > 0) languages.push("python");
  const skills = [...tsSkills, ...pySkills.filter((s) => !tsSkills.includes(s))];
  return { isEast: skills.length > 0, skills, languages, pkg };
}
