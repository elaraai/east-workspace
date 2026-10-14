import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { copySkills, materializeSkills, type SkillNames } from "./codex-skills.js";

// A plugin as a host installs it: one directory, every file real, nothing
// depended on — what a release publishes to npm, and what a checkout serves
// as a local marketplace. East's plugins are assembled this way
// (scripts/package.ts), and a plugin that builds on East's assembles its own
// the same way, with its own names (#1309).

/** The host a plugin is assembled for. */
export type PluginHost = "claude" | "codex";

/** What a plugin's manifest (`plugin.json`) says about it, as the package's manifest repeats it. */
interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: unknown;
  homepage?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  license?: string;
  keywords?: string[];
}

/** What is taken from the plugin source's own `package.json`. */
interface SourceManifest {
  name?: string;
  license?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
}

/** The `package.json` written into an assembled plugin. */
export interface AssembledManifest {
  name: string;
  version: string;
  description?: string;
  license?: string;
  type: "module";
  author?: unknown;
  homepage?: string;
  repository?: { type: "git"; url: string; directory?: string };
  keywords?: string[];
  engines: { node: string };
  files: string[];
}

/** How a plugin is assembled. */
export interface AssembleOptions {
  /** The host the plugin is for: which manifest directory it has, and how its skills are written. */
  host: PluginHost;
  /**
   * The plugin's source directory: its manifest directory (`.claude-plugin`
   * or `.codex-plugin`), its bundled `.build/`, the `package.json` whose
   * `name` the package takes, and — each when it has one — `hooks/hooks.json`,
   * `.mcp.json`, `.lsp.json`, `README.md`, `LICENSE.md`, and for Claude Code
   * its `commands/` and `agents/`.
   */
  source: string;
  /** The directory of skill directories, as written for Claude Code (symlinks into the owning packages allowed, a whole skill directory's included). */
  skills: string;
  /** The example index to ship as the plugin's `index.json`, when it serves one. */
  index?: string;
  /**
   * The directory written. An earlier assembly there is replaced, anything
   * else is refused, and so is a directory that overlaps the source, the
   * skills or the index. It is written whole or not at all: the plugin is
   * staged beside it and moved into place once complete.
   */
  out: string;
  /** The names a Codex plugin's skills are adapted in (default East's). Ignored for Claude Code. */
  names?: SkillNames;
  /** The npm package name (default the source `package.json`'s). */
  packageName?: string;
}

/**
 * What a host's plugin directory may hold beyond its manifest directory, its
 * bundles and its skills, each copied when the source has it: a file at the
 * root, or a directory of the host's own content.
 */
const OPTIONAL_PARTS: Record<PluginHost, string[]> = {
  claude: [".mcp.json", ".lsp.json", "commands", "agents"],
  codex: [".mcp.json", ".lsp.json"],
};

/** The manifest directory of each host. */
export const MANIFEST_DIR: Record<PluginHost, string> = {
  claude: ".claude-plugin",
  codex: ".codex-plugin",
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Whether `child` is `parent` or lies under it. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Every path under `dir` that is a symbolic link, relative to it — an
 * assembled plugin must hold none, since a host copies it without following
 * links that leave it.
 *
 * @param dir - The directory walked
 * @returns The links found, relative paths, in walk order
 */
export async function symlinksUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isSymbolicLink()) found.push(relative(dir, path));
      else if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(dir);
  return found;
}

/**
 * Assembles a plugin directory a host installs: the source's manifests and
 * bundles, the skills as real files (adapted for Codex), the index, and a
 * generated `package.json` with no dependency, so the directory publishes to
 * npm as it is and serves from a local marketplace as it is. The plugin is
 * staged beside `out` and moved into place once complete, so a failure
 * leaves the earlier assembly as it was and nothing half-written.
 *
 * @param options - The plugin's source, skills, index and destination
 * @returns The `package.json` written
 * @throws {Error} When the source lacks its manifest or its `.build/`, when `out` holds something that is not an earlier assembly, or when `out` overlaps the source, the skills or the index
 */
