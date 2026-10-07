import { readdir, readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";

// A Codex plugin's skills: Codex caches only the plugin itself, so it ships
// real files, adapted from the Claude Code skills they are written as — the
// tool names lose Claude Code's MCP prefix, a skill is named as Codex names
// it, and the words speak of Codex. A plugin that builds on East's adapts its
// own skills with its own names.

/** The names a skill is adapted between. */
export interface SkillNames {
  /** The Claude Code MCP prefix of the plugin's tools, which Codex drops (`mcp__plugin_east_east__`). */
  claudeToolPrefix: string;
  /** How Claude Code names the plugin's skills (`/east:`). */
  claudeSkillPrefix: string;
  /** How Codex names them (`$east-codex-plugin:`). */
  codexSkillPrefix: string;
  /** The Claude Code plugin's name (`east-claude-plugin`). */
  claudePlugin: string;
  /** The Codex plugin's name (`east-codex-plugin`). */
  codexPlugin: string;
}

/** East's names. */
export const EAST_SKILL_NAMES: SkillNames = {
  claudeToolPrefix: "mcp__plugin_east_east__",
  claudeSkillPrefix: "/east:",
  codexSkillPrefix: "$east-codex-plugin:",
  claudePlugin: "east-claude-plugin",
  codexPlugin: "east-codex-plugin",
};

/**
 * A skill's text adapted for Codex: the names, the words, and a description
 * Codex takes — at most 1024 characters with no angle brackets, the whole of
 * a longer or bracketed one kept in the body.
 *
 * @param text - The SKILL.md as written for Claude Code
 * @param names - The names it is adapted between (default East's)
 * @returns The SKILL.md for Codex
 * @throws {Error} When the skill has no frontmatter
 */
export function adaptSkill(text: string, names: SkillNames = EAST_SKILL_NAMES): string {
  text = text.replaceAll(names.claudeToolPrefix, '')
    .replaceAll(names.claudeSkillPrefix, names.codexSkillPrefix)
    .replaceAll(names.claudePlugin, names.codexPlugin)
    .replaceAll('Claude Code', 'Codex')
    .replaceAll("the Claude plugin's language server", "the Codex plugin's LSP bridge and hooks")
    .replaceAll('the Claude plugin LSP', 'the Codex plugin diagnostic hooks and LSP bridge')
    .replaceAll('Claude plugin', 'Codex plugin')
    .replaceAll('Generated-with-Claude-Code', 'Generated-with-Codex')
    .replace(/End every commit with the trailer:\n\s*`Co-Authored-By: Claude[^`]+`/, 'Use the repository attribution policy for the actual contributing agent.')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', '${PLUGIN_ROOT}');
  const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(text);
  if (!frontmatter) throw new Error('Missing skill frontmatter');
  let details = '';
  const metadata = frontmatter[2]!.replace(/^description: (.+)$/m, (_line, value: string) => {
    // The shared skill catalog uses JSON-compatible double-quoted YAML strings.
    const original = JSON.parse(value) as string;
    let description = original.replaceAll('<', '(').replaceAll('>', ')');
    if (description.length > 1024) {
      description = description.slice(0, 940).replace(/\s+\S*$/, '') + '… See the detailed scope below.';
    }
    if (description !== original) details = `\n## Detailed skill scope\n\n${original}\n`;
    return 'description: ' + JSON.stringify(description);
  });
  // Preserve all discovery detail in the body, including text too long for metadata.
  return frontmatter[1]! + metadata + frontmatter[3]! + details + text.slice(frontmatter[0].length);
}

/**
 * Writes a Codex plugin's skills as real files: every skill directory under
 * `sources`, its Markdown adapted and every other file copied through any
 * symlink.
 *
 * @param sources - The directory of skill directories, as written for Claude Code
 * @param target - The Codex plugin's `skills` directory
 * @param names - The names they are adapted between (default East's)
 * @returns The skills written, by directory name
 */
export async function materializeSkills(sources: string, target: string, names: SkillNames = EAST_SKILL_NAMES): Promise<string[]> {
  const written: string[] = [];
  for (const entry of await readdir(sources, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = join(sources, entry.name);
    const skill = join(target, entry.name);
    await mkdir(skill, { recursive: true });
    for (const file of await readdir(source, { withFileTypes: true })) {
      const input = join(source, file.name);
      const output = join(skill, file.name);
      if (file.name.endsWith('.md')) await writeFile(output, adaptSkill(await readFile(input, 'utf8'), names));
      else await cp(input, output, { recursive: true, dereference: true });
    }
    written.push(entry.name);
  }
  return written;
}
