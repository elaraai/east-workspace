/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-node exec <unit.beast2>`: the runner protocol.
 *
 * A unit (`UnitType` in `@elaraai/east`) runs a program on its inputs, or
 * merges the parts of one output that earlier units wrote, and names where its
 * output and its result go. The output is written by its kind:
 * - a value as one blob, or as a manifest directory when it is a collection;
 * - an array through the Writer;
 * - a set or a dict through the RunSorter, as sorted runs;
 * - a fold by folding every emitted value into an accumulator.
 *
 * Collections are written as manifest directories, which a store takes in by
 * linking their files. The result (`UnitResultType`) records the outcome — `ok`,
 * or the failure's message and source locations — with the process's peak
 * memory and where the time went. east-c and east-py implement the same
 * protocol, and the conformance corpus holds the three to the same output
 * bytes and outcomes.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
    Beast2ManifestWriter,
    Beast2RunSorter,
    EastError,
    EastIR,
    SortedMap,
    SortedSet,
    UnitType,
    compareFor,
    configureFramePool,
    decodeBeast2For,
    encodeBeast2For,
    isTypeValueEqual,
    variant,
    type Beast2ManifestSink,
    type EastTypeValue,
    type Unit,
    type UnitOutcome,
    type UnitOutput,
    type UnitResult,
    type UnitTimings,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { inputBytes, loadEastIR, loadInput, loadInputLazy, loadPlatforms, segmentDirFor } from './loader.js';
import { mergeBlobs } from './merge.js';
import { lazyThreshold, loadMergeFunction, peakBytes } from './runner.js';

/** A unit's `run` work. */
type RunWork = Extract<Unit['work'], { type: 'run' }>['value'];

/** A unit's `merge` work. */
type MergeWork = Extract<Unit['work'], { type: 'merge' }>['value'];

/** Resolves a path a unit names. */
type Resolve = (path: string) => string;

/** Adds the time since the last lap to one phase of the result's timings. */
type Lap = (phase: keyof UnitTimings) => void;

/** A unit read from its file, and how to find what it names. */
export interface ReadUnit {
    /** The unit, as its file holds it. */
    unit: Unit;
    /** Resolves a path the unit names: a relative one against the unit file's
     *  directory, so a unit and the files it names move together. */
    at: Resolve;
}

/**
 * Reads a unit file.
 *
 * @param unitPath - the unit file
 * @returns the unit, and how to resolve the paths it names
 * @throws {Error} When the file cannot be read or does not hold a unit.
 */
export function readUnit(unitPath: string): ReadUnit {
    const unit = decodeBeast2For(UnitType)(readFileSync(unitPath));
    const base = dirname(resolve(unitPath));
    return { unit, at: (path) => (isAbsolute(path) ? path : resolve(base, path)) };
}

/**
 * Executes a unit: does its work, writes its output, and reports how it went.
 *
 * @param read - the unit, and how to resolve the paths it names
 * @returns the result — a failure is its outcome, never a throw
 *
 * @remarks
 * The unit's thread grant caps the frame pool for the rest of the process: a
 * grant of one frames every output inline.
 */
export async function executeUnit({ unit, at }: ReadUnit): Promise<UnitResult> {
    configureFramePool({ workers: Number(unit.threads) });
    const timings = { load: 0, compile: 0, execute: 0, output: 0 };
    let mark = performance.now();
    const lap: Lap = (phase) => {
        const now = performance.now();
        timings[phase] += now - mark;
        mark = now;
    };
    let outcome: UnitOutcome;
    try {
        const platformFns = await loadPlatforms(unit.platforms);
        if (unit.work.type === 'run') {
            await runWork(unit.work.value, platformFns, at, lap);
        } else {
            mergeWork(unit.work.value, platformFns, at, lap);
        }
        outcome = variant('ok', null);
    } catch (err) {
        outcome = err instanceof EastError
            ? variant('failed', { message: err.eastMessage, locations: err.location })
            : variant('failed', { message: (err as Error)?.message ?? String(err), locations: [] });
    }
    return { outcome, peakBytes: peakBytes(), timings };
}

/** Runs a program on its inputs and writes what it produces. */
async function runWork(work: RunWork, platformFns: PlatformFunction[], at: Resolve, lap: Lap): Promise<void> {
    const program = loadEastIR(at(work.program));
    const signature = (program.ir as { value: { type: EastTypeValue } }).value.type.value as { inputs: EastTypeValue[]; output: EastTypeValue };
    // Every kind but a value is emitted, through the trailing parameter.
    const emitted = work.output.type !== 'value';
    if (emitted && signature.inputs.length === 0) {
        throw new Error(`exec: a ${work.output.type} output is emitted: the program's trailing parameter must be emit, a function`);
    }
    const params = emitted ? signature.inputs.slice(0, -1) : signature.inputs;
    if (work.inputs.length !== params.length) {
        const printed = `(${signature.inputs.map((type) => printTypeValue(type)).join(', ')}) -> ${printTypeValue(signature.output)}`;
        throw new Error(`Function expects ${params.length} inputs, got ${work.inputs.length}\nSignature: ${printed}`);
    }
    // Inputs are frozen. One at or above the lazy threshold opens as a paged
    // value, weighed by the value it holds: a manifest is a small file naming
    // large ones.
    const threshold = lazyThreshold();
    const inputs = work.inputs.map((input, i) => {
        const path = at(input);
        const lazy = threshold > 0 && inputBytes(path) >= threshold ? loadInputLazy(path) : undefined;
        return lazy !== undefined ? lazy : loadInput(path, params[i]!);
    });
    lap('load');
    const compiled = (program as EastIR<unknown[], unknown>).compile(platformFns);
    const output = openOutput(work.output, emitted ? signature.inputs.at(-1)! : signature.output, platformFns, at);
    lap('compile');
    const result = await compiled(...inputs, ...(output.emit !== undefined ? [output.emit] : []));
    lap('execute');
    output.finish(result);
    lap('output');
}

