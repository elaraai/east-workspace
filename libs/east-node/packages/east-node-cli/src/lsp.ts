/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-node lsp` (#686): the East diagnostics as a Language Server.
 *
 * The TypeScript rules and native type errors already reach editors two ways —
 * `@elaraai/tsserver-plugin-east` rides the editor's own TypeScript service,
 * and the Claude Code plugin runs the same server. Neither helps an editor that
 * is not running tsserver with the plugin configured (nvim, helix, emacs), and
 * python has had `east-py lsp` for exactly that since #638. This is its twin.
 *
 * `@elaraai/east-diagnostics` is imported lazily and is not a dependency of
 * this CLI: a runner should not carry a language service. When it is absent the
 * command says what to install and exits, the way `east-py lsp` does for pygls.
 */

const NEEDS_DIAGNOSTICS =
    'east-node lsp needs @elaraai/east-diagnostics (and typescript) — install them with\n' +
    '  npm install --save-dev @elaraai/east-diagnostics typescript';

/** Serve the diagnostics over stdio until the client disconnects. */
export async function serve(): Promise<number> {
    // Indirect specifier: the dependency is OPTIONAL, so it must not be part of
    // this CLI's build graph. A runner should not have to resolve a language
    // service to compile.
    const specifier = '@elaraai/east-diagnostics';
    let runEastLsp: (() => void) | undefined;
    try {
        ({ runEastLsp } = (await import(specifier)) as { runEastLsp: () => void });
    } catch {
        process.stderr.write(`${NEEDS_DIAGNOSTICS}\n`);
        return 1;
    }
    runEastLsp();
    return 0;
}
