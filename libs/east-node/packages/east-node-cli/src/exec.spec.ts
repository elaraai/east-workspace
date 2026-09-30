/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `exec`, held to the runner protocol's conformance corpus: every case, run
 * through this runner, writes the corpus's bytes and comes to its outcome, as
 * east-c's and east-py's runners must. The corpus is `east`'s
 * (`test/runner_corpus.spec.ts`): read from `EAST_RUNNER_CORPUS` when that
 * names one, and written afresh for this run otherwise. `exec` is the file
 * wrapper of east's `executeUnit`, so every case also runs over the in-memory
 * UnitIO a browser gives it, which must write the very files `exec` writes.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ArrayType,
    Beast2ManifestWriter,
    BooleanType,
    DictType,
    East,
    FETCH_SEGMENTS_ENV,
    InMemoryUnitIO,
    IntegerType,
    NullType,
    StringType,
    UnitOutcomeType,
    UnitResultType,
    UnitType,
    decodeBeast2,
    decodeBeast2For,
    decodeCollectionManifest,
    encodeBeast2For,
    encodeEastIR,
    equalFor,
    executeUnit,
    printFor,
    variant,
    type UnitOutcome,
} from '@elaraai/east';
import { execUnit, readUnit } from './exec.js';
import { inputBytes, loadPlatform } from './loader.js';

const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));

/** An outcome as a message shows it. */
const printOutcome = printFor(UnitOutcomeType);

/** Every file under `root`, by its path relative to `root`, forward-slashed —
 *  the paths a unit names them by. */
function filesUnder(root: string): [string, Uint8Array][] {
    const files: [string, Uint8Array][] = [];
    const walk = (rel: string): void => {
        for (const name of readdirSync(join(root, rel))) {
            const path = rel === '' ? name : `${rel}/${name}`;
            if (statSync(join(root, path)).isDirectory()) walk(path);
            else files.push([path, new Uint8Array(readFileSync(join(root, path)))]);
        }
    };
    walk('');
    return files;
}

/**
 * Asserts an in-memory UnitIO holds the tree at `root`, and nothing else: each
 * directory's entries, and every file's bytes.
 */
function assertHoldsTree(io: InMemoryUnitIO, root: string, label: string): void {
    const walk = (rel: string): void => {
        const names = readdirSync(join(root, rel)).sort();
        assert.deepEqual(io.list(rel), names, `${label}: the entries of ${rel || '.'}`);
        for (const name of names) {
            const path = rel === '' ? name : `${rel}/${name}`;
            if (statSync(join(root, path)).isDirectory()) walk(path);
            else assert.deepEqual(io.read(path), new Uint8Array(readFileSync(join(root, path))), `${label}: ${path}`);
        }
    };
    walk('');
}

/** What a corpus case's `case.beast2` holds. How its inputs are read is the
 *  unit's own `decode`. */
interface RunnerCase {
    name: string;
    outcome: UnitOutcome;
    outputs: { path: string; bytes: Uint8Array }[];
    absent: string[];
}