/** Where a running program's output goes. */
interface OutputSink {
    /** The emit capability, passed as the program's trailing parameter —
     *  absent for a value, which the program returns. */
    emit?: (...args: unknown[]) => null;
    /** Writes the output, given what the program returned. */
    finish(result: unknown): void;
}

/**
 * Opens a running program's output.
 *
 * @param output - the output
 * @param type - the program's result type, for a value; its emit parameter's
 *   type otherwise
 * @param platformFns - the platforms a fold's functions compile with
 * @param at - resolves the paths the output names
 * @returns the sink
 * @throws {Error} When the emit parameter does not fit the kind, a fold's
 *   function does not fit the emitted type, or an output directory holds
 *   anything already.
 */
function openOutput(output: UnitOutput, type: EastTypeValue, platformFns: PlatformFunction[], at: Resolve): OutputSink {
    if (output.type === 'value') {
        const path = at(output.value);
        return { finish: (result) => writeValue(path, type, result) };
    }
    const arity = output.type === 'dict' ? 2 : 1;
    const emitInputs = type.type === 'Function' ? (type.value as { inputs: EastTypeValue[] }).inputs : null;
    if (emitInputs === null || emitInputs.length !== arity) {
        throw new Error(`exec: a ${output.type} output is emitted: the program's trailing parameter must be emit, a function of ${arity} argument${arity === 1 ? '' : 's'}, got ${printTypeValue(type)}`);
    }
    const element = emitInputs[0]!;
    switch (output.type) {
        case 'array': {
            const writer = new Beast2ManifestWriter(variant('Array', element) as EastTypeValue, manifestDirectory(join(outputDirectory(at(output.value)), '0.beast2')), { parallel: true });
            return {
                emit: (value) => { writer.add(value); return null; },
                finish: () => writer.finish(),
            };
        }
        case 'set': {
            const dir = outputDirectory(at(output.value));
            const sorter = new Beast2RunSorter(variant('Set', element) as EastTypeValue, (run) => manifestDirectory(join(dir, `${run}.beast2`)), { union: true, parallel: true });
            return {
                emit: (value) => { sorter.add(value); return null; },
                finish: () => sorter.finish(),
            };
        }
        case 'dict': {
            const value = emitInputs[1]!;
            const merge = output.value.merge.type === 'some'
                ? loadMergeFunction(at(output.value.merge.value), element, value, platformFns, 'the emit parameter')
                : undefined;
            const dir = outputDirectory(at(output.value.dir));
            const sorter = new Beast2RunSorter(variant('Dict', { key: element, value }) as EastTypeValue, (run) => manifestDirectory(join(dir, `${run}.beast2`)), { ...(merge !== undefined && { merge }), parallel: true });
            return {
                emit: (key, entry) => { sorter.add([key, entry]); return null; },
                finish: () => sorter.finish(),
            };
        }
        case 'fold': {
            const { combine } = loadCombineFunction(at(output.value.combine), element, platformFns);
            const path = at(output.value.path);
            let acc = loadInput(at(output.value.zero), element);
            return {
                emit: (value) => { acc = combine(acc, value); return null; },
                finish: () => writeValue(path, element, acc),
            };
        }
    }
}

