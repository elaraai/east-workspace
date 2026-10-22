/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// A long-lived model's cost on each runner (east-workspace#1357, R24): a
// W2-shaped model of about seven million parameters — two stacks of four
// transformer blocks at width 256 with 8 heads, embeddings and heads — run
// through nn_run 564 times over 120 steps of a loop, the weights a program
// input read once. What the runner adds around the forward pass is read from
// three programs, each run through the runner from the same input files:
//
//   calls-0    the program with no nn_run (the inputs decoded, the loop run)
//   calls-1    one nn_run
//   calls-564  the 564
//
// so the preparation (the first call's plan and weight conversion) is
// calls-1 − calls-0 − one forward pass, and each later call's cost beyond the
// forward pass is (calls-564 − calls-1)/563 − one forward pass; the forward
// pass itself is timed by the python interpreter on the same network, weights
// and batch (`--forward` prints it; the harness runs it through uv).
//
//   node bench/model.mjs <outdir> [--runner east-c|east-py|both] [--params 7000000] [--calls 564] [--steps 120]
//
// Needs a built package, the east-c build tree or `east-c` on PATH, and `uv`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { East, FloatType, IntegerType, encodeBeast2For, encodeEastIR, none, some, variant } from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const ds = await import(join(here, '..', 'dist', 'src', 'index.js'));
const { NeuralNet, NetType, NnBatchType, NnWeightsType, NnRunConfigType } = ds;

const argv = process.argv.slice(2);
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'bench-model';
const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
};
const runners = opt('--runner', 'both');
const CALLS = Number(opt('--calls', 564));
const STEPS = Number(opt('--steps', 120));
const D = 256, HEADS = 8, LAYERS = 4, VOCAB = 2000, CLASSES = 50, BATCH = 48;
mkdirSync(out, { recursive: true });

