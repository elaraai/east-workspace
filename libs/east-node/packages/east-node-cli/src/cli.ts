/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Command } from 'commander';
import { createRequire } from 'module';
import { EastError } from '@elaraai/east/internal';
import { loadPlatforms, loadPlatformWithMetadata } from './loader.js';
import { runProgram } from './runner.js';
import { writeSnapshot, readSnapshot } from './snapshot.js';

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

async function cmdRun(irFile: string | undefined, options: RunOptions): Promise<void> {
    try {
        // --from-snapshot is exclusive with <ir_file>, -i, -p
        if (options.fromSnapshot) {
            if (irFile || (options.input && options.input.length > 0) ||
                (options.package && options.package.length > 0)) {
                console.error(
                    'Error: --from-snapshot cannot be combined with <ir_file>, -i, or -p',
                );
                process.exit(1);
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
            console.error('Error: Missing <ir_file> argument (or use --from-snapshot PATH)');
            process.exit(1);
        }

        const packages = options.package ?? [];
        if (packages.length === 0) {
            console.error('Error: At least one platform package is required.');
            console.error('Example: east-node run program.beast2 -p @elaraai/east-node-std');
            process.exit(1);
        }

        // The manifest carries no streaming flags (format v1), so a captured
        // emit/stream invocation would replay with the wrong arity — refuse
        // at capture with the fix instead of failing confusingly at replay.
        if (options.snapshot && (options.emit !== undefined || options.stream !== undefined)) {
            console.error(
                'Error: --snapshot does not capture --emit/--stream (snapshot format v1 has no ' +
                'streaming flags); replay with --from-snapshot passing --emit/--stream explicitly',
            );
            process.exit(1);
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
        if (err instanceof EastError) {
            console.error(`Error: ${err.toString()}`);
        } else {
            // A plain (non-East) error — e.g. one thrown by a custom platform
            // function. Print the STACK, not just the message: East runtime and
            // platform errors carry source-mapped frames (the platform code that
            // threw + the East call site), and the message alone drops them. The
            // stack already begins with `Error: <message>`, so don't re-prefix.
            const e = err as Error;
            console.error(e.stack ?? `Error: ${e.message ?? String(err)}`);
        }
        process.exit(1);
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
        .command('version')
        .description('Show version information')
        .option('-p, --package <package...>', 'Platform packages to check')
        .action(cmdVersion);

    program.parse();
}
