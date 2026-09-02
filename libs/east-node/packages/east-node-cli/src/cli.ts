/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'module';
import { EastError } from '@elaraai/east/internal';
import { loadPlatforms, loadPlatformWithMetadata } from './loader.js';
import { runProgram } from './runner.js';
import { writeSnapshot, readSnapshot } from './snapshot.js';
import { encodeRebuilt, isDirectory, transpile, transpileDir } from './transpile.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

interface RunOptions {
    package?: string[];
    input?: string[];
    output?: string;
    verbose?: boolean;
    snapshot?: string;
    fromSnapshot?: string;
    emit?: string;
    stream?: string;
    lazyInputs?: string;
}

/** Parses the streaming-execution flags into runner options. */
function streamingOptions(options: RunOptions): { emit?: 'array' | 'set' | 'dict'; streamInput?: number; lazyInputBytes?: number } {
    const out: { emit?: 'array' | 'set' | 'dict'; streamInput?: number; lazyInputBytes?: number } = {};
    if (options.emit !== undefined) {
        if (options.emit !== 'array' && options.emit !== 'set' && options.emit !== 'dict') {
            throw new Error(`--emit must be one of array, set or dict, got '${options.emit}'`);
        }
        out.emit = options.emit;
    }
    if (options.stream !== undefined) {
        const index = Number(options.stream);
        if (!Number.isInteger(index) || index < 0) {
            throw new Error(`--stream must be a non-negative input index, got '${options.stream}'`);
        }
        out.streamInput = index;
    }
    if (options.lazyInputs !== undefined) {
        const bytes = Number(options.lazyInputs);
        if (!Number.isFinite(bytes) || bytes < 0) {
            throw new Error(`--lazy-inputs must be a byte threshold (0 disables), got '${options.lazyInputs}'`);
        }
        out.lazyInputBytes = bytes;
    }
    return out;
}

interface VersionOptions {
    package?: string[];
}

interface TranspileOptions {
    output?: string;
    name?: string;
    importFrom?: string;
    rebuild?: string;
}

/**
 * Print `message` to stderr and exit 1 once the write has FLUSHED.
 *
 * Piped stdio is asynchronous on Windows, so `console.error(...)` followed by
 * `process.exit(1)` can truncate the message before a parent process ever
 * reads it — e3 spawns this CLI with stdio pipes and surfaces the stderr tail
 * on failure, and on windows-latest that tail arrived empty. The returned
 * promise never resolves (the process exits from the write callback), so
 * `return fail(...)` ends the caller exactly like the exit it replaces.
 */
function fail(message: string): Promise<never> {
    process.exitCode = 1;
    return new Promise(() => {
        process.stderr.write(`${message}\n`, () => process.exit(1));
    });
}

async function cmdRun(irFile: string | undefined, options: RunOptions): Promise<void> {
    try {
        // --from-snapshot is exclusive with <ir_file>, -i, -p
        if (options.fromSnapshot) {
            if (irFile || (options.input && options.input.length > 0) ||
                (options.package && options.package.length > 0)) {
                return fail('Error: --from-snapshot cannot be combined with <ir_file>, -i, or -p');
            }
            const ex = await readSnapshot(options.fromSnapshot);
            try {
                const platformFns = await loadPlatforms(ex.packages);
                await runProgram(
                    ex.irPath,
                    platformFns,
                    ex.packages,
                    ex.inputPaths,
                    options.output,
                    { verbose: options.verbose ?? false, ...streamingOptions(options) },
                );
            } finally {
                ex.cleanup();
            }
            return;
        }

        if (!irFile) {
            return fail('Error: Missing <ir_file> argument (or use --from-snapshot PATH)');
        }

        const packages = options.package ?? [];
        if (packages.length === 0) {
            return fail('Error: At least one platform package is required.\n' +
                'Example: east-node run program.beast2 -p @elaraai/east-node-std');
        }

        // The manifest carries no streaming flags (format v1), so a captured
        // emit/stream invocation would replay with the wrong arity — refuse
        // at capture with the fix instead of failing confusingly at replay.
        if (options.snapshot && (options.emit !== undefined || options.stream !== undefined)) {
            return fail(
                'Error: --snapshot does not capture --emit/--stream (snapshot format v1 has no ' +
                'streaming flags); replay with --from-snapshot passing --emit/--stream explicitly',
            );
        }

        // Write the snapshot BEFORE execution so crashes still leave the bundle behind.
        if (options.snapshot) {
            await writeSnapshot({
                outPath:    options.snapshot,
                irPath:     irFile,
                inputPaths: options.input ?? [],
                packages,
                cliVersion: `${pkg.name} ${pkg.version}`,
            });
            if (options.verbose) console.error(`Snapshot: ${options.snapshot}`);
        }

        const platformFns = await loadPlatforms(packages);

        await runProgram(
            irFile,
            platformFns,
            packages,
            options.input ?? [],
            options.output,
            { verbose: options.verbose ?? false, ...streamingOptions(options) }
        );
    } catch (err) {
        // A plain (non-East) error — e.g. one thrown by a custom platform
        // function — prints its STACK, not just the message: East runtime and
        // platform errors carry source-mapped frames (the platform code that
        // threw + the East call site), and the message alone drops them. The
        // stack already begins with `Error: <message>`, so don't re-prefix.
        const e = err as Error;
        return fail(err instanceof EastError
            ? `Error: ${err.toString()}`
            : (e.stack ?? `Error: ${e.message ?? String(err)}`));
    }
}

