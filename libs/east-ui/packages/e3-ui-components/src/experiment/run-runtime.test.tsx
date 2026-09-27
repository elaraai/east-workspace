/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `useFuncCall` holds its call handle while the bound signature names the same
 * East types — East's own type equality decides it, never a string made of
 * the types. A recursive parameter type (the Experiment's rows may hold a
 * tree) binds like any other: its type value carries bigint ids, which the
 * old `JSON.stringify` key threw on, taking the whole surface down.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ArrayType, IntegerType, RecursiveType, StringType, StructType, type EastType } from "@elaraai/east";
import { E3Provider } from "../platform/e3-config.js";
import { ReactiveDatasetProvider } from "../platform/dataset-hooks.js";
import { useFuncCall, type FuncCall } from "./run-runtime.js";

afterEach(cleanup);

/** A row holding a tree of labels. */
const Tree = RecursiveType((self) => StructType({ label: StringType, children: ArrayType(self) }));
const rowsOf = (): EastType[] => [ArrayType(StructType({ id: IntegerType, tree: Tree }))];

/** Records what the hook returns on each render. */
function Probe({ inputs, seen }: { inputs: EastType[]; seen: FuncCall<unknown>[] }) {
    seen.push(useFuncCall<unknown>("count", inputs, IntegerType));
    return null;
}

const view = (inputs: EastType[], seen: FuncCall<unknown>[]) => (
    <E3Provider config={{ apiUrl: "http://127.0.0.1:9", workspace: "ws" }}>
        <ReactiveDatasetProvider><Probe inputs={inputs} seen={seen} /></ReactiveDatasetProvider>
    </E3Provider>
);

describe("useFuncCall", () => {
    test("a recursive parameter type binds, and fresh arrays naming the same types keep the call", () => {
        const seen: FuncCall<unknown>[] = [];
        const { rerender } = render(view(rowsOf(), seen));
        const bound = seen[seen.length - 1]!;
        expect(bound.status).toBe("idle");
        expect(bound.result).toBeNull();

        // A new render with new arrays of the same types: the same call.
        rerender(view(rowsOf(), seen));
        expect(seen[seen.length - 1]).toBe(bound);
    });
});
