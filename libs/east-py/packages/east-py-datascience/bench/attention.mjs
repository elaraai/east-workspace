/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The memory a masked attention takes on each runner (east-workspace#1357,
// R17): a W2-shaped call — T tokens of width d over `heads` heads, grouped
// into `segments` segments with one `long` one — through nn_run with the
// `segments` mask, with the `key_sets` mask listing the same pairs, and
// through the dense path (the same mask beside a zero bias, which forces it)
// at a size the dense path fits in memory. Each case is a program of its own,
// and what a case takes is its process's peak resident set less its
// baseline's — the same program, the same inputs (the key sets included),
// with the attention replaced by an addition of its inputs — so the inputs,
// the runner and libtorch itself are not counted.
//
//   node bench/attention.mjs <outdir> [--runner east-c|east-py|both] [--t 12288] [--heads 8] [--d 256]
//                            [--segments 600] [--long 1500] [--dense-t 4096]
//
// Needs /usr/bin/time (GNU), a built package, the east-c build tree or
// `east-c` on PATH, and `uv` for east-py. Prints one line per case: the
// runner, the case, its peak RSS, the extra over the baseline, and the
// elapsed seconds; and the dense path's working set by arithmetic
// (T² × heads × 4 bytes, for the scores alone) at each size.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { East, FloatType, IntegerType, ArrayType, encodeEastIR, none, some, variant } from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const ds = await import(join(here, '..', 'dist', 'src', 'index.js'));
const { NeuralNet, NetType, NnBatchType, NnWeightsType, NnRunConfigType } = ds;

const argv = process.argv.slice(2);
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'bench-attention';
const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
};
const runners = opt('--runner', 'both');
const T = Number(opt('--t', 12288));
const HEADS = Number(opt('--heads', 8));
const D = Number(opt('--d', 256));
const SEGMENTS = Number(opt('--segments', 600));
const LONG = Number(opt('--long', 1500));
const DENSE_T = Number(opt('--dense-t', 4096));
mkdirSync(out, { recursive: true });

// ── The segments: one of `long`, the rest sharing what is left ───────────
function segmentLengths(t, segments, long) {
    const rest = t - long;
    const base = Math.floor(rest / (segments - 1));
    const lengths = Array.from({ length: segments - 1 }, (_, i) => base + (i < rest - base * (segments - 1) ? 1 : 0));
    lengths.splice(Math.floor(segments / 2), 0, long);
    return lengths;
}

// ── A program: the attention (or its baseline) over seeded uniform tensors ─
// q, k and v are drawn by the network itself (random_uniform over a zero
// tensor built by Vector.fill), so the program's inputs are small and both
// runners see the same draws; the ids, and the key sets listing the same
// pairs, are built in East from the segment lengths.
function program(kind, t, heads, d, lengths) {
    const F = (rank) => ({ dtype: variant('float', null), rank: BigInt(rank) });
    const I = (rank) => ({ dtype: variant('integer', null), rank: BigInt(rank) });
    const inputs = new Map([['z', F(2)], ['ids', I(1)]]);
    if (kind === 'key_sets' || kind === 'baseline-key_sets') {
        inputs.set('ptr', I(1));
        inputs.set('keys', I(1));
    }
    if (kind === 'dense') inputs.set('bias', F(3));
    const attention = (mask, bias) => variant('attention', { q: 'q', k: 'k', v: 'v', heads: BigInt(heads), mask, bias, scale: none });
    const y = kind.startsWith('baseline') ? variant('add', { a: 'q', b: 'k' })
        : kind === 'segments' ? attention(variant('segments', { ids: 'ids', causal: false }), none)
        : kind === 'dense' ? attention(variant('segments', { ids: 'ids', causal: false }), some('bias'))
        : attention(variant('key_sets', { ptr: 'ptr', keys: 'keys' }), none);
    const net = {
        inputs,
        params: new Map(),
        modules: new Map(),
        nodes: [
            { name: 'q', op: variant('random_uniform', { like: 'z', keys: none }) },
            { name: 'k', op: variant('random_uniform', { like: 'z', keys: none }) },
            { name: 'v', op: variant('random_uniform', { like: 'z', keys: none }) },
            { name: 'y', op: y },
            { name: 'flat', op: variant('reshape', { x: 'y', shape: [-1n] }) },
            { name: 's', op: variant('sum', { x: 'flat', axis: 0n }) },
        ],
        outputs: new Map([['s', 's']]),
    };
    return East.function([], FloatType, ($) => {
        const ids = $.let(East.value([], ArrayType(IntegerType)));
        lengths.forEach((n, s) => $.for(East.Array.range(0n, BigInt(n)), ($) => { $(ids.pushLast(BigInt(s))); }));
        const batch = $.let(East.value(new Map(), NnBatchType));
        $(batch.insert('z', variant('float', { shape: [BigInt(t), BigInt(d)], data: East.Vector.fill(BigInt(t * d), 0.0) })));
        $(batch.insert('ids', variant('integer', { shape: [BigInt(t)], data: East.Vector.fromArray(ids) })));
        if (kind === 'key_sets' || kind === 'baseline-key_sets') {
            // every query of a segment lists every key of its segment
            const ptr = $.let(East.value([0n], ArrayType(IntegerType)));
            const keys = $.let(East.value([], ArrayType(IntegerType)));
            let start = 0;
            for (const n of lengths) {
                const lo = BigInt(start), hi = BigInt(start + n);
                $.for(East.Array.range(lo, hi), ($) => {
                    $.for(East.Array.range(lo, hi), ($, j) => { $(keys.pushLast(j)); });
                    $(ptr.pushLast(keys.length()));
                });
                start += n;
            }
            $(batch.insert('ptr', variant('integer', { shape: [BigInt(t + 1)], data: East.Vector.fromArray(ptr) })));
            $(batch.insert('keys', variant('integer', { shape: [keys.length()], data: East.Vector.fromArray(keys) })));
        }
        if (kind === 'dense') $(batch.insert('bias', variant('float', { shape: [1n, 1n, 1n], data: East.Vector.fill(1n, 0.0) })));
        const n = $.let(net, NetType);
        const w = $.let(new Map(), NnWeightsType);
        const c = $.let({ device: variant('cpu', null), seed: 1n, training: false }, NnRunConfigType);
        const r = $.let(NeuralNet.run(n, w, batch, ['s'], c));
        return r.get('s').unwrap('float').data.get(0n);
    });
}

