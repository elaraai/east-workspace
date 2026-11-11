/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The function a builder's rows are read through is the same from one
 * evaluation of its author's block to the next (#1599): across every example
 * — the Sheet's, the Record's and the Plan's among them — the page a builder
 * derives over its source, `(Integer, Integer) → Option<a window of its rows>`,
 * captures no mutable variable.
 *
 * An author binds a handle with `$.let` as a rule, and a function captures a
 * mutable variable as its box, which each evaluation of the author's block
 * makes anew: the page would then differ from the last evaluation's (East's
 * `equivalentFor` — two boxes are two variables, whatever they hold), though
 * the handle is the same one. A renderer keeps the windows it read by the page
 * that read them, so it would read them all again whenever a State the block
 * reads, or a record it reads whole, moved — every row drawn again. A builder
 * binds its author's handles (`utils/held.ts`), and its slice's sources
 * (`utils/record-sources.ts`), once as constants in its own block.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fromEastTypeValue, isTypeEqual, walkIR, type EastType, type EastTypeValue, type IR } from "@elaraai/east";
import { Plan, Sheet } from "@elaraai/e3-ui/internal";

/** Each builder's page, by the builder: a window of its rows, `none` while one is on its way. */
const PAGES: Readonly<Record<string, EastType>> = {
    Sheet: Sheet.Types.Root.fields.rows.cases.paged.fields.page,
    Plan: Plan.Types.Root.fields.rows.cases.paged.fields.page,
};

/** Every example of the package: its module, by its path under the tests, its name, and its program. */
const root = new URL("../", import.meta.url);
const modules = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".examples.js")).sort();
const examples = (await Promise.all(modules.map(async (module) => {
    const exported = await import(new URL(module, root).href) as Record<string, unknown>;
    return Object.entries(exported).flatMap(([name, value]) => typeof value === "object" && value !== null && "keywords" in value && "fn" in value
        ? [{ module, name, ir: (value.fn as { toIR(): { ir: IR } }).toIR().ir }] : []);
}))).flat();

/** Each function type's builder, by the type value: equal types share one. `null` for a function that is no builder's page. */
const pages = new WeakMap<EastTypeValue, string | null>();

/** The builder whose page a function's type is, if any. */
function pageOf(type: EastTypeValue): string | null {
    let known = pages.get(type);
    if (known === undefined) {
        known = null;
        if (type.type === "Function" && type.value.inputs.length === 2) {
            const made = fromEastTypeValue(type);
            known = Object.keys(PAGES).find((builder) => isTypeEqual(made, PAGES[builder]!)) ?? null;
        }
        pages.set(type, known);
    }
    return known;
}

/** The pages a program makes as values: each one's builder, and the mutable variables it captures. */
function pagesOf(ir: IR): { builder: string; boxed: string[] }[] {
    const found: { builder: string; boxed: string[] }[] = [];
    walkIR(ir, (node, { parent }) => {
        if (node.type !== "Function") return;
        const builder = pageOf(node.value.type);
        if (builder === null) return;
        // Called where it is made: never a value a renderer keeps.
        if (parent !== null && (parent.type === "Call" || parent.type === "CallAsync") && Object.is(parent.value.function, node)) return;
        found.push({ builder, boxed: node.value.captures.filter((capture) => capture.value.mutable).map((capture) => capture.value.name) });
    });
    return found;
}

test("the examples make each builder's page over a source, so the guard below reads them — the Sheet's, the Record's and the Plan's", () => {
    const made = new Set(examples.flatMap(({ module, ir }) => pagesOf(ir).map(({ builder }) => `${module.split(/[\\/]/)[0]}:${builder}`)));
    assert.deepEqual(["sheet:Sheet", "record:Sheet", "plan:Plan"].filter((pair) => !made.has(pair)), []);
});

test("no builder's page captures a mutable variable: a builder binds its author's handles, and its slice's sources, once as constants in its own block (#1599)", () => {
    const boxed = examples.flatMap(({ module, name, ir }) => pagesOf(ir).flatMap(({ builder, boxed: captured }) =>
        (captured.length === 0 ? [] : [`${module} ${name}: the ${builder}'s page captures ${captured.join(", ")}, each a mutable variable`])));
    assert.deepEqual(boxed, []);
});