// ── The network: embeddings, two stacks of blocks, heads ────────────────
const F = (rank) => ({ dtype: variant('float', null), rank: BigInt(rank) });
const I = (rank) => ({ dtype: variant('integer', null), rank: BigInt(rank) });
const param = (shape, init = variant('xavier_uniform', null), decay = 1.0) => ({ shape: shape.map(BigInt), init, trainable: true, decay });
const node = (name, op) => ({ name, op });
function block(causal) {
    const params = new Map([
        ['ln1_w', param([D], variant('ones', null), 0)], ['ln1_b', param([D], variant('zeros', null), 0)],
        ['wq', param([D, D])], ['wk', param([D, D])], ['wv', param([D, D])], ['wo', param([D, D])],
        ['ln2_w', param([D], variant('ones', null), 0)], ['ln2_b', param([D], variant('zeros', null), 0)],
        ['w1', param([4 * D, D])], ['b1', param([4 * D], variant('zeros', null), 0)],
        ['w2', param([D, 4 * D])], ['b2', param([D], variant('zeros', null), 0)],
    ]);
    return {
        inputs: new Map([['x', F(2)], ['ids', I(1)], ['pos', I(1)]]),
        params, modules: new Map(),
        nodes: [
            node('h', variant('layer_norm', { x: 'x', weight: some('ln1_w'), bias: some('ln1_b'), eps: 1e-5 })),
            node('q', variant('linear', { x: 'h', weight: 'wq', bias: none })),
            node('k', variant('linear', { x: 'h', weight: 'wk', bias: none })),
            node('v', variant('linear', { x: 'h', weight: 'wv', bias: none })),
            node('qr', variant('rotary', { x: 'q', positions: 'pos', heads: BigInt(HEADS), base: 10000.0, convention: variant('halves', null) })),
            node('kr', variant('rotary', { x: 'k', positions: 'pos', heads: BigInt(HEADS), base: 10000.0, convention: variant('halves', null) })),
            node('att', variant('attention', { q: 'qr', k: 'kr', v: 'v', heads: BigInt(HEADS), mask: variant('segments', { ids: 'ids', causal }), bias: none, scale: none })),
            node('o', variant('linear', { x: 'att', weight: 'wo', bias: none })),
            node('x1', variant('add', { a: 'x', b: 'o' })),
            node('h2', variant('layer_norm', { x: 'x1', weight: some('ln2_w'), bias: some('ln2_b'), eps: 1e-5 })),
            node('f1', variant('linear', { x: 'h2', weight: 'w1', bias: some('b1') })),
            node('g', variant('gelu', { x: 'f1', approximate: variant('tanh', null) })),
            node('f2', variant('linear', { x: 'g', weight: 'w2', bias: some('b2') })),
            node('y', variant('add', { a: 'x1', b: 'f2' })),
        ],
        outputs: new Map([['y', 'y']]),
    };
}
const nodes = [node('emb', variant('gather', { table: 'tok_table', index: 'tokens' }))];
let last = 'emb';
for (let l = 0; l < LAYERS; l++) {
    nodes.push(node(`e${l}`, variant('call', { module: 'eblock', prefix: `events${l}`, inputs: new Map([['x', last], ['ids', 'segments'], ['pos', 'positions']]) })));
    last = `e${l}.y`;
}
for (let l = 0; l < LAYERS; l++) {
    nodes.push(node(`s${l}`, variant('call', { module: 'sblock', prefix: `segments${l}`, inputs: new Map([['x', last], ['ids', 'sequence'], ['pos', 'positions']]) })));
    last = `s${l}.y`;
}
nodes.push(node('logits', variant('linear', { x: last, weight: 'cls_w', bias: some('cls_b') })));
nodes.push(node('probs', variant('softmax', { x: 'logits', axis: -1n })));
nodes.push(node('next', variant('argmax', { x: 'logits', axis: -1n })));
const net = {
    inputs: new Map([['tokens', I(1)], ['segments', I(1)], ['sequence', I(1)], ['positions', I(1)]]),
    params: new Map([
        ['tok_table', param([VOCAB, D], variant('normal', 0.02), 0)],
        ['cls_w', param([CLASSES, D])], ['cls_b', param([CLASSES], variant('zeros', null), 0)],
    ]),
    modules: new Map([['eblock', block(true)], ['sblock', block(false)]]),
    nodes,
    outputs: new Map([['probs', 'probs'], ['next', 'next']]),
};
const nParams = VOCAB * D + CLASSES * D + CLASSES + 2 * LAYERS * (4 * D * D + 2 * D + 2 * D + 4 * D * D + 4 * D + 4 * D * D / 4 * 0 + D * 4 * D + D);

// ── The programs ─────────────────────────────────────────────────────────
// weights: nn_init at seed 1, written as an input file so every program reads them frozen
const initProgram = East.function([], NnWeightsType, ($) => NeuralNet.init($.let(net, NetType), 1n));
const batch = new Map([
    ['tokens', variant('integer', { shape: [BigInt(BATCH)], data: new BigInt64Array(Array.from({ length: BATCH }, (_, i) => BigInt((i * 7919) % VOCAB))) })],
    ['segments', variant('integer', { shape: [BigInt(BATCH)], data: new BigInt64Array(Array.from({ length: BATCH }, (_, i) => BigInt(Math.floor(i / 6)))) })],
    ['sequence', variant('integer', { shape: [BigInt(BATCH)], data: new BigInt64Array(Array.from({ length: BATCH }, () => 0n)) })],
    ['positions', variant('integer', { shape: [BigInt(BATCH)], data: new BigInt64Array(Array.from({ length: BATCH }, (_, i) => BigInt(i % 6))) })],
]);
function program(calls) {
    // `calls` nn_run calls spread over STEPS steps of a loop; the inputs: the net, the weights, the batch
    return East.function([NetType, NnWeightsType, NnBatchType], FloatType, ($, n, w, b) => {
        const c = $.let({ device: variant('cpu', null), seed: 0n, training: false }, NnRunConfigType);
        const total = $.let(0.0);
        const perStep = Math.floor(calls / STEPS), extra = calls - perStep * STEPS;
        $.for(East.Array.range(0n, BigInt(STEPS)), ($, step) => {
            const count = $.let(step.less(BigInt(extra)).ifElse(() => East.value(BigInt(perStep + 1)), () => East.value(BigInt(perStep))));
            $.for(East.Array.range(0n, count), ($) => {
                const r = $.let(NeuralNet.run(n, w, b, ['probs'], c));
                $.assign(total, total.add(r.get('probs').unwrap('float').data.get(0n)));
            });
        });
        return total;
    });
}
const irFile = (name, fn) => {
    const file = join(out, `${name}.ir.beast2`);
    writeFileSync(file, encodeEastIR(fn.toIR()));
    return file;
};
const files = {
    init: irFile('init', initProgram),
    'calls-0': irFile('calls-0', program(0)),
    'calls-1': irFile('calls-1', program(1)),
    [`calls-${CALLS}`]: irFile(`calls-${CALLS}`, program(CALLS)),
};
writeFileSync(join(out, 'net.beast2'), encodeBeast2For(NetType)(net));
writeFileSync(join(out, 'batch.beast2'), encodeBeast2For(NnBatchType)(batch));

