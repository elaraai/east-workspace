import { copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
for (const host of ['east-claude-plugin', 'east-codex-plugin']) {
  await copyFile(new URL('index.json', root), new URL(`../${host}/index.json`, root));
}
