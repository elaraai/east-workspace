/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 completion {bash,zsh,fish}` — print an installable shell completion script.
 *
 * Each script delegates dynamic completion to `e3 __complete <cword> <words...>`.
 * The handler emits one candidate per line; the shell renders them.
 */

import { exitError } from '../utils.js';

// Single-quoted strings so JS doesn't interpolate the shell-script ${...}.
const BASH = [
  '# e3 bash completion',
  '# Install: eval "$(e3 completion bash)"  (in your ~/.bashrc)',
  '',
  '_e3_complete() {',
  '  local cur cwords cword candidates',
  '  cur="${COMP_WORDS[COMP_CWORD]}"',
  '  cwords=("${COMP_WORDS[@]:1}")',
  '  cword=$((COMP_CWORD - 1))',
  '  candidates=$(e3 __complete "$cword" "${cwords[@]}" 2>/dev/null)',
  '  COMPREPLY=($(compgen -W "$candidates" -- "$cur"))',
  '}',
  'complete -F _e3_complete e3',
  '',
].join('\n');

const ZSH = [
  '# e3 zsh completion',
  '# Install: eval "$(e3 completion zsh)"  (in your ~/.zshrc)',
  '',
  '_e3_complete() {',
  '  local -a candidates',
  '  local cwords cword',
  '  cwords=("${words[@]:1}")',
  '  cword=$((CURRENT - 2))',
  '  candidates=("${(@f)$(e3 __complete "$cword" "${cwords[@]}" 2>/dev/null)}")',
  '  compadd -- "${candidates[@]}"',
  '}',
  'compdef _e3_complete e3',
  '',
].join('\n');

const FISH = [
  '# e3 fish completion',
  '# Install: e3 completion fish > ~/.config/fish/completions/e3.fish',
  '',
  'function __e3_complete',
  '  set -l cmdline (commandline -opc)',
  '  set -l current (commandline -ct)',
  '  set -l cwords $cmdline[2..-1] $current',
  '  set -l cword (math (count $cwords) - 1)',
  '  e3 __complete $cword $cwords 2>/dev/null',
  'end',
  '',
  'complete -c e3 -f -a "(__e3_complete)"',
  '',
].join('\n');

export function completionCommand(shell: string): void {
  switch (shell) {
    case 'bash':
      process.stdout.write(BASH);
      return;
    case 'zsh':
      process.stdout.write(ZSH);
      return;
    case 'fish':
      process.stdout.write(FISH);
      return;
    default:
      exitError(`Unknown shell: '${shell}'. Use one of: bash, zsh, fish`);
  }
}

/** Exposed for tests. */
export const COMPLETION_SCRIPTS = { bash: BASH, zsh: ZSH, fish: FISH };
