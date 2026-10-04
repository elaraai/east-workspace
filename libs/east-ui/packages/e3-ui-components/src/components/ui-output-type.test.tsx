/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A ui task's preview renders its output when the output is a UI component:
 * its type is UIComponentType or a subtype of it, as East's isSubtype judges.
 * Any other output is named in place, "This task's output is a String, not a
 * UI component", and never read, in the kiosk as in the preview (#1118).
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import {
    ArrayType, East, IntegerType, RecursiveType, StringType, VariantType, encodeBeast2For, none, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";
import { BEAST2_CONTENT_TYPE, DatasetStatusDetailType, ResponseType, TaskDetailsType } from "@elaraai/e3-types";
import { getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { E3Provider } from "../platform/e3-config.js";
import { UITaskPreview } from "./UITaskPreview.js";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const API = "http://e3.test";
const HASH = "5".repeat(64);

/** A ui task binding nothing, whose output is `.out`. */
const TASK = encodeBeast2For(ResponseType(TaskDetailsType))(variant("success", {
    name: "view",
    hash: "2".repeat(64),
    body: variant("east", { program: "3".repeat(64) }),
    runner: variant("east_node", { platforms: [], decode: variant("lazy", null) }),
    inputs: [],
    output: { path: [variant("field", "out")], kind: variant("value", null) },
    role: variant("ui", { paths: [], functions: [], records: [], pages: [] }),
}));

/** UIComponentType's Text case alone: a subtype of it. */
const TextOnly = VariantType({ Text: UIComponentType.node.cases.Text });

/** A view reading "the view". */
const VIEW = East.compile(
    East.function([], UIComponentType, (_$) => Text.Root("the view")),
    getRegisteredPlatformImplementations(),
)() as ValueTypeOf<typeof UIComponentType>;

/** The view, as a value of {@link TextOnly}. */
function textOnly(view: ValueTypeOf<typeof UIComponentType>): ValueTypeOf<typeof TextOnly> {
    if (view.type !== "Text") throw new Error(`the view is a ${view.type}, not a Text`);
    return variant("Text", view.value);
}

/** A tree of names: recursive, as UIComponentType is, and no UI component. */
const Tree = RecursiveType(self => VariantType({ leaf: StringType, node: ArrayType(self) }));

/**
 * A server whose ui task's output holds `value`, a value of `type`, or holds
 * none yet when `value` is undefined.
 *
 * @returns How many times the output's value is read
 */
function serve<T extends EastType>(type: T, value: ValueTypeOf<T> | undefined): { reads: number } {
    const bytes = value === undefined ? new Uint8Array() : encodeBeast2For(type)(value);
    const status = encodeBeast2For(ResponseType(DatasetStatusDetailType))(variant("success", {
        path: ".out",
        type: toEastTypeValue(type),
        refType: value === undefined ? "unassigned" : "value",
        hash: value === undefined ? none : some(HASH),
        size: value === undefined ? none : some(BigInt(bytes.length)),
        segments: none,
        rows: none,
    }));
    const served = { reads: 0 };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url.includes("/tasks/view")) return new Response(TASK.slice(), { status: 200 });
        if (url.includes("/datasets/out?status=true")) return new Response(status.slice(), { status: 200 });
        if (url.includes("/datasets/out?segments=true")) {
            served.reads++;
            return new Response(bytes.slice(), { status: 200, headers: { "Content-Type": BEAST2_CONTENT_TYPE, "X-Content-SHA256": HASH } });
        }
        return new Response(JSON.stringify({ error: { type: "internal", message: "not served" } }), { status: 500 });
    }));
    return served;
}

/** The preview, or the kiosk's when `bare`, under a client that tries no failed query again itself. */
function renderPreview(bare = false) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <ChakraProvider value={system}>
            <E3Provider config={{ apiUrl: API, workspace: "w" }} queryClient={client}>
                <UITaskPreview task="view" bare={bare} />
            </E3Provider>
        </ChakraProvider>,
    );
}

describe("a UITaskPreview whose output is not a UI component (#1118)", () => {
    test("names its type in place, and never reads it", async () => {
        const served = serve(StringType, "hello");
        renderPreview();
        expect(await screen.findByText("This task's output is a String, not a UI component")).not.toBe(null);
        expect(screen.getByText("Not a UI component")).toBeTruthy();
        expect(served.reads).toBe(0);
    });

    test("names a compound type by its kind, with East's summary of it", async () => {
        serve(ArrayType(IntegerType), [1n, 2n]);
        renderPreview();
        expect(await screen.findByText("This task's output is an Array, not a UI component")).not.toBe(null);
        expect(screen.getByText(".Array .Integer")).toBeTruthy();
    });

    test("names a recursive type by its node's kind", async () => {
        serve(Tree, variant("node", [variant("leaf", "a"), variant("leaf", "b")]));
        renderPreview();
        expect(await screen.findByText("This task's output is a Variant, not a UI component")).not.toBe(null);
    });

    test("names it in the kiosk too", async () => {
        const served = serve(StringType, "hello");
        renderPreview(true);
        expect(await screen.findByText("This task's output is a String, not a UI component")).not.toBe(null);
        expect(served.reads).toBe(0);
    });

    test("says there is no output yet while there is none", async () => {
        serve(StringType, undefined);
        renderPreview();
        expect(await screen.findByText("No output yet")).not.toBe(null);
        expect(screen.queryByText("Not a UI component")).toBe(null);
    });
});

describe("a UITaskPreview whose output is a UI component", () => {
    test("renders one of UIComponentType", async () => {
        serve(UIComponentType, VIEW);
        renderPreview();
        expect(await screen.findByText("the view")).not.toBe(null);
    });

    test("renders one of a subtype of UIComponentType (#1118)", async () => {
        serve(TextOnly, textOnly(VIEW));
        renderPreview();
        expect(await screen.findByText("the view")).not.toBe(null);
        expect(screen.queryByText("Not a UI component")).toBe(null);
    });
});
