/**
 * Beast2 benchmark for east-c-wasm.
 *
 * Tests two paths:
 *   1. IR compile + execute (compileFromBeast2 + call)
 *   2. Data value decode (decodeValue)
 *
 * Usage:
 *   npx tsx scripts/profile_beast2_ir.ts /tmp/ui_fn.beast2 [iterations]        # IR mode
 *   npx tsx scripts/profile_beast2_ir.ts --value /tmp/ui.beast2 [iterations]   # Value decode mode
 *   npx tsx scripts/profile_beast2_ir.ts --both /tmp/ui_fn.beast2 /tmp/ui.beast2 [iterations]
 *
 * Generate test files:
 *   cd libs/east && npx tsx contrib/examples/beast2_v2_benchmark.ts
 */
import { readFileSync } from 'node:fs';
import { createEastWasm } from '../dist/src/index.js';

const args = process.argv.slice(2);

let mode: 'ir' | 'value' | 'both' = 'ir';
let files: string[] = [];
let iters = 5;

// Parse args
let i = 0;
while (i < args.length) {
    if (args[i] === '--value') { mode = 'value'; i++; }
    else if (args[i] === '--both') { mode = 'both'; i++; }
    else if (args[i]!.startsWith('-')) { i++; }
    else if (args[i]!.match(/^\d+$/)) { iters = parseInt(args[i]!, 10); i++; }
    else { files.push(args[i]!); i++; }
}

if (files.length === 0) {
    console.error('Usage: npx tsx scripts/profile_beast2_ir.ts [--value|--both] <file.beast2> [file2.beast2] [iterations]');
    process.exit(1);
}

const east = await createEastWasm();

// --- IR compile + execute ---
async function benchmarkIR(filePath: string) {
    const data = readFileSync(filePath);
    console.log(`\n=== IR: ${filePath} (${(data.length / 1048576).toFixed(2)} MB) ===\n`);

    // Warmup
    const warmup = east.compileFromBeast2(data);
    const result = warmup();
    console.log(`Result preview: ${JSON.stringify(result, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2)?.slice(0, 500)}...\n`);

    // Compile benchmark
    const compileStart = performance.now();
    let compiled;
    for (let i = 0; i < iters; i++) {
        compiled = east.compileFromBeast2(data);
    }
    const compileMs = (performance.now() - compileStart) / iters;
    console.log(`  compile: ${compileMs.toFixed(1)} ms/call (${iters}x)`);

    // Execute benchmark
    try {
        const execStart = performance.now();
        for (let i = 0; i < iters; i++) {
            compiled!();
        }
        const execMs = (performance.now() - execStart) / iters;
        console.log(`  execute: ${execMs.toFixed(1)} ms/call (${iters}x)`);
        console.log(`  total:   ${(compileMs + execMs).toFixed(1)} ms`);
    } catch {
        console.log(`  execute: skipped (result marshalling error)`);
    }
}

// --- Data value decode ---
async function benchmarkValue(filePath: string) {
    const data = readFileSync(filePath);
    console.log(`\n=== Value decode: ${filePath} (${(data.length / 1048576).toFixed(2)} MB) ===\n`);

    // Warmup
    const warmup = east.decodeValue(new Uint8Array(data));
    console.log(`Result preview: ${JSON.stringify(warmup, (_k, v) => typeof v === 'bigint' ? Number(v) : v, 2)?.slice(0, 500)}...\n`);

    // Benchmark
    const start = performance.now();
    for (let i = 0; i < iters; i++) {
        east.decodeValue(new Uint8Array(data));
    }
    const ms = (performance.now() - start) / iters;
    console.log(`  decode:  ${ms.toFixed(1)} ms/call (${iters}x)`);
}

// Run
if (mode === 'ir' || mode === 'both') {
    await benchmarkIR(files[0]!);
}
if (mode === 'value' || mode === 'both') {
    const valueFile = mode === 'both' ? (files[1] ?? files[0]!) : files[0]!;
    await benchmarkValue(valueFile);
}
