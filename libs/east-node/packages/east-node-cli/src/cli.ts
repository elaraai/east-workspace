/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'module';
import { EastError } from '@elaraai/east/internal';
import { loadPlatforms, loadPlatformWithMetadata } from './loader.js';
import { runProgram, UsageError, type RunProgramOptions } from './runner.js';
import { mergeBlobs } from './merge.js';
import { writeSnapshot, readSnapshot } from './snapshot.js';
import { encodeRebuilt, isDirectory, transpile, transpileDir } from './transpile.js';
import { exportFunctionsFromModule } from './export-functions.js';
import { serve as serveLsp } from './lsp.js';
import { checkModule, formatFinding } from './check.js';
import { East } from '@elaraai/east';

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
    stream?: string[];
    merge?: string;
    union?: boolean;
    lazyInputs?: string;
    exitWithParent?: boolean;
}

interface MergeOptions {
    package?: string[];
    input: string[];
    output?: string;
    verbose?: boolean;
    merge?: string;
    union?: boolean;
    range?: string;
    exitWithParent?: boolean;
}

/**
 * Collects a repeated option's values.
 *
 * Every repeatable flag takes ONE value and is given again for the next —
 * `-i a -i b`, `--stream 0 --stream 1` — which is the grammar east-c and
 * east-py accept and all three READMEs document. Commander's variadic form
 * (`<file...>`) would also swallow the following positional, so
 * `run --stream 0 program.beast2` lost its IR file and reported it missing.
 */
function collect(value: string, previous: string[]): string[] {
    return [...previous, value];
}

/** The `--exit-with-parent` flag's help, shared by `run` and `merge`. */
const EXIT_WITH_PARENT_HELP =
    'Exit as soon as stdin reaches end of file — for a parent that holds a stdin pipe it never writes to, and takes the runner down with it';

