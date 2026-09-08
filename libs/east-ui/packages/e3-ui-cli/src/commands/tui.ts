/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3-ui [repo] [workspace]` — the root action: resolve the options, refuse a
 * non-interactive terminal with a pointer to the scriptable `e3` commands,
 * then load the terminal UI.
 *
 * Ink is imported lazily (`await import('../tui/app.js')`) so `--help`,
 * `--version` and the non-TTY refusal never load it: `e3-ui --version` stays
 * instant and TTY-free (the release smoke), and a script that pipes `e3-ui`
 * gets today's help-on-stderr / exit-1 contract instead of a hung screen.
 *
 * @packageDocumentation
 */

/** Options commander hands the root action (camel-cased flags). */
export interface TuiCommandOptions {
    task?: string;
    input?: string;
    /** `--no-mouse` → false; default true. */
    mouse?: boolean;
    ascii?: boolean;
}

/** The resolved options the terminal UI starts from. */
export interface TuiOptions {
    /** The repository argument: a local path, `https://host/repos/<repo>`, or a bare `https://host`. */
    repo: string;
    /** The workspace to open, when given. */
    workspace: string | undefined;
    /** A task to open on start (mutually exclusive with `input`). */
    task: string | undefined;
    /** An input to open on start (mutually exclusive with `task`). */
    input: string | undefined;
    /** Whether mouse reporting is enabled. */
    mouse: boolean;
    /** Whether box-drawing is off (`--ascii` or `E3_UI_ASCII=1`). */
    ascii: boolean;
}

/**
 * Resolves the root action's arguments and options into {@link TuiOptions}.
 * Pure: the repository defaults to `$E3_REPO`, then `.` (e3-cli's
 * `defaultRepoArg` rule), `--task` and `--input` are mutually exclusive, and
 * `--ascii` is also switched on by `E3_UI_ASCII=1`.
 *
 * @param repo - The `[repo]` positional, if given
 * @param workspace - The `[workspace]` positional, if given
 * @param options - The parsed flags
 * @param env - The environment (`process.env` in production)
 * @returns The resolved options
 * @throws {Error} When both `--task` and `--input` are given
 */
export function parseTuiArgs(
    repo: string | undefined,
    workspace: string | undefined,
    options: TuiCommandOptions,
    env: NodeJS.ProcessEnv,
): TuiOptions {
    if (options.task !== undefined && options.input !== undefined) {
        throw new Error('--task and --input are mutually exclusive (open one or the other on start)');
    }
    const envRepo = env['E3_REPO'];
    const ascii = options.ascii === true || env['E3_UI_ASCII'] === '1';
    return {
        repo: repo !== undefined && repo.length > 0 ? repo : (envRepo !== undefined && envRepo.length > 0 ? envRepo : '.'),
        workspace: workspace !== undefined && workspace.length > 0 ? workspace : undefined,
        task: options.task,
        input: options.input,
        mouse: options.mouse !== false,
        ascii,
    };
}

/** The stream surface the TTY gate inspects (injectable for tests). */
export interface TtyStream {
    isTTY?: boolean | undefined;
}

/**
 * Whether the terminal UI can run: both stdin and stdout must be TTYs (raw
 * keyboard input and a full-screen frame need a real terminal on both ends).
 *
 * @param stdin - The input stream
 * @param stdout - The output stream
 * @returns `true` when both are TTYs
 */
export function isInteractive(stdin: TtyStream, stdout: TtyStream): boolean {
    return stdin.isTTY === true && stdout.isTTY === true;
}

/**
 * The refusal printed (to stderr) when the terminal is not interactive —
 * a pointer to the scriptable `e3` commands instead of a hung screen.
 *
 * @param stdin - The input stream
 * @param stdout - The output stream
 * @returns The two-line message
 */
export function nonInteractiveMessage(stdin: TtyStream, stdout: TtyStream): string {
    const why = stdout.isTTY !== true ? 'stdout is not a TTY' : stdin.isTTY !== true ? 'stdin is not a TTY' : 'not a TTY';
    return [
        `e3-ui: interactive terminal required (${why}).`,
        '  scripts: e3 workspace status <repo> <ws> · e3 dataset get <repo> <ws.name> -f json',
        '  help:    e3-ui --help',
    ].join('\n');
}

/**
 * Commander action for the root `e3-ui [repo] [workspace]` command.
 *
 * @param repo - The `[repo]` positional
 * @param workspace - The `[workspace]` positional
 * @param options - The parsed flags
 */
export async function tuiCommand(repo: string | undefined, workspace: string | undefined, options: TuiCommandOptions): Promise<void> {
    let resolved: TuiOptions;
    try {
        resolved = parseTuiArgs(repo, workspace, options, process.env);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    if (!isInteractive(process.stdin, process.stdout)) {
        console.error(nonInteractiveMessage(process.stdin, process.stdout));
        process.exit(1);
    }
    // Loaded only here: Ink, React and the views never touch `--help`,
    // `--version`, `shot`, or a non-TTY invocation.
    const { runTui } = await import('../tui/app.js');
    const code = await runTui(resolved);
    process.exit(code);
}