/**
 * `east-node transpile` (#628): print an IR file — or every IR file in a
 * directory — as the TypeScript `East.function` builder surface. With
 * `--rebuild`, the printed module is imported and the IR it builds is
 * written too: the round-trip check, and the TypeScript leg of the
 * cross-language conformance sweep.
 */
async function cmdTranspile(input: string, options: TranspileOptions): Promise<void> {
    try {
        const common: { name?: string; importFrom?: string } = {};
        if (options.name !== undefined) common.name = options.name;
        if (options.importFrom !== undefined) common.importFrom = options.importFrom;
        if (isDirectory(input)) {
            if (!options.output) {
                return fail('Error: transpiling a directory needs -o <directory> for the modules');
            }
            const stems = await transpileDir(input, options.output,
                options.rebuild !== undefined ? { ...common, rebuildDir: options.rebuild } : common);
            console.error(`Transpiled ${stems.length} IR file(s) to ${options.output}` +
                (options.rebuild ? `, rebuilt to ${options.rebuild}` : ''));
            return;
        }
        const { source, rebuilt } = await transpile(input, { ...common, rebuild: options.rebuild !== undefined });
        if (options.output) {
            writeFileSync(options.output, source, 'utf-8');
        } else {
            process.stdout.write(source);
        }
        if (options.rebuild) {
            writeFileSync(options.rebuild, encodeRebuilt(rebuilt!, options.rebuild));
        }
    } catch (err) {
        return fail(`Error: ${(err as Error).message}`);
    }
}

async function cmdVersion(options: VersionOptions): Promise<void> {
    console.log(`${pkg.name} ${pkg.version}`);

    // Try to get east version
    try {
        const eastPkg = require('@elaraai/east/package.json') as { version: string };
        console.log(`@elaraai/east ${eastPkg.version}`);
    } catch {
        // east package not found or no package.json export
    }

    const packages = options.package ?? [];
    if (packages.length > 0) {
        console.log('');
        console.log('Platforms:');

        for (const pkgName of packages) {
            try {
                const meta = await loadPlatformWithMetadata(pkgName);
                console.log(`  ${meta.name} ${meta.version} (${meta.fns.length} platform functions)`);
            } catch (err) {
                console.log(`  ${pkgName}: ${(err as Error).message}`);
            }
        }
    }
}

export function main(): void {
    const program = new Command();

    program
        .name('east-node')
        .description('Run East IR programs with Node.js platform functions')
        .version(pkg.version);

    program
        .command('run')
        .description('Run an East IR program')
        .argument('[ir_file]', 'Path to IR file (.beast2, .beast, .east, or .json)')
        .option('-p, --package <package...>', 'Platform packages to load (can be repeated)')
        .option('-i, --input <file...>', 'Input data files (order matches function parameters)')
        .option('-o, --output <file>', 'Output file path for result')
        .option('-v, --verbose', 'Enable verbose output')
        .option('--snapshot <path>', 'Write a .east-snapshot bundle (IR + inputs + manifest)')
        .option('--from-snapshot <path>',
            'Replay from a .east-snapshot bundle (exclusive with <ir_file>, -i, -p)')
        .option('--emit <kind>',
            "Write the output incrementally from the function's trailing emit parameter (array|set|dict)")
        .option('--stream <index>',
            'Feed the given -i input (0-based) lazily, segment-by-segment')
        .option('--lazy-inputs <bytes>',
            'Open indexed collection inputs at or above this size lazily (0 disables; default 64 MiB)')
        .action(cmdRun);

    program
        .command('transpile')
        .description('Print an East IR program as TypeScript East.function builder source')
        .argument('<input>', 'Path to an IR file (.beast2, .beast, .east, or .json), or a directory of them')
        .option('-o, --output <path>', 'Write the module here (a directory when <input> is one; default: stdout)')
        .option('--name <name>', 'The module-level export bound to the rebuilt function (default: main)')
        .option('--import-from <specifier>', 'The module the printed source imports East from (default: @elaraai/east)')
        .option('--rebuild <path>',
            'Import the printed module and write the IR it builds here (.beast2 or .json; a directory in directory mode)')
        .action(cmdTranspile);

    program
        .command('version')
        .description('Show version information')
        .option('-p, --package <package...>', 'Platform packages to check')
        .action(cmdVersion);

    program.parse();
}
