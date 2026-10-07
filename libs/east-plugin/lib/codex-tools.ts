import { resolve } from "node:path";

export interface PatchFile { path: string; code: string; deleted: boolean; originalPath: string }
/** Extract file boundaries and added/context text from Codex's apply_patch input. */
export function patchFiles(command: string, cwd: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  for (const line of command.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      const path = resolve(cwd, header[2]!);
      current = { path, originalPath: path, code: "", deleted: header[1] === "Delete" };
      files.push(current);
    } else if (line.startsWith('*** Move to: ') && current) {
      current.path = resolve(cwd, line.slice(13));
    } else if (current && (line.startsWith('+') || line.startsWith(' '))) {
      current.code += line.slice(1) + '\n';
    }
  }
  return files;
}

/** Concrete source paths in ordinary shell reads. No glob expansion or shell execution. */
export function shellReadPaths(command: string, cwd: string): string[] {
  const paths = new Set<string>();
  let dir = cwd;
  for (const segment of command.split(/&&|;|\n|\|/)) {
    const tokens = [...segment.matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s]+)/g)].map(m => m[1] ?? m[2] ?? m[3]!);
    if (tokens[0] === 'cd' && tokens[1]) { dir = resolve(dir, tokens[1]); continue; }
    if (!['cat', 'head', 'tail', 'sed', 'rg', 'grep', 'less', 'more'].includes(tokens[0] ?? '')) continue;
    for (const token of tokens.slice(1)) {
      if (!token.startsWith('-') && !/[*?$`]/.test(token) && /\.(tsx?|js|py)$/.test(token)) paths.add(resolve(dir, token));
    }
  }
  return [...paths];
}
