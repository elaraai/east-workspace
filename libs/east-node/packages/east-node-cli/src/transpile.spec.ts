/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `east-node transpile` (#628): an IR file prints as a TypeScript
 * module that rebuilds the same IR, in file and directory mode, for every
 * IR file format the loader reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    East, IntegerType, StringType, ArrayType, IRType,
    encodeEastIR, encodeJSONFor, decodeEastIR, toSource, isTypeValueEqual,
} from '@elaraai/east';

import { transpile, transpileDir, encodeRebuilt } from './transpile.js';

const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
const greet = East.function([StringType, ArrayType(IntegerType)], StringType, ($, name, xs) => {
    const total = $.let(0n);
    $.for(xs, ($, x) => { $.assign(total, total.add(x)); });
    return East.str`${name}: ${total}`;
});

function scratch(): string {
    return mkdtempSync(join(tmpdir(), 'enc-transpile-'));
}

describe('east-node transpile', () => {
    it('prints a beast2 IR file as a module that rebuilds the same IR', async () => {
        const dir = scratch();
        try {
            const ir = double.toIR();
            const path = join(dir, 'double.beast2');
            writeFileSync(path, encodeEastIR(ir));

            const { source, rebuilt } = await transpile(path, { rebuild: true });
            assert.match(source, /^import \{ East, .* \} from "@elaraai\/east";$/m);
            assert.match(source, /export const main = East\.function\(\[IntegerType\], IntegerType, \(\$, x\) => \{/);
            assert.ok(rebuilt !== undefined);
            // The rebuild is a fixpoint: printing it gives the same module back.
            assert.equal(toSource(rebuilt, {}), toSource(ir, {}));
            assert.ok(isTypeValueEqual(rebuilt.ir.value.type as any, ir.ir.value.type as any));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('honours the export name and import specifier, and still rebuilds', async () => {
        const dir = scratch();
        try {
            const path = join(dir, 'greet.json');
            writeFileSync(path, encodeJSONFor(IRType)(greet.toIR().ir as any));

            const { source, rebuilt } = await transpile(path, { name: 'greet', importFrom: '../east/index.js', rebuild: true });
            assert.match(source, /from "\.\.\/east\/index\.js";/);
            assert.match(source, /export const greet = East\.function\(/);
            assert.match(source, /\$\.for\(xs, \(\$, x, _4, label\) => \{/);  // the slot the body did not name stays _N (#639)
            assert.equal(toSource(rebuilt!, { name: 'greet' }), toSource(greet, { name: 'greet' }));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('encodes a rebuilt IR by extension', async () => {
        const dir = scratch();
        try {
            const path = join(dir, 'double.beast2');
            writeFileSync(path, encodeEastIR(double.toIR()));
            const { rebuilt } = await transpile(path, { rebuild: true });

            const bundle = decodeEastIR(encodeRebuilt(rebuilt!, join(dir, 'out.beast2')));
            assert.equal(bundle.ir.type, 'Function');
            const json = JSON.parse(Buffer.from(encodeRebuilt(rebuilt!, join(dir, 'out.json'))).toString('utf-8'));
            assert.equal(json.type, 'Function');
            assert.throws(() => encodeRebuilt(rebuilt!, join(dir, 'out.txt')), /Unsupported rebuild extension/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('transpiles a directory, one module (and one rebuilt IR) per IR file', async () => {
        const dir = scratch();
        try {
            const input = join(dir, 'in');
            const out = join(dir, 'out');
            const rebuilt = join(dir, 'rebuilt');
            const { mkdirSync } = await import('node:fs');
            mkdirSync(input);
            writeFileSync(join(input, 'double.beast2'), encodeEastIR(double.toIR()));
            writeFileSync(join(input, 'greet.json'), encodeJSONFor(IRType)(greet.toIR().ir as any));
            writeFileSync(join(input, 'notes.txt'), 'not an IR file');

            const stems = await transpileDir(input, out, { rebuildDir: rebuilt });
            assert.deepEqual(stems, ['double', 'greet']);
            assert.deepEqual(readdirSync(out).sort(), ['double.ts', 'greet.ts']);
            assert.deepEqual(readdirSync(rebuilt).sort(), ['double.beast2', 'greet.beast2']);
            assert.match(readFileSync(join(out, 'greet.ts'), 'utf-8'), /export const main = East\.function\(/);
            assert.equal(toSource(decodeEastIR(readFileSync(join(rebuilt, 'greet.beast2'))), {}), toSource(greet, {}));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects an IR file whose root is not a function', async () => {
        const dir = scratch();
        try {
            const path = join(dir, 'value.json');
            writeFileSync(path, JSON.stringify({ type: 'Value', value: { type: { type: 'Integer', value: null }, loc_id: '0', value: { type: 'Integer', value: '1' } } }));
            await assert.rejects(transpile(path), /must contain a function/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
