/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The file e3 runs for a stock runner (test-only). The specs that run calls on
 * the stock runners — `query-plans.spec.ts`, `query-equivalence.spec.ts` and
 * `query-scale.spec.ts` — name it, and refuse one that is not the build they
 * mean.
 *
 * e3 spawns a runner by its binary's name, with a PATH of its own
 * (`spawnAndCapture`, e3-core's `execution/processExec.ts`): the first uv
 * `.venv` above each search directory, every `node_modules/.bin` above each,
 * the directory of the node e3 runs on, then the PATH it inherited. Its search
 * directories are the repository's directory and its working directory. So a
 * build in a `node_modules/.bin` above either runs ahead of the one PATH names
 * — a checkout's own, above a worktree inside it, say — which a spec that asks
 * PATH which runner it has never sees.
 */

import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The names a binary may have on disk: on Windows, its name with each of PATHEXT's extensions too. */
function namesOf(binary: string): string[] {
    if (process.platform !== 'win32') return [binary];
    const extensions = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '');
    return [...extensions.map((ext) => `${binary}${ext.toLowerCase()}`), binary];
}

/** Whether `file` is a file that can be run. */
function runnable(file: string): boolean {
    try {
        if (!statSync(file).isFile()) return false;
        if (process.platform !== 'win32') accessSync(file, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** The bin directory of the first uv `.venv` above `start`, as e3 finds it: none when there is no `.venv`. */
function venvBin(start: string): string[] {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
        const venv = join(dir, '.venv');
        if (existsSync(venv)) {
            const bin = join(venv, process.platform === 'win32' ? 'Scripts' : 'bin');
            return existsSync(bin) ? [bin] : [];
        }
        if (dirname(dir) === dir) return [];
    }
}

/** Every `node_modules/.bin` above `start`, nearest first, as e3 finds them. */
function nodeModulesBins(start: string): string[] {
    const bins: string[] = [];
    for (let dir = resolve(start); ; dir = dirname(dir)) {
        const bin = join(dir, 'node_modules', '.bin');
        if (existsSync(bin)) bins.push(bin);
        if (dirname(dir) === dir) return bins;
    }
}

/** The first file named `binary` that can be run in `dirs`, or `null`. */
function firstIn(binary: string, dirs: readonly string[]): string | null {
    for (const dir of dirs) {
        for (const name of namesOf(binary)) {
            const file = join(dir, name);
            if (runnable(file)) return file;
        }
    }
    return null;
}

/** The directories of the PATH this process inherited, in order. */
function pathDirs(): string[] {
    return (process.env['PATH'] ?? '').split(delimiter).filter((dir) => dir !== '');
}

/**
 * The directories e3 looks a runner up in, in order, for a repository at
 * `repo`, from this process's working directory.
 *
 * @param repo - the repository's directory
 * @returns the directories
 */
export function runnerPath(repo: string): string[] {
    const searchDirs = [dirname(resolve(repo)), process.cwd()];
    return [
        ...new Set(searchDirs.flatMap(venvBin)),
        ...new Set(searchDirs.flatMap(nodeModulesBins)),
        dirname(process.execPath),
        ...pathDirs(),
    ];
}

/**
 * The file e3 runs for a stock runner's binary, for a repository at `repo`.
 *
 * @param binary - the runner's binary: `east-node`, `east-c` or `east-py`
 * @param repo - the repository's directory
 * @returns the file, or `null` when e3 would find none
 */
export function runnerFile(binary: string, repo: string): string | null {
    return firstIn(binary, runnerPath(repo));
}

/** The checkout this module is in: the nearest directory above it holding `.git`, a worktree's own among them. */
function checkout(): string {
    for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
        if (existsSync(join(dir, '.git'))) return dir;
        if (dirname(dir) === dir) throw new Error(`no checkout holds ${fileURLToPath(import.meta.url)}`);
    }
}

/** Where e3 looks before PATH, said for a message. */
function lookedIn(repo: string): string {
    return `e3 runs a runner it finds in a node_modules/.bin or the first .venv above the repository's directory (${dirname(resolve(repo))}) or the working directory (${process.cwd()}) ahead of PATH`;
}

/**
 * Asserts that the file e3 runs for `binary` is a build of this checkout: a
 * runner of another release need not speak this one's unit protocol, and a
 * spec that ran on one would report another build's answers as this tree's.
 *
 * @param binary - the runner's binary
 * @param file - the file e3 runs for it ({@link runnerFile})
 * @param repo - the repository's directory
 * @throws {Error} When the file's real path is outside this checkout, naming
 *   the file, the checkout and where e3 looked.
 */
export function assertThisTreesRunner(binary: string, file: string, repo: string): void {
    const real = realpathSync(file);
    const tree = checkout();
    const within = relative(tree, real);
    if (within !== '' && !within.startsWith('..') && !isAbsolute(within)) return;
    throw new Error(`e3 runs ${file}${real === file ? '' : `, which is ${real},`} for ${binary}: not a build of this checkout (${tree}). ` +
        `${lookedIn(repo)}: put this tree's ${binary} first on PATH, and run from a directory none of whose node_modules/.bin holds another.`);
}

/**
 * Asserts that the file e3 runs for `binary` is the first on PATH, where whoever
 * runs a benchmark puts the build they mean to measure — this tree's, or
 * another's for a comparison.
 *
 * @param binary - the runner's binary
 * @param file - the file e3 runs for it ({@link runnerFile})
 * @param repo - the repository's directory
 * @throws {Error} When another file shadows PATH's first, naming both and where
 *   e3 looked.
 */
export function assertPathsRunner(binary: string, file: string, repo: string): void {
    const onPath = firstIn(binary, pathDirs());
    if (onPath !== null && realpathSync(onPath) === realpathSync(file)) return;
    throw new Error(`e3 runs ${file} for ${binary}, not ${onPath ?? 'none'}, the first on PATH. ` +
        `${lookedIn(repo)}: run from a directory none of whose node_modules/.bin holds ${binary} — /var/tmp, say.`);
}