describe('exec: the runner protocol corpus', () => {
    let corpus: string;
    let generated: string | undefined;
    let scratch: string;

    before(() => {
        scratch = mkdtempSync(join(tmpdir(), 'east-node-exec-'));
        if (process.env.EAST_RUNNER_CORPUS) {
            corpus = process.env.EAST_RUNNER_CORPUS;
            return;
        }
        generated = mkdtempSync(join(tmpdir(), 'east-runner-corpus-'));
        const spec = join(dirname(fileURLToPath(import.meta.resolve('@elaraai/east'))), '..', 'test', 'runner_corpus.spec.js');
        // Without this run's test context, which would make the child report
        // to it instead of running its own tests.
        const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
        const written = spawnSync(process.execPath, ['--enable-source-maps', '--test', spec], {
            env: { ...env, EXPORT_TEST_IR: generated },
            encoding: 'utf8',
        });
        assert.equal(written.status, 0, `writing the corpus failed:\n${written.stdout.slice(-4_000)}${written.stderr.slice(-4_000)}`);
        corpus = join(generated, 'runner_corpus');
    });

    after(() => {
        rmSync(scratch, { recursive: true, force: true });
        if (generated !== undefined) rmSync(generated, { recursive: true, force: true });
    });

    it('executes every case to its outputs and its outcome', () => {
        const names = decodeBeast2For(ArrayType(StringType))(readFileSync(join(corpus, 'index.beast2')));
        assert.ok(names.length > 0, 'the corpus holds cases');
        const equalOutcome = equalFor(UnitOutcomeType);
        for (const name of names) {
            const expected = decodeBeast2(readFileSync(join(corpus, name, 'case.beast2'))).value as RunnerCase;
            // A copy per case: a unit writes beside itself.
            const dir = join(scratch, name);
            cpSync(join(corpus, name), dir, { recursive: true });
            const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'unit.beast2')], { encoding: 'utf8' });
            const ok = expected.outcome.type === 'ok';
            assert.equal(run.status, ok ? 0 : 1, `${name}: exit ${run.status}\n${run.stderr.slice(-2_000)}`);
            const result = decodeBeast2For(UnitResultType)(readFileSync(join(dir, 'result.beast2')));
            assert.ok(equalOutcome(result.outcome, expected.outcome),
                `${name}: the outcome ${JSON.stringify(result.outcome, (_k, v: unknown) => typeof v === 'bigint' ? `${v}` : v)}`);
            assert.ok(result.peakBytes > 0n, `${name}: the peak is measured`);
            for (const output of expected.outputs) {
                const path = join(dir, output.path);
                assert.ok(existsSync(path), `${name}: ${output.path} is written`);
                assert.deepEqual(new Uint8Array(readFileSync(path)), new Uint8Array(output.bytes), `${name}: ${output.path}`);
            }
            for (const path of expected.absent) assert.ok(!existsSync(join(dir, path)), `${name}: ${path} is not written`);
        }
    });

    it('writes, over the in-memory UnitIO, the very files its file wrapper writes on disk, and comes to the same outcome', async () => {
        const names = decodeBeast2For(ArrayType(StringType))(readFileSync(join(corpus, 'index.beast2')));
        const equalOutcome = equalFor(UnitOutcomeType);
        // The file wrapper turns the fetch variable on or off for its process,
        // as its unit says: this one's is put back after.
        const fetching = process.env[FETCH_SEGMENTS_ENV];
        try {
            for (const name of names) {
                const expected = decodeBeast2(readFileSync(join(corpus, name, 'case.beast2'))).value as RunnerCase;
                // On disk: a copy of the case, executed by `exec`'s file
                // wrapper in this process — all of `exec` but the result file
                // it records and the exit status, which the case above holds.
                const dir = join(scratch, 'in-memory', name);
                cpSync(join(corpus, name), dir, { recursive: true });
                const onDisk = await execUnit(readUnit(join(dir, 'unit.beast2')));

                // In memory: the case's files as the corpus holds them, the
                // platforms resolved as the file wrapper resolves them.
                const io = new InMemoryUnitIO(filesUnder(join(corpus, name)));
                const unit = decodeBeast2For(UnitType)(io.read('unit.beast2'));
                const inMemory = await executeUnit(unit, io, { platforms: loadPlatform });
                assert.ok(equalOutcome(inMemory.outcome, onDisk.outcome), `${name}: in memory ${printOutcome(inMemory.outcome)}, on disk ${printOutcome(onDisk.outcome)}`);
                assert.ok(equalOutcome(inMemory.outcome, expected.outcome), `${name}: ${printOutcome(inMemory.outcome)}`);
                assert.ok(onDisk.peakBytes > 0n, `${name}: the process's peak is measured`);
                assert.equal(inMemory.peakBytes, 0n, `${name}: a host that measures no memory reports no peak`);
                // Every directory and file, byte for byte.
                assertHoldsTree(io, dir, name);
            }
        } finally {
            if (fetching === undefined) delete process.env[FETCH_SEGMENTS_ENV];
            else process.env[FETCH_SEGMENTS_ENV] = fetching;
        }
    });
});

