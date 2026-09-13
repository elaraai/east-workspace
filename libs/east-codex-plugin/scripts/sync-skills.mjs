// Read the single shared skill catalog; ship real files because Codex caches only this plugin.
import { readdir, readFile, mkdir, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const sources = join(root, '..', 'east-plugin', 'skills');
export function adaptSkill(text) {
  text = text.replaceAll('mcp__plugin_east_east__', '')
    .replaceAll('/east:', '$east-codex-plugin:')
    .replaceAll('east-claude-plugin', 'east-codex-plugin')
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
  const metadata = frontmatter[2].replace(/^description: (.+)$/m, (line, value) => {
    // The shared skill catalog uses JSON-compatible double-quoted YAML strings.
    const original = JSON.parse(value);
    let description = original.replaceAll('<', '(').replaceAll('>', ')');
    if (description.length > 1024) {
      description = description.slice(0, 940).replace(/\s+\S*$/, '') + '… See the detailed scope below.';
    }
    if (description !== original) details = `\n## Detailed skill scope\n\n${original}\n`;
    return 'description: ' + JSON.stringify(description);
  });
  // Preserve all discovery detail in the body, including text too long for metadata.
  return frontmatter[1] + metadata + frontmatter[3] + details + text.slice(frontmatter[0].length);
}
for (const entry of await readdir(sources, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = join(sources, entry.name);
  const target = join(root, 'skills', entry.name);
  await mkdir(target, { recursive: true });
  for (const file of await readdir(source, { withFileTypes: true })) {
    const input = join(source, file.name);
    const output = join(target, file.name);
    if (file.name.endsWith('.md')) await writeFile(output, adaptSkill(await readFile(input, 'utf8')));
    else await cp(input, output, { recursive: true, dereference: true });
  }
}
