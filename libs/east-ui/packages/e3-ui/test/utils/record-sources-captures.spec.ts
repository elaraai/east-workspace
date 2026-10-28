/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * A builder reads its sources through `recordSources(…).bind($)` (#1356):
 * across every example — the Allocation's, the Roster's, the Calendar's, the
 * Plan's, the Sheet's, the Flowchart's and the Schematic's among them — no function captures
 * the whole slice. A function captures what it reads, and beast2 writes a
 * captured value wherever a function holding it is written, so one that read
 * through the slice would carry every source's methods. A capture is the whole
 * slice when its type is, or holds, `Slice.bindRecords`' handle or the rail's
 * projection of it (`isTypeEqual`). A function called where it is made — the
 * slice's own build, the rail's projection — is never a value, so only its
 * body is looked into.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fromEastTypeValue, isTypeEqual, walkIR, type EastType, type EastTypeValue, type IR } from "@elaraai/east";
import { RecordSlicesBindType, RecordSlicesHandleType } from "@elaraai/east-ui/internal";

/** The builders whose `slice` is one `Slice.bindRecords`, by the folder their examples are in. */
const BUILDERS = ["allocation", "roster", "calendar", "plan", "sheet", "flowchart", "schematic"];

/** Every example of the package: its module, by its path under the tests, its name, and its program. */
const root = new URL("../", import.meta.url);
const modules = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".examples.js")).sort();
const examples = (await Promise.all(modules.map(async (module) => {
    const exported = await import(new URL(module, root).href) as Record<string, unknown>;
    return Object.entries(exported).flatMap(([name, value]) => typeof value === "object" && value !== null && "keywords" in value && "fn" in value
        ? [{ module, name, ir: (value.fn as { toIR(): { ir: IR } }).toIR().ir }] : []);
}))).flat();

/** Whether a type is the slice: `Slice.bindRecords`' handle, or the rail's projection of it. */
function isSlice(type: EastType): boolean {
    if (type.type !== "Struct") return false;
    const sources = type.fields["sources"];
    return sources === undefined ? isTypeEqual(type, RecordSlicesBindType)
        : sources.type === "Struct" && isTypeEqual(type, RecordSlicesHandleType(sources.fields));
}

/** Whether a type value is the slice's: only a struct with the slice's controls is read back to a type to compare. */
function isSliceValue(type: EastTypeValue): boolean {
    return type.type === "Struct" && type.value.some((field) => field.name === "parts") && type.value.some((field) => field.name === "togglePreset")
        && isSlice(fromEastTypeValue(type));
}

/** Each type value's answer, by the type value: equal types share one. */
const held = new WeakMap<EastTypeValue, boolean>();

/** Whether a type is, or holds, the slice, through the values it holds: a function's type holds none. */
function holdsSlice(type: EastTypeValue): boolean {
    const known = held.get(type);
    if (known !== undefined) return known;
    let holds = false;
    switch (type.type) {
        case "Struct":
            holds = isSliceValue(type) || type.value.some((field) => holdsSlice(field.type));
            break;
        case "Variant":
            holds = type.value.some((arm) => holdsSlice(arm.type));
            break;
        case "Array": case "Set": case "Ref": case "Vector": case "Matrix":
            holds = holdsSlice(type.value);
            break;
        case "Dict":
            holds = holdsSlice(type.value.key) || holdsSlice(type.value.value);
            break;
        case "Recursive":
            holds = type.value.type === "wrapper" && holdsSlice(type.value.value.inner);
            break;
    }
    held.set(type, holds);
    return holds;
}

/** The variables that are, or hold, the slice, captured by a function a program makes as a value. */
function sliceCaptures(ir: IR): string[] {
    const found: string[] = [];
    walkIR(ir, (node, { parent }) => {
        if (node.type !== "Function" && node.type !== "AsyncFunction") return;
        // Called where it is made: never a value, so never written.
        if (parent !== null && (parent.type === "Call" || parent.type === "CallAsync") && Object.is(parent.value.function, node)) return;
        for (const capture of node.value.captures) {
            if (holdsSlice(capture.value.type)) found.push(capture.value.name);
        }
    });
    return found;
}

/** Whether a program binds a `Slice.bindRecords`. */
function bindsSlice(ir: IR): boolean {
    let binds = false;
    walkIR(ir, (node) => {
        if (node.type === "Let" && isSliceValue(node.value.variable.value.type)) binds = true;
    });
    return binds;
}

test("every builder's examples bind a Slice.bindRecords, so the guard below reads each builder's narrowing", () => {
    const binding = new Set(examples.filter(({ ir }) => bindsSlice(ir)).map(({ module }) => module.split(/[\\/]/)[0]));
    assert.deepEqual(BUILDERS.filter((builder) => !binding.has(builder)), []);
});

test("no example's function captures the whole slice: a builder reads its sources through recordSources(…).bind($) (#1356)", () => {
    const whole = examples.flatMap(({ module, name, ir }) =>
        sliceCaptures(ir).map((capture) => `${module} ${name}: a function captures ${capture}, the whole slice`));
    assert.deepEqual(whole, []);
});