describe('exec -v: the account of each input', () => {
    // The protocol e3 runs a task through, and the only form whose stderr
    // reaches its log: -v gives the account `run -v` gives.
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'east-node-exec-verbose-'));
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('says what each input weighs, how it opened as the unit says, and what reading it came to', () => {
        const DT = DictType(IntegerType, StringType);
        // The input as e3 stages it: a manifest directory, whose own file is
        // a few dozen bytes per segment.
        const input = join(dir, 'table.beast2');
        const objects = `${input}.segments`;
        mkdirSync(objects);
        const writer = new Beast2ManifestWriter(DT, {
            object: (hash, bytes) => writeFileSync(join(objects, `${hash}.beast2`), bytes),
            manifest: (bytes) => writeFileSync(input, bytes),
        });
        for (let i = 0; i < 20_000; i++) writer.add([BigInt(i), `row-${i}`]);
        writer.finish();
        writeFileSync(join(dir, 'program.beast2'), encodeEastIR(East.function([DT], BooleanType, ($, table) => table.has(42n)).toIR()));
        const writeUnit = (decode: 'lazy' | 'whole'): void => {
            rmSync(join(dir, 'out.beast2'), { force: true });
            writeFileSync(join(dir, 'unit.beast2'), encodeBeast2For(UnitType)({
                work: variant('run', {
                    program: 'program.beast2',
                    inputs: ['table.beast2'],
                    output: variant('value', 'out.beast2'),
                    decode: decode === 'lazy' ? variant('lazy', null) : variant('whole', null),
                }),
                platforms: [],
                threads: 1n,
                fetch: false,
                result: 'result.beast2',
            }));
        };

        const exec = (...flags: string[]): string => {
            const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'unit.beast2'), ...flags], { encoding: 'utf8' });
            assert.equal(run.status, 0, run.stderr);
            return run.stderr;
        };
        writeUnit('lazy');
        const verbose = exec('-v');
        const formatSize = (bytes: number): string => bytes < 1024 ? `${bytes} B`
            : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        assert.ok(inputBytes(input) > 4 * statSync(input).size, 'the manifest weighs far less than the collection');
        assert.ok(verbose.includes(`  input 0: ${input}  (${formatSize(inputBytes(input))})`),
            `the input is weighed by the collection, not its manifest:\n${verbose}`);
        assert.ok(verbose.includes('input 0: opened lazily'), `the input opened lazily:\n${verbose}`);
        // One keyed read: its segment decoded, and every fence the manifest
        // carries probed once.
        assert.ok(/input 0: 1 of (\d+) segments decoded, \1 fences probed — [\d.]+ (B|KB|MB) read of /.test(verbose), `what reading it came to:\n${verbose}`);
        assert.ok(!exec().includes('input 0:'), 'without -v the inputs are not reported');

        // A unit whose `decode` is whole decodes the input before the program
        // runs, and says what it holds in memory.
        writeUnit('whole');
        const whole = exec('-v');
        assert.ok(!whole.includes('opened lazily'), `a whole unit opened its input lazily:\n${whole}`);
        assert.match(whole, /input 0: decoded whole — \+[\d.]+ (B|KB|MB) resident/);
    });
});

