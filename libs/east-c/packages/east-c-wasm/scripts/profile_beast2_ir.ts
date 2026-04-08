/**
 * Beast2 benchmark for east-c-wasm.
 *
 * Methodology matches profile_beast2_decode.c:
 *   --ir:    decode IR + compile + execute (call closure if returned)
 *   --value: decode beast2 data value
 *   --both:  run both with separate files
 *
 * Usage:
 *   npx tsx scripts/profile_beast2_ir.ts --ir /tmp/ui_fn.beast2 [iterations]
 *   npx tsx scripts/profile_beast2_ir.ts --value /tmp/ui.beast2 [iterations]
 *   npx tsx scripts/profile_beast2_ir.ts --both /tmp/ui_fn.beast2 /tmp/ui.beast2 [iterations]
 *
 * Generate test files:
 *   cd libs/east && npx tsx contrib/examples/beast2_v2_benchmark.ts
 */
import { readFileSync } from 'node:fs';
import { createEastWasm } from '../dist/src/index.js';

const args = process.argv.slice(2);
let mode: 'ir' | 'value' | 'both' = 'ir';
const files: string[] = [];
let iters = 3;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ir') mode = 'ir';
    else if (args[i] === '--value') mode = 'value';
    else if (args[i] === '--both') mode = 'both';
    else if (args[i]!.match(/^\d+$/)) iters = parseInt(args[i]!, 10);
    else files.push(args[i]!);
}

if (files.length === 0) {
    console.error('Usage: npx tsx scripts/profile_beast2_ir.ts [--ir|--value|--both] <file.beast2> [file2.beast2] [iterations]');
    process.exit(1);
}

const east = await createEastWasm();

function profileIR(filePath: string) {
    const data = readFileSync(filePath);
    console.log(`File: ${filePath} (${data.length} bytes, ${(data.length / 1048576).toFixed(2)} MB)`);
    console.log(`Mode: IR (direct decode)\n`);

    // Warmup
    east.compileFromBeast2(data);

    // Timed decode+compile
    const decodeStart = performance.now();
    let compiled;
    for (let i = 0; i < iters; i++) {
        compiled = east.compileFromBeast2(data);
    }
    const decodeMs = (performance.now() - decodeStart) / iters;
    console.log(`=== IR Decode (direct) ===`);
    console.log(`  ${iters} iterations: ${decodeMs.toFixed(1)} ms/call\n`);

    // Timed execute (call closure if returned)
    try {
        // Warmup execute
        compiled!();

        const execStart = performance.now();
        for (let i = 0; i < iters; i++) {
            compiled!();
        }
        const execMs = (performance.now() - execStart) / iters;
        console.log(`=== Execute ===`);
        console.log(`  ${iters} iterations: ${execMs.toFixed(1)} ms/call\n`);
        console.log(`=== Summary ===`);
        console.log(`  decode: ${decodeMs.toFixed(1)} ms`);
        console.log(`  execute: ${execMs.toFixed(1)} ms`);
        console.log(`  total: ${(decodeMs + execMs).toFixed(1)} ms`);
    } catch {
        console.log(`=== Execute ===`);
        console.log(`  (skipped — result marshalling error)\n`);
        console.log(`=== Summary ===`);
        console.log(`  decode: ${decodeMs.toFixed(1)} ms`);
    }
}

function profileValue(filePath: string) {
    const data = readFileSync(filePath);
    console.log(`File: ${filePath} (${data.length} bytes, ${(data.length / 1048576).toFixed(2)} MB)`);
    console.log(`Mode: value (beast2_decode_auto)\n`);

    // Warmup
    east.decodeValue(new Uint8Array(data));

    // Timed decode
    const decodeStart = performance.now();
    for (let i = 0; i < iters; i++) {
        east.decodeValue(new Uint8Array(data));
    }
    const decodeMs = (performance.now() - decodeStart) / iters;
    console.log(`=== Decode ===`);
    console.log(`  ${iters} iterations: ${decodeMs.toFixed(1)} ms/call\n`);
    console.log(`=== Summary ===`);
    console.log(`  decode: ${decodeMs.toFixed(1)} ms`);
}

if (mode === 'ir' || mode === 'both') {
    profileIR(files[0]!);
}
if (mode === 'both') console.log('\n');
if (mode === 'value' || mode === 'both') {
    const valueFile = mode === 'both' ? (files[1] ?? files[0]!) : files[0]!;
    profileValue(valueFile);
}