export async function assemblePlugin(options: AssembleOptions): Promise<AssembledManifest> {
  const { host, skills, index } = options;
  const source = resolve(options.source);
  const out = resolve(options.out);
  const manifestDir = MANIFEST_DIR[host];
  const manifestPath = join(source, manifestDir, "plugin.json");
  if (!existsSync(manifestPath)) throw new Error(`${source} has no ${manifestDir}/plugin.json`);
  if (!existsSync(join(source, ".build"))) throw new Error(`${source} has no .build/ — bundle the plugin first (pnpm run bundle)`);
  for (const [what, path] of [["source", source], ["skills", resolve(skills)], ...(index === undefined ? [] : [["index", resolve(index)]])] as const) {
    if (within(out, path) || within(path, out)) throw new Error(`Refusing to assemble into ${out}: it overlaps the ${what} ${path}`);
  }
  const plugin = await readJson<PluginManifest>(manifestPath);
  const sourcePkg = existsSync(join(source, "package.json")) ? await readJson<SourceManifest>(join(source, "package.json")) : {};
  const name = options.packageName ?? sourcePkg.name;
  if (name === undefined) throw new Error(`${source}: no package name — give packageName or a package.json with a name`);
  if (plugin.version === undefined) throw new Error(`${manifestPath} has no version`);

  // Refused before anything is written, so a wrong `out` loses nothing.
  if (existsSync(out)) {
    const earlier = join(out, "package.json");
    const assembled = existsSync(earlier) && (await readJson<{ name?: string }>(earlier)).name === name;
    if (!assembled && (await readdir(out)).length > 0) {
      throw new Error(`Refusing to replace ${out}: it is not an earlier assembly of ${name}`);
    }
  }

  // Staged beside `out` (the same file system, so the move is a rename); a
  // run that died mid-way left its staging directory, which is ours to drop.
  const staging = `${out}.assembling`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  let manifest: AssembledManifest;
  try {
    manifest = await writePlugin(options, source, staging, name, plugin.version, plugin, sourcePkg);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await rm(out, { recursive: true, force: true });
  await rename(staging, out);
  return manifest;
}

/** Writes the plugin into `out` (the staging directory) and returns its manifest. */
async function writePlugin(
  options: AssembleOptions,
  source: string,
  out: string,
  name: string,
  version: string,
  plugin: PluginManifest,
  sourcePkg: SourceManifest,
): Promise<AssembledManifest> {
  const { host, skills, index } = options;
  const manifestDir = MANIFEST_DIR[host];
  const files: string[] = [manifestDir, ".build"];
  await cp(join(source, manifestDir), join(out, manifestDir), { recursive: true, dereference: true });
  await cp(join(source, ".build"), join(out, ".build"), { recursive: true, dereference: true });
  if (existsSync(join(source, "hooks", "hooks.json"))) {
    await mkdir(join(out, "hooks"));
    await cp(join(source, "hooks", "hooks.json"), join(out, "hooks", "hooks.json"), { dereference: true });
    files.push("hooks");
  }
  files.push("skills");
  if (host === "codex") await materializeSkills(skills, join(out, "skills"), options.names);
  else await copySkills(skills, join(out, "skills"));
  for (const part of OPTIONAL_PARTS[host]) {
    if (!existsSync(join(source, part))) continue;
    await cp(join(source, part), join(out, part), { recursive: true, dereference: true });
    files.push(part);
  }
  for (const file of ["README.md", "LICENSE.md"]) {
    if (existsSync(join(source, file))) await cp(join(source, file), join(out, file), { dereference: true });
  }
  if (index !== undefined) {
    await cp(index, join(out, "index.json"), { dereference: true });
    files.push("index.json");
  }

  const repository = plugin.repository ?? sourcePkg.repository;
  const manifest: AssembledManifest = {
    name,
    version,
    ...(plugin.description !== undefined && { description: plugin.description }),
    ...((sourcePkg.license ?? plugin.license) !== undefined && { license: sourcePkg.license ?? plugin.license }),
    type: "module",
    ...(plugin.author !== undefined && { author: plugin.author }),
    ...(plugin.homepage !== undefined && { homepage: plugin.homepage }),
    ...(repository !== undefined && { repository: gitRepository(repository) }),
    ...(plugin.keywords !== undefined && { keywords: plugin.keywords }),
    engines: { node: ">=22.0.0" },
    files,
  };
  await writeFile(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const links = await symlinksUnder(out);
  if (links.length > 0) throw new Error(`${options.out} would hold symbolic links: ${links.join(", ")}`);
  return manifest;
}

/**
 * A manifest's repository as npm expects it: a GitHub shorthand
 * (`owner/repo`, `github:owner/repo`) and an `https` URL become the
 * `git+https://github.com/owner/repo.git` form npm's provenance matches
 * against; any other form (`git+ssh://`, `git@host:`, `gitlab:`) is npm's
 * own and passes through as written.
 */
function gitRepository(repository: string | { type?: string; url?: string; directory?: string }): { type: "git"; url: string; directory?: string } {
  if (typeof repository === "string") {
    const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repository);
    if (shorthand) return { type: "git", url: `git+https://github.com/${shorthand[1]}.git` };
    if (/^(git\+)?https?:\/\//.test(repository)) {
      const url = repository.startsWith("git+") ? repository : `git+${repository}`;
      return { type: "git", url: `${url.replace(/\.git$/, "")}.git` };
    }
    return { type: "git", url: repository };
  }
  if (repository.url === undefined) throw new Error("a repository object needs a url");
  return { type: "git", url: repository.url, ...(repository.directory !== undefined && { directory: repository.directory }) };
}