describe('exec: a unit whose host places segments as they are read', () => {
    // A host whose store is elsewhere stages a manifest without its segments
    // and places each as the runner asks for it: `<segment>.want`, answered
    // with the file or with `<segment>.error`. Only a unit that says `fetch`
    // asks.
    const DT = DictType(IntegerType, StringType);
    let dir: string;
    let input: string;
    let segmentDir: string;
    let store: string;
    let segments: string[];

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'east-node-exec-fetch-'));
        input = join(dir, 'table.beast2');
        segmentDir = `${input}.segments`;
        store = join(dir, 'store');
        mkdirSync(segmentDir);
        mkdirSync(store);
        // Staged as e3 stages it, and every segment moved to the host's store.
        const writer = new Beast2ManifestWriter(DT, {
            object: (hash, bytes) => writeFileSync(join(store, `${hash}.beast2`), bytes),
            manifest: (bytes) => writeFileSync(input, bytes),
        });
        for (let i = 0; i < 20_000; i++) writer.add([BigInt(i), `row-${i}`]);
        writer.finish();
        segments = decodeCollectionManifest(new Uint8Array(readFileSync(input))).entries.map((entry) => `${entry.hash}.beast2`);
        assert.ok(segments.length > 4, `several segments, got ${segments.length}`);
        writeFileSync(join(dir, 'program.beast2'), encodeEastIR(East.function([DT], StringType, ($, table) => table.get(9_999n)).toIR()));
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Each run starts with no segment placed, and nothing asked for.
        for (const name of readdirSync(segmentDir)) rmSync(join(segmentDir, name));
        rmSync(join(dir, 'out.beast2'), { force: true });
        rmSync(join(dir, 'result.beast2'), { force: true });
    });

    /** Writes the unit: the program on the table, fetching or not, lazily or
     *  whole. */
    function writeUnit(fetch: boolean, decode: 'lazy' | 'whole'): string {
        const unitPath = join(dir, 'unit.beast2');
        writeFileSync(unitPath, encodeBeast2For(UnitType)({
            work: variant('run', {
                program: 'program.beast2',
                inputs: ['table.beast2'],
                output: variant('value', 'out.beast2'),
                decode: decode === 'lazy' ? variant('lazy', null) : variant('whole', null),
            }),
            platforms: [],
            threads: 1n,
            fetch,
            result: 'result.beast2',
        }));
        return unitPath;
    }

    /**
     * Executes a unit while this process is its host, placing each segment it
     * asks for from the store — or, given a refusal, answering each ask with
     * it — within a bounded wait.
     *
     * @returns the exit status, stderr, and the segments asked for, in order
     */
    async function execHosted(unitPath: string, refusal?: string): Promise<{ status: number | null; stderr: string; asked: string[] }> {
        const child = spawn(process.execPath, [bin, 'exec', unitPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        const closed = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
        const asked: string[] = [];
        const host = setInterval(() => {
            for (const name of readdirSync(segmentDir)) {
                if (!name.endsWith('.want')) continue;
                const segment = name.slice(0, -'.want'.length);
                if (asked.includes(segment)) continue;
                asked.push(segment);
                const file = join(segmentDir, segment);
                // Whole, or not at all: the runner reads either file the moment
                // it is there, so each is written under a name of its own and
                // renamed into place, as e3's host writes them.
                if (refusal !== undefined) {
                    writeFileSync(`${file}.error.partial`, refusal);
                    renameSync(`${file}.error.partial`, `${file}.error`);
                } else {
                    copyFileSync(join(store, segment), `${file}.placing`);
                    renameSync(`${file}.placing`, file);
                }
            }
        }, 2);
        let timer: NodeJS.Timeout | undefined;
        try {
            const status = await Promise.race([closed, new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), 60_000); })]);
            assert.notEqual(status, 'late', `the runner did not finish within 60 s:\n${stderr}`);
            return { status: status as number | null, stderr, asked };
        } finally {
            clearInterval(host);
            clearTimeout(timer);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
    }

    /** The unit's recorded outcome. */
    const outcome = (): UnitOutcome => decodeBeast2For(UnitResultType)(readFileSync(join(dir, 'result.beast2'))).outcome;

    it('asks for the one segment a lazy read reads, and for every segment a whole decode reads', async () => {
        const lazy = await execHosted(writeUnit(true, 'lazy'));
        assert.equal(lazy.status, 0, lazy.stderr);
        assert.equal(decodeBeast2For(StringType)(readFileSync(join(dir, 'out.beast2'))), 'row-9999');
        assert.equal(lazy.asked.length, 1, `one segment asked for, of ${segments.length}: ${lazy.asked.join(', ')}`);
        assert.ok(segments.includes(lazy.asked[0]!), 'a segment the manifest names');

        for (const name of readdirSync(segmentDir)) rmSync(join(segmentDir, name));
        const whole = await execHosted(writeUnit(true, 'whole'));
        assert.equal(whole.status, 0, whole.stderr);
        assert.equal(decodeBeast2For(StringType)(readFileSync(join(dir, 'out.beast2'))), 'row-9999');
        assert.deepEqual(whole.asked, segments, 'every segment, in the manifest\'s order');
    });

    it('fails in the host\'s words when the host cannot place a segment', async () => {
        const refused = await execHosted(writeUnit(true, 'lazy'), 'the store is throttling');
        assert.equal(refused.status, 1, refused.stderr);
        const failed = outcome();
        if (failed.type !== 'failed') assert.fail(`the outcome is ${failed.type}`);
        // The segment as every runner names it: `<input>.segments/<hash>.beast2`.
        assert.equal(failed.value.message, `beast2 v5: manifest segment ${input}.segments/${refused.asked[0]} cannot be placed: the store is throttling`);
        assert.ok(!existsSync(join(dir, 'out.beast2')), 'nothing is written');
    });

    it('asks for nothing for a unit that does not say fetch, and fails on the absent segment at once', async () => {
        const unasked = await execHosted(writeUnit(false, 'lazy'));
        assert.equal(unasked.status, 1, unasked.stderr);
        assert.deepEqual(unasked.asked, []);
        assert.deepEqual(readdirSync(segmentDir), [], 'no segment asked for');
        const failed = outcome();
        if (failed.type !== 'failed') assert.fail(`the outcome is ${failed.type}`);
        assert.match(failed.value.message, /^ENOENT: no such file or directory, open '.*\.beast2'$/);
    });
});