const cases = [];
function addCase(name, kind, t) {
    const lengths = t === T ? segmentLengths(t, SEGMENTS, LONG) : segmentLengths(t, Math.max(2, Math.round(SEGMENTS * t / T)), Math.min(LONG, Math.floor(t / 2)));
    const ir = join(out, `${name}.ir.beast2`);
    writeFileSync(ir, encodeEastIR(program(kind, t, HEADS, D, lengths).toIR()));
    const pairs = lengths.reduce((a, n) => a + n * n, 0);
    cases.push({ name, kind, t, ir, pairs, lengths });
}
addCase(`baseline-${T}`, 'baseline', T);
addCase(`segments-${T}`, 'segments', T);
addCase(`baseline-keys-${T}`, 'baseline-key_sets', T);
addCase(`key_sets-${T}`, 'key_sets', T);
if (DENSE_T > 0) {
    addCase(`baseline-${DENSE_T}`, 'baseline', DENSE_T);
    addCase(`segments-${DENSE_T}`, 'segments', DENSE_T);
    addCase(`dense-${DENSE_T}`, 'dense', DENSE_T);
}

// ── The runners, under GNU time ──────────────────────────────────────────
const workspace = resolve(here, '..', '..', '..', '..', '..');
const eastC = existsSync(join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c')) ? join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c') : 'east-c';
function run(runner, c) {
    const outFile = join(out, `${c.name}.${runner}.json`);
    const timeFile = join(out, `${c.name}.${runner}.time`);
    const cmd = runner === 'east-c'
        ? [eastC, 'run', c.ir, '-o', outFile, '-p', 'std', '-p', 'datascience']
        : ['uv', 'run', 'east-py', 'run', c.ir, '-o', outFile, '-p', 'east_py_std', '-p', 'east_py_datascience'];
    const r = spawnSync('/usr/bin/time', ['-f', '%M %e', '-o', timeFile, ...cmd], {
        encoding: 'utf8',
        cwd: runner === 'east-c' ? process.cwd() : join(workspace, 'libs/east-py'),
        env: { ...process.env, EAST_C_PACKAGE_PATH: process.env.EAST_C_PACKAGE_PATH ?? '' },
    });
    if (r.error || r.status !== 0) {
        console.error(`${runner} ${c.name}: ${r.error ? r.error.message : `exit ${r.status}`}\n${r.stderr ?? ''}`);
        return null;
    }
    const [rssKb, seconds] = readFileSync(timeFile, 'utf8').trim().split(/\s+/).map(Number);
    return { rssMb: rssKb / 1024, seconds, sum: JSON.parse(readFileSync(outFile, 'utf8')) };
}

const mb = (x) => `${x.toFixed(0)} MB`;
console.log(`T = ${T}, heads = ${HEADS}, d = ${D}, ${SEGMENTS} segments with one of ${LONG}; pairs ${cases[1].pairs.toLocaleString()}`);
console.log(`dense scores at T = ${T}: ${mb(T * T * HEADS * 4 / 2 ** 20)} (${mb(T * T * HEADS * 4 * 2 / 2 ** 20)} with the softmax); at T = ${DENSE_T}: ${mb(DENSE_T * DENSE_T * HEADS * 4 / 2 ** 20)}`);
console.log('runner        case                 peak RSS     extra      elapsed_s');
for (const runner of runners === 'both' ? ['east-c', 'east-py'] : [runners]) {
    const baselines = {};
    for (const c of cases) {
        const result = run(runner, c);
        if (!result) continue;
        if (c.kind.startsWith('baseline')) baselines[`${c.kind}-${c.t}`] = result.rssMb;
        const baseline = baselines[`${c.kind === 'key_sets' ? 'baseline-key_sets' : 'baseline'}-${c.t}`] ?? 0;
        const extra = c.kind.startsWith('baseline') ? '—' : mb(result.rssMb - baseline);
        console.log(`${runner.padEnd(13)} ${c.name.padEnd(20)} ${mb(result.rssMb).padStart(9)} ${extra.padStart(9)} ${result.seconds.toFixed(2).padStart(12)}`);
    }
}
