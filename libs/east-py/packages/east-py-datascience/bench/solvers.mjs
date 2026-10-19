/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The solver families' overhead on each runner: a W1-shaped LP, in columns and
// named, and W1-shaped CP-SAT assignment models, solved through the platform
// functions, with the three times every result carries — build_time (the
// call's entry to the solver's start), solve_time (inside the solver) and
// wall_time (the whole call) — so what the runner adds around the solver is
// read off the result, on both runners alike.
//
//   node bench/solvers.mjs <outdir> [--runner east-c|east-py|both] [--lp-vars 33526] [--lp-terms 840000]
//
// Writes the programs' IR and inputs under <outdir>, runs each case through
// the runner's `run` (east-c: the build tree's binary, or `east-c` on PATH;
// east-py: `uv run east-py` from libs/east-py), and prints one line per case:
// the runner, the case, build_time, solve_time, the rest of wall_time (the
// write-back) and wall_time, in seconds.
//
// The models are generated here (a Park–Miller stream), W1-shaped: continuous
// variables with supply, demand, period and resource rows, four terms a
// variable, demand rows bounded below only and the others above only; and
// assignment models of boolean decisions over slots with capacities and a
// minimised cost. The sizes are the requirements' (R6, R7): the LP at
// 33,526 variables, an LP of 840,000 terms, and CP-SAT at 50, 300 and 600
// decisions.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { East, encodeBeast2For, encodeEastIR, none, some, variant } from '@elaraai/east';

const here = dirname(fileURLToPath(import.meta.url));
const ds = await import(join(here, '..', 'dist', 'src', 'index.js'));
const { GoogleOr, LinearModelType, LinearConfigType, LinearModelColumnsType, LinearColumnsConfigType, CpSatModelType, CpSatConfigType } = ds;

const argv = process.argv.slice(2);
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'bench-solvers';
const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
};
const runners = opt('--runner', 'both');
const LP_VARS = Number(opt('--lp-vars', 33526));
const LP_TERMS = Number(opt('--lp-terms', 840000));
mkdirSync(out, { recursive: true });

// ── The stream ──────────────────────────────────────────────────────────
function stream(seed) {
    let x = seed;
    const next = () => (x = (x * 48271) % 2147483647);
    return {
        float: () => next() / 2147483647,
        int: (lo, hi) => lo + (next() % (hi - lo + 1)),
    };
}

// ── A W1-shaped LP in columns: n variables, four rows each ──────────────
function lpColumns(n, seed) {
    const r = stream(seed);
    const S = Math.ceil(n / 8), D = Math.ceil(n / 6), P = Math.ceil(n / 50), R = Math.ceil(n / 120);
    const rows = S + D + P + R;
    const var_lower = new Float64Array(n), var_upper = new Float64Array(n), objective = new Float64Array(n);
    const row_lower = new Float64Array(rows), row_upper = new Float64Array(rows);
    for (let s = 0; s < S; s++) { row_lower[s] = -Infinity; row_upper[s] = r.int(20, 40); }
    for (let d = 0; d < D; d++) { row_lower[S + d] = r.int(1, 3); row_upper[S + d] = Infinity; }
    for (let p = 0; p < P; p++) { row_lower[S + D + p] = -Infinity; row_upper[S + D + p] = r.int(100, 200); }
    for (let q = 0; q < R; q++) { row_lower[S + D + P + q] = -Infinity; row_upper[S + D + P + q] = r.int(200, 400); }
    // the terms by row: each variable in its four rows
    const counts = new Int32Array(rows);
    const rowOf = new Int32Array(4 * n);
    for (let k = 0; k < n; k++) {
        var_lower[k] = 0;
        var_upper[k] = k % 3 === 0 ? Infinity : r.int(1, 5);
        objective[k] = r.int(1, 10);
        const rs = [k % S, S + ((k * 7919) % D), S + D + (k % P), S + D + P + ((k * 31) % R)];
        for (let j = 0; j < 4; j++) { rowOf[4 * k + j] = rs[j]; counts[rs[j]]++; }
    }
    const row_ptr = new BigInt64Array(rows + 1);
    let acc = 0;
    for (let i = 0; i < rows; i++) { row_ptr[i] = BigInt(acc); acc += counts[i]; }
    row_ptr[rows] = BigInt(acc);
    const fill = new Int32Array(rows);
    const col_ix = new BigInt64Array(acc), coeff = new Float64Array(acc);
    for (let k = 0; k < n; k++) {
        for (let j = 0; j < 4; j++) {
            const row = rowOf[4 * k + j];
            const at = Number(row_ptr[row]) + fill[row]++;
            col_ix[at] = BigInt(k);
            coeff[at] = 1.0;
        }
    }
    return { var_lower, var_upper, var_integer: new Uint8ClampedArray(n), row_lower, row_upper, row_ptr, col_ix, coeff, objective, maximize: false };
}

