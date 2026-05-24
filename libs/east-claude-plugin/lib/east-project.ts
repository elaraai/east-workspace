import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const PACKAGE_SKILL_MAP: Record<string, string> = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3",
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
