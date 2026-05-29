/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 completion install` / `e3 completion uninstall`.
 *
 * Edits the user's shell rc file (bash, zsh) or writes a completion file (fish).
 * Idempotent: re-running `install` doesn't duplicate the eval line; `uninstall`
 * removes only the marker line we control.
 *
 * Used by the `postinstall` hook on `npm install -g` and by `make link`.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, posix } from 'node:path';
import { COMPLETION_SCRIPTS } from './completion.js';
import { exitError, formatError } from '../utils.js';

export type SupportedShell = 'bash' | 'zsh' | 'fish';

const MARKER = '# e3 completion';
const SHELLS: readonly SupportedShell[] = ['bash', 'zsh', 'fish'];

interface InstallOptions {
  shell?: string;
  quiet?: boolean;
}

interface UninstallOptions {
  shell?: string;
}

/**
 * Detect the user's interactive shell from $SHELL.
 *
 * Returns `null` when $SHELL is unset or unrecognised.
 */
export function detectShell(env: NodeJS.ProcessEnv = process.env): SupportedShell | null {
  const shell = env.SHELL;
  if (!shell) return null;
  const basename = shell.split('/').pop() ?? '';
  if (basename === 'bash') return 'bash';
  if (basename === 'zsh') return 'zsh';
  if (basename === 'fish') return 'fish';
  return null;
}

/**
 * Resolve the file to edit for a given shell.
 *
 * bash → ~/.bashrc, zsh → ~/.zshrc (honouring $ZDOTDIR),
 * fish → ~/.config/fish/completions/e3.fish (a file, not appended to rc).
 */
export function rcPath(shell: SupportedShell, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  switch (shell) {
    // These are Unix-shell rc paths (bash/zsh/fish), so always use POSIX
    // separators — even when computed on Windows (e.g. git-bash) the path is
    // consumed by a Unix shell. node fs accepts forward slashes on Windows too.
    case 'bash':
      return posix.join(home, '.bashrc');
    case 'zsh':
      return env.ZDOTDIR ? posix.join(env.ZDOTDIR, '.zshrc') : posix.join(home, '.zshrc');
    case 'fish':
      return posix.join(home, '.config', 'fish', 'completions', 'e3.fish');
  }
}

function resolveShell(shell: string | undefined): SupportedShell {
  if (shell !== undefined) {
    if (!(SHELLS as readonly string[]).includes(shell)) {
      exitError(`Unknown shell: '${shell}'. Use one of: ${SHELLS.join(', ')}`);
    }
    return shell as SupportedShell;
  }
  const detected = detectShell();
  if (detected) return detected;
  exitError(
    `Could not detect shell from $SHELL. Specify explicitly with --shell ${SHELLS.join('|')}`,
  );
}

/**
 * Install completion for the chosen (or detected) shell.
 *
 * Behaviour matrix:
 *   - fish  : writes ~/.config/fish/completions/e3.fish (overwrites)
 *   - bash  : appends `eval "$(e3 completion bash)" {MARKER}` to ~/.bashrc
 *   - zsh   : same as bash but for ~/.zshrc
 *
 * Both bash and zsh paths short-circuit if the marker is already present, so
 * re-running this command is a no-op.
 */
export function installCommand(options: InstallOptions = {}): void {
  try {
    const shell = resolveShell(options.shell);
    const target = rcPath(shell);
    const result = installToFile(shell, target);
    if (!options.quiet) {
      console.log(result);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}

/** Pure helper for install — exposed for tests via a real filesystem path. */
export function installToFile(shell: SupportedShell, target: string): string {
  if (shell === 'fish') {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, COMPLETION_SCRIPTS.fish);
    return `Installed fish completion: ${target}`;
  }

  const evalLine = `eval "$(e3 completion ${shell})"  ${MARKER}`;
  const content = existsSync(target) ? readFileSync(target, 'utf-8') : '';

  if (content.includes(MARKER)) {
    return `e3 completion already installed in ${target}`;
  }

  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  writeFileSync(target, `${content}${sep}${evalLine}\n`);
  return `Installed ${shell} completion in ${target}\nRestart your shell, or run: source ${target}`;
}

/**
 * Uninstall completion for the chosen (or detected) shell.
 */
export function uninstallCommand(options: UninstallOptions = {}): void {
  try {
    const shell = resolveShell(options.shell);
    const target = rcPath(shell);
    console.log(uninstallFromFile(shell, target));
  } catch (err) {
    exitError(formatError(err));
  }
}

/** Pure helper for uninstall — exposed for tests. */
export function uninstallFromFile(shell: SupportedShell, target: string): string {
  if (shell === 'fish') {
    if (!existsSync(target)) {
      return `No completion file at ${target}`;
    }
    unlinkSync(target);
    return `Removed ${target}`;
  }

  if (!existsSync(target)) {
    return `No rc file at ${target}`;
  }

  const content = readFileSync(target, 'utf-8');
  const lines = content.split('\n');
  const filtered = lines.filter((l) => !l.includes(MARKER));
  if (filtered.length === lines.length) {
    return `e3 completion not present in ${target}`;
  }
  writeFileSync(target, filtered.join('\n'));
  return `Removed e3 completion from ${target}`;
}