// The same LP named.
function lpNamed(cols) {
    const n = cols.var_lower.length, rows = cols.row_lower.length;
    const variables = [];
    for (let k = 0; k < n; k++) variables.push({ name: `x${k}`, lower_bound: cols.var_lower[k], upper_bound: cols.var_upper[k], is_integer: false });
    const constraints = [];
    for (let i = 0; i < rows; i++) {
        const terms = [];
        for (let t = Number(cols.row_ptr[i]); t < Number(cols.row_ptr[i + 1]); t++) terms.push({ var: `x${cols.col_ix[t]}`, coeff: cols.coeff[t] });
        constraints.push({ terms, lower_bound: cols.row_lower[i], upper_bound: cols.row_upper[i] });
    }
    const objTerms = [];
    for (let k = 0; k < n; k++) objTerms.push({ var: `x${k}`, coeff: cols.objective[k] });
    return { variables, constraints, objective: { terms: objTerms, maximize: false } };
}

// ── A W1-shaped CP-SAT assignment: n decisions over 5 slots ─────────────
function cpsatModel(n, seed) {
    const r = stream(seed);
    const M = 5;
    const bool_vars = [], int_vars = [], constraints = [], objTerms = [];
    for (let m = 0; m < M; m++) int_vars.push({ name: `load${m}`, lower_bound: 0n, upper_bound: 1000000n });
    const weights = [];
    for (let i = 0; i < n; i++) {
        weights.push(r.int(1, 9));
        const terms = [];
        for (let m = 0; m < M; m++) {
            bool_vars.push({ name: `x${i}_${m}` });
            terms.push({ var: `x${i}_${m}`, coeff: 1n });
            objTerms.push({ var: `x${i}_${m}`, coeff: BigInt(r.int(1, 200000)) });
        }
        constraints.push(variant('linear', { expr: { terms, constant: 0n }, op: variant('equal', null), rhs: 1n }));
    }
    const cap = BigInt(Math.ceil((n * 5 * 1.3) / M));
    for (let m = 0; m < M; m++) {
        const terms = [];
        for (let i = 0; i < n; i++) terms.push({ var: `x${i}_${m}`, coeff: BigInt(weights[i]) });
        terms.push({ var: `load${m}`, coeff: -1n });
        constraints.push(variant('linear', { expr: { terms, constant: 0n }, op: variant('equal', null), rhs: 0n }));
        constraints.push(variant('linear', { expr: { terms: [{ var: `load${m}`, coeff: 1n }], constant: 0n }, op: variant('less_equal', null), rhs: cap }));
        objTerms.push({ var: `load${m}`, coeff: 2n });
    }
    return { int_vars, bool_vars, interval_vars: [], constraints, objective: some(variant('minimize', { terms: objTerms, constant: 7n })) };
}

// ── The programs: one platform call each ─────────────────────────────────
const programs = {
    lpColumns: East.function([LinearModelColumnsType, LinearColumnsConfigType], ds.LinearColumnsResultType, ($, m, c) => GoogleOr.linearSolveColumns(m, c)),
    lpNamed: East.function([LinearModelType, LinearConfigType], ds.LinearResultType, ($, m, c) => GoogleOr.linearSolve(m, c)),
    cpsat: East.function([CpSatModelType, CpSatConfigType], ds.CpSatResultType, ($, m, c) => GoogleOr.cpsatSolve(m, c)),
};
for (const [name, fn] of Object.entries(programs)) writeFileSync(join(out, `${name}.ir.beast2`), encodeEastIR(fn.toIR()));