/** Assembles the parts of one output into one. */
function mergeWork(work: MergeWork, platformFns: PlatformFunction[], at: Resolve, lap: Lap): void {
    const output = work.output;
    const parts = work.parts.map((part) => at(part));
    switch (output.type) {
        case 'set':
        case 'dict': {
            const dir = outputDirectory(at(output.type === 'set' ? output.value : output.value.dir));
            lap('load');
            mergeBlobs(parts, manifestDirectory(join(dir, '0.beast2')), {
                union: output.type === 'set',
                ...(output.type === 'dict' && output.value.merge.type === 'some' && { mergePath: at(output.value.merge.value) }),
                ...(work.range.type === 'some' && { rangePath: at(work.range.value) }),
                platformFns,
            });
            lap('execute');
            return;
        }
        case 'fold': {
            const { combine, type } = loadCombineFunction(at(output.value.combine), null, platformFns);
            let acc = loadInput(at(output.value.zero), type);
            lap('compile');
            for (const part of parts) acc = combine(acc, loadInput(part, type));
            lap('execute');
            writeValue(at(output.value.path), type, acc);
            lap('output');
            return;
        }
        case 'array':
            throw new Error("exec: an array's parts are concatenated, never merged: a merge unit takes set, dict or fold parts");
        case 'value':
            throw new Error('exec: a value has no parts: a merge unit takes set, dict or fold parts');
    }
}

/**
 * Loads a fold's `combine`: an IR file holding a `(T, T) -> T` East function,
 * compiled with the unit's platforms.
 *
 * @param path - the IR file
 * @param type - the emitted type, or `null` to take `T` from the function —
 *   a merge of fold partials has no program to say what was emitted
 * @param platformFns - the unit's platforms
 * @returns the compiled function, and `T`
 * @throws {Error} When the IR is not a function of that shape.
 */
function loadCombineFunction(path: string, type: EastTypeValue | null, platformFns: PlatformFunction[]): { combine: (acc: unknown, value: unknown) => unknown; type: EastTypeValue } {
    const bundle = loadEastIR(path);
    const fnType = (bundle.ir as { value: { type: EastTypeValue } }).value.type;
    const shape = fnType.type === 'Function' ? fnType.value as { inputs: EastTypeValue[]; output: EastTypeValue } : null;
    const t = type ?? shape?.output;
    if (shape === null || t === undefined || shape.inputs.length !== 2 ||
        !isTypeValueEqual(shape.inputs[0]!, t) ||
        !isTypeValueEqual(shape.inputs[1]!, t) ||
        !isTypeValueEqual(shape.output, t)) {
        const expected = t !== undefined ? ` (T = ${printTypeValue(t)})` : '';
        throw new Error(`exec: combine: expected a function (T, T) -> T${expected}, got ${printTypeValue(fnType)}`);
    }
    return { combine: (bundle as EastIR<unknown[], unknown>).compile(platformFns) as (acc: unknown, value: unknown) => unknown, type: t };
}

/**
 * Writes a value output: a collection as a manifest directory at `path`,
 * anything else as one blob there.
 *
 * @param path - the output file
 * @param type - the value's type
 * @param value - the value
 */
function writeValue(path: string, type: EastTypeValue, value: unknown): void {
    if (type.type !== 'Array' && type.type !== 'Set' && type.type !== 'Dict') {
        writeFileSync(path, encodeBeast2For(type)(value));
        return;
    }
    // A collection goes in canonical order: a Set or Dict an East program
    // built is sorted already, and a plain one is sorted first.
    const key = (type.type === 'Dict' ? (type.value as { key: EastTypeValue }).key : type.value) as EastTypeValue;
    const cmp = compareFor(key) as (a: unknown, b: unknown) => number;
    const elements: Iterable<unknown> = type.type === 'Array' ? value as unknown[]
        : type.type === 'Set' ? (value instanceof SortedSet ? value : [...(value as Set<unknown>)].sort(cmp))
        : value instanceof SortedMap ? value.entries() : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp(a[0], b[0]));
    const writer = new Beast2ManifestWriter(type, manifestDirectory(path), { parallel: true });
    for (const element of elements) writer.add(element);
    writer.finish();
}

/**
 * The sink a manifest directory is written through: the manifest at `path`,
 * written last, and every object it names in `<path>.segments/` under its
 * SHA-256 — the layout a store takes in by linking, and every runner's opener
 * reads.
 *
 * @param path - the manifest's file
 * @returns the sink
 */
function manifestDirectory(path: string): Beast2ManifestSink {
    const segments = segmentDirFor(path);
    let made = false;
    return {
        object: (hash, bytes) => {
            if (!made) {
                mkdirSync(segments, { recursive: true });
                made = true;
            }
            writeFileSync(join(segments, `${hash}.beast2`), bytes);
        },
        manifest: (bytes) => writeFileSync(path, bytes),
    };
}

/**
 * Creates an output directory of runs, which must hold nothing yet: every
 * manifest in it is one of the unit's runs.
 *
 * @param dir - the directory
 * @returns the directory
 * @throws {Error} When it holds anything already.
 */
function outputDirectory(dir: string): string {
    mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length > 0) throw new Error(`exec: the output directory ${dir} is not empty`);
    return dir;
}