describe('exec: a unit given no platform', () => {
    // A unit whose platforms are empty loads none, so a program calling one
    // fails, naming it: e3 lets a reader run a one-shot on such a unit.
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'east-node-exec-platforms-'));
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('fails a program that calls a platform function, naming it', () => {
        // east-node-std's, by the name it declares it under
        const consoleLog = East.platform('console_log', [StringType], NullType);
        const program = East.function([IntegerType], IntegerType, ($, x) => {
            $(consoleLog(East.print(x)));
            return x;
        });
        writeFileSync(join(dir, 'program.beast2'), encodeEastIR(program.toIR()));
        writeFileSync(join(dir, 'x.beast2'), encodeBeast2For(IntegerType)(7n));
        writeFileSync(join(dir, 'unit.beast2'), encodeBeast2For(UnitType)({
            work: variant('run', { program: 'program.beast2', inputs: ['x.beast2'], output: variant('value', 'out.beast2'), decode: variant('lazy', null) }),
            platforms: [],
            threads: 1n,
            fetch: false,
            result: 'result.beast2',
        }));

        const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'unit.beast2')], { encoding: 'utf8' });
        assert.equal(run.status, 1, run.stderr);
        const { outcome } = decodeBeast2For(UnitResultType)(readFileSync(join(dir, 'result.beast2')));
        if (outcome.type !== 'failed') assert.fail(`the outcome is ${outcome.type}`);
        assert.match(outcome.value.message, /console_log/);
        assert.ok(!existsSync(join(dir, 'out.beast2')), 'nothing is written');
    });
});

describe('exec: a unit it cannot read', () => {
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'east-node-exec-unread-'));
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('leaves no result, and exits 2', () => {
        writeFileSync(join(dir, 'garbage.beast2'), 'not a unit');
        const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'garbage.beast2')], { encoding: 'utf8' });
        assert.equal(run.status, 2);
        assert.match(run.stderr, /^Error: exec /);
    });
});
