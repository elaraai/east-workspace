/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
    ArrayType, East, FloatType, IntegerType, IRType, StringType, StructType, toJSONFor,
    type EastType,
} from "../src/index.js";
import { SourceMap, with_source_map } from "../src/location.js";
import type { BlockBuilder } from "../src/expr/block.js";

/* Cross-backend platform-signature check parity (east-workspace#62).
 *
 * The analyzer rejects a Platform node whose IR-declared types differ from
 * the registered implementation's declared types. This spec pins the three
 * canonical error strings on the TS reference compiler, and (under
 * EXPORT_TEST_IR) exports each case's IR plus the actually-thrown message to
 * <dir>/platform_check/ so the east-c and east-py test suites can compile
 * the SAME IR against the same drifted registration and assert a
 * byte-identical error. The registered-side (drifted) types below must stay
 * in lockstep with east-c tests/test_platform_check.c and east-py
 * tests/test_platform_check.py. */

const NAME = "compliance.check";

/* Same export wrapper format as describeEast (platforms.spec.ts) so the
 * east-c / east-py fixture loaders reuse their compliance decode path. */
const LocationType = StructType({ column: IntegerType, filename: StringType, line: IntegerType });
const SourceMapType = StructType({ stacks: ArrayType(ArrayType(LocationType)) });
const ExportWrapperType = StructType({ ir: IRType, source_map: SourceMapType });
const exportToJSON = toJSONFor(ExportWrapperType);

interface CheckCase {
    name: string;
    /** IR-side declaration (what the call site was authored against). */
    ir: { inputs: EastType[]; output: EastType };
    /** Registered-side declaration (what the implementation registers). */
    registered: { inputs: EastType[]; output: EastType };
    /** Expected analyzer message; null for the well-typed control case. */
    error: ((location: string) => string) | null;
}

const cases: CheckCase[] = [
    {
        name: "arg_count",
        ir: { inputs: [IntegerType], output: IntegerType },
        registered: { inputs: [IntegerType, IntegerType], output: IntegerType },
        error: (location) =>
            `Platform function '${NAME}' expects 2 arguments but got 1 at ${location}`,
    },
    {
        name: "input_type",
        ir: { inputs: [ArrayType(IntegerType)], output: IntegerType },
        registered: { inputs: [ArrayType(FloatType)], output: IntegerType },
        error: (location) =>
            `Platform function '${NAME}' argument 1 requires exact type match. ` +
            `Expected type .Array .Float but got .Array .Integer. ` +
            `Insert an As node if subtyping is intended. at ${location}`,
    },
    {
        name: "return_type",
        ir: { inputs: [IntegerType], output: IntegerType },
        registered: { inputs: [IntegerType], output: StructType({ a: IntegerType }) },
        error: (location) =>
            `Platform function '${NAME}' return type expected to be ` +
            `.Struct [(name="a", type=.Integer)] but IR has .Integer at ${location}`,
    },
    {
        name: "match",
        ir: { inputs: [IntegerType], output: IntegerType },
        registered: { inputs: [IntegerType], output: IntegerType },
        error: null,
    },
];

function zeroValueArg($: BlockBuilder<EastType>, t: EastType): unknown {
    if (t.type === "Integer") return $.const(0n, IntegerType);
    if (t.type === "Array") return $.const([], t);
    throw new Error(`platform_check: unhandled IR input type ${t.type}`);
}

/* Find the (single) Platform node in an IR value tree and return its loc_id. */
function extractPlatformLocId(node: unknown): bigint | null {
    if (node === null || typeof node !== "object") return null;
    const rec = node as { type?: unknown; value?: unknown };
    if (rec.type === "Platform") {
        return (rec.value as { loc_id: bigint }).loc_id;
    }
    for (const v of Object.values(node)) {
        if (Array.isArray(v)) {
            for (const item of v) {
                const found = extractPlatformLocId(item);
                if (found !== null) return found;
            }
        } else {
            const found = extractPlatformLocId(v);
            if (found !== null) return found;
        }
    }
    return null;
}

for (const c of cases) {
    test(`platform signature check: ${c.name}`, () => {
        // Fresh SourceMap per case: loc_ids stay small and stable, so the
        // exported fixtures (and the loc_id embedded in the expected message)
        // do not shift when unrelated specs change.
        const fn = with_source_map(new SourceMap(), () => {
            const decl = East.platform(NAME, c.ir.inputs, c.ir.output);
            return East.function([], c.ir.output, ($) =>
                decl.call($, ...c.ir.inputs.map((t) => zeroValueArg($, t))),
            );
        });

        const drifted = East.platform(NAME, c.registered.inputs, c.registered.output)
            .implement(() => { throw new Error("platform_check: never invoked"); });

        const eir = fn.toIR();

        let thrown: string | null = null;
        try {
            eir.compile([drifted]);
        } catch (e) {
            thrown = (e as Error).message;
        }

        if (c.error === null) {
            assert.equal(thrown, null, `well-typed case must compile, threw: ${thrown}`);
        } else {
            const locId = extractPlatformLocId(eir.ir);
            assert.ok(locId !== null, "fixture IR must contain a Platform node");
            // The message must name a source location, not the id: resolve it
            // through the same map the fixture exports, so the other runtimes
            // can reach the identical string from the serialized map.
            const [location] = eir.source_map!.resolve(locId);
            assert.ok(location, "the Platform node's loc_id must resolve through the exported map");
            assert.equal(thrown, c.error(`${location.filename}:${location.line}:${location.column}`));
        }

        if (process.env.EXPORT_TEST_IR) {
            const outDir = join(process.env.EXPORT_TEST_IR, "platform_check");
            mkdirSync(outDir, { recursive: true });
            const stacks = (eir.source_map?.entries() ?? [[]]).map((stack) =>
                stack.map((f) => ({ column: f.column, filename: f.filename, line: f.line })),
            );
            const wrapperJSON = exportToJSON({ ir: eir.ir, source_map: { stacks } });
            writeFileSync(join(outDir, `${c.name}.json`), JSON.stringify(wrapperJSON, null, 2));
            if (thrown !== null) {
                writeFileSync(join(outDir, `${c.name}.error.txt`), thrown + "\n");
            }
        }
    });
}
