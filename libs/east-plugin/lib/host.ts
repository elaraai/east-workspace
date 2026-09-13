import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Bundled entry points all live in .build/<component>; shared dist entries use the same depth.
export const isCodex = existsSync(fileURLToPath(new URL('../../.codex-plugin/plugin.json', import.meta.url)));
export function hostText(text: string): string {
  return isCodex ? text.replaceAll('mcp__plugin_east_east__', '')
    .replaceAll('/east:', '$east-codex-plugin:').replaceAll('Claude Code', 'Codex') : text;
}