const highs = { solver: some(variant('highs', null)), max_time_seconds: none, relative_gap_limit: none, hints: none };
const cpConfig = (workers) => ({ max_time_seconds: some(60.0), num_workers: some(BigInt(workers)), log_search_progress: none, seed: some(1n), max_solutions: none, relative_gap_limit: none, absolute_gap_limit: none, hints: none });

const cases = [];
function addCase(name, program, types, values) {
    const inputs = values.map((v, i) => {
        const file = join(out, `${name}.in${i}.beast2`);
        writeFileSync(file, encodeBeast2For(types[i])(v));
        return file;
    });
    cases.push({ name, program, inputs });
}
const lpA = lpColumns(LP_VARS, 7);
addCase(`lp-columns-${LP_VARS}`, 'lpColumns', [LinearModelColumnsType, LinearColumnsConfigType], [lpA, highs]);
addCase(`lp-named-${LP_VARS}`, 'lpNamed', [LinearModelType, LinearConfigType], [lpNamed(lpA), highs]);
const lpB = lpColumns(Math.ceil(LP_TERMS / 4), 11);
addCase(`lp-columns-${lpB.col_ix.length}-terms`, 'lpColumns', [LinearModelColumnsType, LinearColumnsConfigType], [lpB, highs]);
addCase(`lp-named-${lpB.col_ix.length}-terms`, 'lpNamed', [LinearModelType, LinearConfigType], [lpNamed(lpB), highs]);
for (const n of [50, 300, 600]) addCase(`cpsat-${n}`, 'cpsat', [CpSatModelType, CpSatConfigType], [cpsatModel(n, 3), cpConfig(8)]);

// ── The runners ──────────────────────────────────────────────────────────
const workspace = resolve(here, '..', '..', '..', '..', '..');
const eastC = existsSync(join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c')) ? join(workspace, 'libs/east-c/build/packages/east-c-cli/east-c') : 'east-c';
function run(runner, c) {
    const outFile = join(out, `${c.name}.${runner}.json`);
    const ir = join(out, `${c.program}.ir.beast2`);
    const inputs = c.inputs.flatMap((f) => ['-i', f]);
    let r;
    if (runner === 'east-c') {
        r = spawnSync(eastC, ['run', ir, ...inputs, '-o', outFile, '-p', 'std', '-p', 'datascience'], { encoding: 'utf8', env: { ...process.env, EAST_C_PACKAGE_PATH: process.env.EAST_C_PACKAGE_PATH ?? '' } });
    } else {
        r = spawnSync('uv', ['run', 'east-py', 'run', ir, ...inputs, '-o', outFile, '-p', 'east_py_std', '-p', 'east_py_datascience'], { encoding: 'utf8', cwd: join(workspace, 'libs/east-py') });
    }
    if (r.error || r.status !== 0) {
        console.error(`${runner} ${c.name}: ${r.error ? r.error.message : `exit ${r.status}`}\n${r.stderr ?? ''}`);
        return null;
    }
    return JSON.parse(readFileSync(outFile, 'utf8'));
}

console.log('runner        case                          status      build_s   solve_s  writeback_s   wall_s');
for (const runner of runners === 'both' ? ['east-c', 'east-py'] : [runners]) {
    for (const c of cases) {
        const result = run(runner, c);
        if (!result) continue;
        const status = typeof result.status === 'object' && result.status !== null ? (result.status.type ?? JSON.stringify(result.status)) : String(result.status);
        const b = result.build_time, s = result.solve_time, w = result.wall_time;
        console.log(`${runner.padEnd(13)} ${c.name.padEnd(29)} ${String(status).padEnd(10)} ${b.toFixed(4).padStart(9)} ${s.toFixed(4).padStart(9)} ${(w - b - s).toFixed(4).padStart(12)} ${w.toFixed(4).padStart(8)}`);
    }
}
