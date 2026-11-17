/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A page's answers (#1670): a program that reads `.now` is asked for the
 * page's minute — the host's, where it pins one — not again within it, and
 * again once it moves on; a program that reads no `.now` is kept across
 * minutes.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ArrayType, DateTimeType, FloatType, StructType, decodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import type { StudioSourceType } from "@elaraai/e3-ui/internal";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import { QueryCallProvider, type QueryCall } from "../hooks.js";
import { createInMemoryQueryCall } from "../in-memory-call.js";
import { VisualAnswersProvider, useVisualAnswers } from "./answers.js";
import type { VisualAsk } from "./print.js";

afterEach(() => { cleanup(); });

const Row = StructType({ ordered_at: DateTimeType, revenue: FloatType });
const PATH = [variant("field", "inputs"), variant("field", "orders")];
const ORDERS: ValueTypeOf<typeof Row>[] = [
    { ordered_at: at("2026-07-03T10:00:00"), revenue: 100 },
    { ordered_at: at("2026-07-20T10:00:00"), revenue: 50 },
    { ordered_at: at("2026-08-02T10:00:00"), revenue: 60 },
];
const DATASETS = [{ path: PATH, type: ArrayType(Row), value: ORDERS }];
const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "orders", name: "Orders", icon: "receipt", description: none,
    binding: { name: "orders", source: variant("value", PATH), type: toEastTypeValue(ArrayType(Row)) },
    fields: [], range: some("ordered_at"), search: [], split: [],
};

/** A total over the orders, as the printer gives one: the last 14 days', reading `.now`, or every order's. */
const total = (rows: string, readsNow: boolean): readonly VisualAsk[] => [{
    role: "total", period: "current", values: [0], readsNow,
    program: `${rows}\n| {rows: [{v0: (map(.revenue) | add), n: length}], groups: 1, n: length}`,
}];
const RECENT = total(".now as $now\n| .orders\n| map(select(.ordered_at >= ($now | datetime_add(-14; \"day\"))))", true);
const ALL = total(".orders", false);

/** A tile: how many rows each of its programs read, once answered. */
function Tile({ asks, name }: { asks: readonly VisualAsk[]; name: string }) {
    const state = useVisualAnswers(asks, "orders");
    const said = state.status === "answered" ? state.answers.map((a) => (a.kind === "answered" ? `${a.n} rows` : a.kind)).join(", ") : state.status;
    return <span data-testid={name}>{said}</span>;
}

describe("a page's answers and .now", () => {
    test("a program that reads .now is asked for the page's minute, not again within it, and again once it moves on; one that reads none is kept", async () => {
        const inMemory = createInMemoryQueryCall(DATASETS);
        const asked: { readonly reads: "now" | "all"; readonly minute: Date | undefined }[] = [];
        const call: QueryCall = (request, options) => {
            const clock = request.args.find((arg) => arg.type === "value");
            asked.push({ reads: clock === undefined ? "all" : "now", minute: clock?.type === "value" ? decodeBeast2For(DateTimeType)(clock.value) : undefined });
            return inMemory(request, options);
        };
        const view = (now: Date) => (
            <QueryCallProvider call={call}>
                <VisualAnswersProvider sources={[SOURCE]} now={now}>
                    <Tile asks={RECENT} name="recent" />
                    <Tile asks={ALL} name="all" />
                </VisualAnswersProvider>
            </QueryCallProvider>
        );
        const sameMinute = equalFor(DateTimeType);
        const { rerender } = render(view(at("2026-08-10T10:42:31")));
        // The last 14 days hold August's order alone.
        await waitFor(() => expect([screen.getByTestId("recent").textContent, screen.getByTestId("all").textContent]).toEqual(["1 rows", "3 rows"]));
        expect(asked.map((a) => a.reads).sort()).toEqual(["all", "now"]);
        expect(sameMinute(asked.find((a) => a.reads === "now")!.minute!, at("2026-08-10T10:42:00"))).toBe(true);
        // Later in the same minute: nothing asked again.
        rerender(view(at("2026-08-10T10:42:59")));
        await waitFor(() => expect(screen.getByTestId("recent").textContent).toBe("1 rows"));
        expect(asked).toHaveLength(2);
        // The next minute: the program that reads .now is asked for it; the other is kept.
        rerender(view(at("2026-08-10T10:43:05")));
        await waitFor(() => expect(asked).toHaveLength(3));
        expect(asked[2]!.reads).toBe("now");
        expect(sameMinute(asked[2]!.minute!, at("2026-08-10T10:43:00"))).toBe(true);
        await waitFor(() => expect([screen.getByTestId("recent").textContent, screen.getByTestId("all").textContent]).toEqual(["1 rows", "3 rows"]));
        expect(asked).toHaveLength(3);
    });
});