// ── The runners ──────────────────────────────────────────────────────────
const workspace = resolve(here, '..', '..', '..', '..', '..');
const eastC = existsSync(join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c')) ? join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c') : 'east-c';
function run(runner, ir, inputs, outFile, format = 'json') {
    const args = ['run', ir, ...inputs.flatMap((f) => ['-i', f]), '-o', outFile];
    const t0 = process.hrtime.bigint();
    const r = runner === 'east-c'
        ? spawnSync(eastC, [...args, '-p', 'std', '-p', 'datascience'], { encoding: 'utf8', env: { ...process.env, EAST_C_PACKAGE_PATH: process.env.EAST_C_PACKAGE_PATH ?? '' } })
        : spawnSync('uv', ['run', 'east-py', ...args, '-p', 'east_py_std', '-p', 'east_py_datascience'], { encoding: 'utf8', cwd: join(workspace, 'libs/east-py') });
    const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
    if (r.error || r.status !== 0) {
        console.error(`${runner} ${ir}: ${r.error ? r.error.message : `exit ${r.status}`}\n${r.stderr ?? ''}`);
        return null;
    }
    void format;
    return seconds;
}

// the weights, once, from east-c (or east-py when east-c is not asked): beast2 through the runner's -o
const weightsFile = join(out, 'weights.beast2');
{
    const runner = runners === 'east-py' ? 'east-py' : 'east-c';
    const r = run(runner, files.init, [], weightsFile);
    if (r === null) process.exit(1);
}
const forwardScript = join(here, 'model_forward.py');
console.log(`parameters ≈ ${nParams.toLocaleString()}; ${CALLS} calls over ${STEPS} steps; batch ${BATCH} events`);
console.log('runner        program        seconds   (preparation / per call beyond the forward pass)');
for (const runner of runners === 'both' ? ['east-c', 'east-py'] : [runners]) {
    const t = {};
    for (const name of ['calls-0', 'calls-1', `calls-${CALLS}`]) {
        const best = Math.min(...[0, 1, 2].map(() => run(runner, files[name], [join(out, 'net.beast2'), weightsFile, join(out, 'batch.beast2')], join(out, `${name}.${runner}.json`)) ?? Infinity));
        t[name] = best;
        console.log(`${runner.padEnd(13)} ${name.padEnd(14)} ${best.toFixed(3).padStart(7)}`);
    }
    // the forward pass alone: the python interpreter over the same network, weights and batch
    const fwd = execFileSync('uv', ['run', '--package', 'elaraai-east-py-datascience', 'python', forwardScript, join(out, 'net.beast2'), weightsFile, join(out, 'batch.beast2')], { encoding: 'utf8', cwd: join(workspace, 'libs/east-py') }).trim();
    const forward = Number(fwd);
    const preparation = t['calls-1'] - t['calls-0'] - forward;
    const perCall = (t[`calls-${CALLS}`] - t['calls-1']) / (CALLS - 1) - forward;
    console.log(`${runner.padEnd(13)} forward pass   ${forward.toFixed(4).padStart(7)}   preparation ${preparation.toFixed(3)} s (bound 1 s), per call ${(perCall * 1000).toFixed(2)} ms beyond the forward pass (bound 5 ms)`);
}
