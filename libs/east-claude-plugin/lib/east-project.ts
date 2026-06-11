import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const PACKAGE_SKILL_MAP: Record<string, string> = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3",
  "@elaraai/e3-ui": "e3-ui",
};

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

// First-party `@elaraai/*` library SOURCE: the file's nearest package.json names
// an `@elaraai/*` package and the file sits under that package's `src/`. Such
// code is the libraries' own implementation (component factories, encoders) which
// legitimately uses East-construction patterns the rules flag — it is not the
// user solution code the plugin exists to review. An end-user's solution (any
// non-`@elaraai/*` package) and the monorepo's examples (under `test/`, not
// `src/`) are NOT first-party src, so they are still reviewed.
export async function isElaraaiPackageSrc(filePath: string): Promise<boolean> {
  const file = resolve(filePath);
  let dir = dirname(file);
  for (;;) {
    try {
      const content = await readFile(join(dir, "package.json"), "utf-8");
      const { name } = JSON.parse(content) as { name?: string };
      if (typeof name !== "string" || !name.startsWith("@elaraai/")) return false;
      return /[/\\]src[/\\]/.test(file.slice(dir.length));
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
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

export interface EastProjectInfo {
  isEast: boolean;
  skills: string[];
  pkg: PackageJson | null;
}

export async function getEastProjectInfo(cwd: string): Promise<EastProjectInfo> {
  const pkg = await findPackageJson(cwd);
  const skills = detectEastSkills(pkg);
  return { isEast: skills.length > 0, skills, pkg };
}
