// Read the single shared skill catalog; ship real files because Codex caches only this plugin.
// The adaptation is east-plugin's (lib/codex-skills.ts), with East's names.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { materializeSkills } from '@elaraai/east-plugin/lib/codex-skills';
export { adaptSkill } from '@elaraai/east-plugin/lib/codex-skills';
const root = fileURLToPath(new URL('../', import.meta.url));
await materializeSkills(join(root, '..', 'east-plugin', 'skills'), join(root, 'skills'));