/** Parses the streaming-execution flags into runner options. */
function streamingOptions(options: RunOptions): RunProgramOptions {
    const out: RunProgramOptions = {};
    if (options.emit !== undefined) {
        if (options.emit !== 'array' && options.emit !== 'set' && options.emit !== 'dict') {
            throw new UsageError(`--emit must be one of array, set or dict, got '${options.emit}'`);
        }
        out.emit = options.emit;
    }
    if (options.merge !== undefined) {
        if (out.emit !== 'dict') throw new UsageError('--merge applies to --emit dict only');
        out.merge = options.merge;
    }
    if (options.union) {
        if (out.emit !== 'set') throw new UsageError('--union applies to --emit set only');
        out.union = true;
    }
    if (options.stream !== undefined) {
        out.streamInputs = options.stream.map((raw) => {
            const index = Number(raw);
            if (!Number.isInteger(index) || index < 0) {
                throw new UsageError(`--stream must be a non-negative input index, got '${raw}'`);
            }
            return index;
        });
    }
    if (options.lazyInputs !== undefined) {
        const bytes = Number(options.lazyInputs);
        if (!Number.isFinite(bytes) || bytes < 0) {
            throw new UsageError(`--lazy-inputs must be a byte threshold (0 disables), got '${options.lazyInputs}'`);
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

interface ExportFunctionsOptions {
    output: string;
    package?: string[];
    name?: string;
    packageVersion?: string;
    only?: string[];
}

/**
 * Print `message` to stderr and exit 1 once the write has FLUSHED.
 *
 * A write to `process.stderr` is asynchronous on a POSIX pipe (and on a
 * Windows terminal), so `console.error(...)` followed by `process.exit(1)` can
 * end the process before the message is written — and e3 spawns this CLI with
 * stdio pipes and surfaces the stderr tail on failure. Exiting from the write
 * callback lets the whole message through. The returned promise never
 * resolves (the process exits from the write callback), so `return fail(...)`
 * ends the caller exactly like the exit it replaces.
 */
function fail(message: string): Promise<never> {
    process.exitCode = 1;
    return new Promise(() => {
        process.stderr.write(`${message}\n`, () => process.exit(1));
    });
}

/**
 * The exit-with-parent watcher (issue #770), run on a worker thread: it reads
 * stdin through a socket on the worker's own event loop, and once stdin ends,
 * closes or cannot be read it kills the whole process — `process.exit` inside
 * a worker ends only the worker.
 *
 * It never blocks in a read. Process exit joins worker threads, so a worker
 * blocked in `fs.readSync(0)` keeps the runner from ever exiting: a read that
 * starts before stdin is non-blocking stays blocked, and on Windows libuv
 * keeps pipes in blocking mode. An evented read stops with the worker's loop
 * (on a synchronous Windows pipe libuv cancels its blocking read).
 */
const EXIT_WITH_PARENT_WATCHER = `
const { Socket } = require('node:net');
const stop = () => process.kill(process.pid, 'SIGKILL');
try {
    const stdin = new Socket({ fd: 0, readable: true, writable: false });
    stdin.on('end', stop);
    stdin.on('close', stop);
    stdin.on('error', stop);
    stdin.resume();
} catch {
    stop();
}
`;

/**
 * Exit with the parent (issue #770): with `--exit-with-parent` on the
 * command line, start the watcher on an unref'd worker thread. A parent
 * passes the flag only when it gives the runner a stdin pipe it never writes
 * to, so stdin ends only when that parent is gone. The main thread never
 * reads `process.stdin`, but it opens it first: on Windows a read pending on
 * a synchronous pipe holds the pipe's file-object lock, so once the watcher
 * reads, opening stdin — which the first ESM import of `node:process` does,
 * the builtin's facade reading every export — would wait for the parent to
 * go. Opened now, stdin is one stream every later use shares. (e3 hands its
 * runners an overlapped pipe, whose reads take no such lock; this keeps the
 * runner whole under any parent.)
 */
function startLifeline(options: { exitWithParent?: boolean }): void {
    if (!options.exitWithParent) return;
    void process.stdin;
    new Worker(EXIT_WITH_PARENT_WATCHER, { eval: true }).unref();
}

async function cmdRun(irFile: string | undefined, options: RunOptions): Promise<void> {
    startLifeline(options);
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
        // A refusal of the command line is the user's error: one sentence, as
        // east-c and east-py give it. A stack belongs only to an error thrown
        // from East or a platform function, where the frames ARE the answer.
        if (err instanceof UsageError) return fail(`Error: ${e.message}`);
        return fail(err instanceof EastError
            ? `Error: ${err.toString()}`
            : (e.stack ?? `Error: ${e.message ?? String(err)}`));
    }
}

/**
 * `east-node merge` (#770): k sorted Set/Dict blobs or manifest directories
 * of one type into one canonical blob, in a single pass — the fan-in of a
 * partitioned task's keyed partials.
 */
async function cmdMerge(options: MergeOptions): Promise<void> {
    startLifeline(options);
    try {
        // The same rules, in the same words, as east-c and east-py: a merge
        // needs at least one input, an output, one fold at most, and writes a
        // beast2 stream exactly as `run --emit` does.
        if (options.input.length === 0) {
            return fail('Error: merge requires at least one -i input');
        }
        if (options.output === undefined) {
            return fail('Error: merge requires -o FILE');
        }
        if (options.merge !== undefined && options.union) {
            return fail('Error: --merge and --union are two folds — give one');
        }
        if (extname(options.output).toLowerCase() !== '.beast2') {
            return fail('Error: merge requires a .beast2 output file (-o)');
        }
        const platformFns = await loadPlatforms(options.package ?? []);
        mergeBlobs(options.input, options.output, {
            ...(options.merge !== undefined && { mergePath: options.merge }),
            ...(options.range !== undefined && { rangePath: options.range }),
            union: options.union ?? false,
            platformFns,
            verbose: options.verbose ?? false,
        });
    } catch (err) {
        return fail(`Error: ${(err as Error).message}`);
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

/**
 * `east-node export-functions` (#628): write a module's `eastFunctions` as a
 * function manifest other packages — in TypeScript or python — import.
 */
async function cmdExportFunctions(modulePath: string, options: ExportFunctionsOptions): Promise<void> {
    try {
        const opts: { name?: string; version?: string; packages?: string[]; only?: string[] } = { packages: options.package ?? [] };
        if (options.name !== undefined) opts.name = options.name;
        if (options.packageVersion !== undefined) opts.version = options.packageVersion;
        if (options.only !== undefined) opts.only = options.only;
        const manifest = await exportFunctionsFromModule(modulePath, opts);
        writeFileSync(options.output, East.encodeFunctionManifest(manifest));
        console.error(`Exported ${manifest.functions.length} function(s) of ${manifest.package}@${manifest.version} to ${options.output}`);
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
        .option('-p, --package <package>', 'Platform package to load (can be repeated)', collect, [])
        .option('-i, --input <file>', 'Input data file (can be repeated, order matches function parameters)', collect, [])
        .option('-o, --output <file>', 'Output file path for result')
        .option('-v, --verbose', 'Enable verbose output')
        .option('--snapshot <path>', 'Write a .east-snapshot bundle (IR + inputs + manifest)')
        .option('--from-snapshot <path>',
            'Replay from a .east-snapshot bundle (exclusive with <ir_file>, -i, -p)')
        .option('--emit <kind>',
            "Write the output incrementally from the function's trailing emit parameter (array|set|dict)")
        .option('--merge <file>',
            'With --emit dict: fold equal keys with the East function (K, V, V) -> V in <file>, in emission order')
        .option('--union', 'With --emit set: collapse equal elements')
        .option('--stream <index>',
            'Feed the given -i input (0-based) lazily, segment-by-segment (can be repeated)', collect, [])
        .option('--lazy-inputs <bytes>',
            'Open indexed collection inputs at or above this size lazily (0 disables; default 64 MiB)')
        .option('--exit-with-parent', EXIT_WITH_PARENT_HELP)
        .action(cmdRun);

    program
        .command('merge')
        .description('Merge sorted Set or Dict blobs of one type into one, in a single pass: equal keys fold with ' +
            'the East function (K, V, V) -> V in --merge <file> (Dict), or collapse under --union (Set); without ' +
            'a fold an equal key is an error. The output is what `run --emit` writes for the same entries emitted ascending')
        .option('-i, --input <file>', 'An input blob or manifest (can be repeated; equal keys fold in this order)', collect, [])
        .option('-o, --output <file>', 'The merged blob')
        .option('-p, --package <package>', "Platform package the --merge function's platform calls need (can be repeated)", collect, [])
        .option('-v, --verbose', 'Enable verbose output')
        .option('--merge <file>', 'Dict inputs: fold equal keys with the East function (K, V, V) -> V in <file>, in input order')
        .option('--union', 'Set inputs: the first of equal elements stands')
        .option('--range <file>',
            "Merge only the keys in [from, to): a beast2 blob of Struct{from: Option<K>, to: Option<K>} over the inputs' key type; an absent bound is open")
        .option('--exit-with-parent', EXIT_WITH_PARENT_HELP)
        .action(cmdMerge);

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
        .command('export-functions')
        .description("Write a module's `eastFunctions` export as a function manifest other packages (TypeScript or python) import")
        .argument('<module>', 'Path to the built module exporting `eastFunctions` (name -> East.function)')
        .requiredOption('-o, --output <file>', 'The manifest to write (.beast2)')
        .option('-p, --package <package...>', "Platform packages implementing the functions' platform calls (each dependency must be provided by one)")
        .option('--name <name>', "The package name importers use (default: the module file's stem)")
        .option('--package-version <version>', 'The version recorded in the manifest (default: 0.0.0)')
        .option('--only <name...>', 'Export only these functions of `eastFunctions` (default: all)')
        .action(cmdExportFunctions);

    program
        .command('check')
        .description("Build a module's East functions and report the build's own errors at their lines — the errors tsc cannot see")
        .argument('<module...>', 'Path(s) to the built module(s) to check')
        .option('--format <kind>', 'text (default) or json — the record shape `east-py check --format json` emits', 'text')
        .action(async (modulePaths: string[], options: { format?: string }) => {
            if (options.format !== 'text' && options.format !== 'json') {
                return fail(`Error: --format must be text or json, got '${options.format}'`);
            }
            const findings = [];
            for (const modulePath of modulePaths) findings.push(...await checkModule(modulePath));
            if (options.format === 'json') {
                console.log(JSON.stringify(findings, null, 2));
            } else {
                for (const finding of findings) console.log(formatFinding(finding));
                console.log(findings.length === 0
                    ? 'All clear.'
                    : `Found ${findings.length} build error${findings.length === 1 ? '' : 's'}.`);
            }
            if (findings.length > 0) process.exit(1);
        });

    program
        .command('lsp')
        .description('Serve the East diagnostics as a Language Server over stdio (needs @elaraai/east-diagnostics)')
        .action(async () => {
            const code = await serveLsp();
            if (code !== 0) process.exit(code);
        });

    program
        .command('version')
        .description('Show version information')
        .option('-p, --package <package>', 'Platform package to check (can be repeated)', collect, [])
        .action(cmdVersion);

    program.parse();
}
