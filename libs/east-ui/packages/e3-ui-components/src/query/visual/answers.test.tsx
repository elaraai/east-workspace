/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A page's answers and `.now` (#1670), asked on e3 itself over the Studio
 * examples' daily revenue: a program that reads `.now` is asked for the page's minute
 * — the host's, where it pins one — not again within it, and again once it
 * moves on, its tile keeping what it drew until the new answer lands; a
 * program that reads no `.now` is kept across minutes, and its tile draws
 * nothing again as the minute moves on.
 */

import { useState, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { DateTimeType, decodeBeast2For, equalFor, none, some, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { OneShotRequestType } from "@elaraai/e3-types";
import type { StudioSourceType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import { VisualAnswersProvider, useVisualAnswers } from "./answers.js";
import type { VisualAsk } from "./print.js";

const h = e3Harness({ "studio/studio": ex }, { measure: false });

/** The revenue of each day, as a page lists it. */
const SOURCE: ValueTypeOf<typeof StudioSourceType> = {
    key: "daily", name: "Daily revenue", icon: "chart-line", description: none,
    binding: { name: "daily", source: variant("value", ex.studioRevenueDaily.path), type: toEastTypeValue(ex.studioRevenueDaily.type) },
    fields: [], range: some("day"), search: [], split: [],
};
/** The sources the page lists: one list, as a page holds it while it shows. */
const SOURCES = [SOURCE];

/** A total over the days, as the printer gives one: the last 14 days', reading `.now`, or every day's. */
const total = (rows: string, readsNow: boolean): readonly VisualAsk[] => [{
    role: "total", period: "current", values: [0], readsNow,
    program: `${rows}\n| {rows: [{v0: (map(.revenue) | add), n: length}], groups: 1, n: length}`,
}];
const RECENT = total(".now as $now\n| .daily\n| map(select(.day >= ($now | datetime_add(-14; \"day\"))))", true);
const ALL = total(".daily", false);

/** How many times each tile has drawn. */
const draws = new Map<string, number>();

/** A tile: how many rows each of its programs read, once answered, and each time it draws, counted. */
function Tile({ asks, name }: { asks: readonly VisualAsk[]; name: string }) {
    const state = useVisualAnswers(asks, "daily");
    draws.set(name, (draws.get(name) ?? 0) + 1);
    const said = state.status === "answered" ? state.answers.map((a) => (a.kind === "answered" ? `${a.n} rows` : a.kind)).join(", ") : state.status;
    return <span data-testid={name}>{said}</span>;
}

/** Moves the page's minute on: the host's now, which it pins. */
let pin: ((now: Date) => void) | undefined;

/** A page's answers at the instant the host pins as now, over the tiles it is given: they are its children, made by its host. */
function Pinned({ first, children }: { first: Date; children: ReactNode }) {
    const [now, setNow] = useState(first);
    pin = setNow;
    return <VisualAnswersProvider sources={SOURCES} now={now}>{children}</VisualAnswersProvider>;
}

const readOneShot = decodeBeast2For(OneShotRequestType);
const readMinute = decodeBeast2For(DateTimeType);
const sameMinute = equalFor(DateTimeType);

/** The one-shot calls the page has launched of e3, each by the minute it was given as `.now`: `undefined` for a program that reads none. */
const asked = (): (Date | undefined)[] => h.requests("one-shot").filter((request) => request.method === "POST").map((request) => {
    const clock = readOneShot(request.body!).args.find((arg) => arg.type === "value");
    return clock?.type === "value" ? readMinute(clock.value) : undefined;
});

/** What each tile says. */
const said = () => [screen.getByTestId("recent").textContent, screen.getByTestId("all").textContent];

describe("a page's answers and .now, on e3", () => {
    test("a program that reads .now is asked for the page's minute, not again within it, and again once it moves on, its tile keeping what it drew meanwhile; one that reads none is kept, and its tile draws nothing again", async () => {
        await h.mount(ex.studioContent, {
            view: <Pinned first={at("2026-03-19T00:00:30")}><Tile asks={RECENT} name="recent" /><Tile asks={ALL} name="all" /></Pinned>,
        });
        // The last 14 days to midnight of 19 March hold the days from 5 March: three of the six.
        await waitFor(() => expect(said()).toEqual(["3 rows", "6 rows"]));
        await settle();
        const first = asked();
        expect(first).toHaveLength(2);
        expect(first.filter((minute) => minute === undefined)).toHaveLength(1);
        expect(sameMinute(first.find((minute) => minute !== undefined)!, at("2026-03-19T00:00:00"))).toBe(true);
        // Later in the same minute: nothing asked again.
        await act(async () => { pin!(at("2026-03-19T00:00:59")); });
        await settle();
        expect([asked(), said()]).toEqual([first, ["3 rows", "6 rows"]]);
        // The next minute, its call held on its way to e3: 5 March has left the last 14 days, and until the new answer
        // lands the tile draws what it drew; the tile that reads no .now draws nothing again.
        const drawn = draws.get("all");
        const call = h.e3.hold((request) => request.kind === "one-shot");
        await act(async () => { pin!(at("2026-03-19T00:01:05")); });
        await call.holding;
        expect(said()).toEqual(["3 rows", "6 rows"]);
        await act(async () => { call.release(); });
        await waitFor(() => expect(said()).toEqual(["2 rows", "6 rows"]));
        await settle();
        const all = asked();
        expect(all).toHaveLength(3);
        expect(sameMinute(all[2]!, at("2026-03-19T00:01:00"))).toBe(true);
        expect(draws.get("all")).toBe(drawn);
    });
});
