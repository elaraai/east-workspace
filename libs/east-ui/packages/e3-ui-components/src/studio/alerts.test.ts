/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio page's alerts (#1674), and their rules: where an alert stands —
 * due, paused, its visual removed from its page's live version, its source not
 * listed — a project's alerts, the program a check asks, asked in memory over
 * the visual tests' orders, what it found, and the batch its firing writes,
 * laid on the record as e3-ui's `saveAlerts` writes it.
 */

import { describe, expect, it } from "vitest";
import { East, SortedMap, applyFor, compareFor, decodeBeast2, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { StudioAlertsType, alertFiring, saveAlerts, type StudioPagesType } from "@elaraai/e3-ui/internal";
import { printAlert } from "../query/visual/alert.js";
import { LISTED_ORDERS, ORDERS_SOURCE, QUARTER_NOW, asked, condition } from "../query/visual/visual.test-utils.js";
import { printStateOf } from "../query/visual/filters.js";
import {
    alertChanges, alertFound, alertNameRefusal, alertStanding, checkOf, firingChanges, isFiring, placementAlerts, projectAlerts, type Alert, type Alerts,
} from "./alerts.js";

type Pages = ValueTypeOf<typeof StudioPagesType>;

const v = Studio.visual;
const step = East.compile(alertFiring, []);
const save = East.compileAsync(saveAlerts, []);
const applyAlerts = applyFor(StudioAlertsType);

/** The quarter's filter, as an alert holds it: what the page's reader had as it was made. */
const QUARTER_FILTER = { source: "orders", where: condition(`.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`), from: none };

/** Revenue by region, a column chart on the Sales desk's Overview. */
const REGIONS = v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue")] }));
const OVERVIEW = { project: "Sales desk", page: "Overview" };

/** The pages: the Overview live, holding the chart under `c-regions`, its draft holding one more the live version does not. */
const PAGES: Pages = new SortedMap([
    [OVERVIEW, variant("page", {
        draft: {
            title: "Overview", filters: [],
            cells: [
                { key: "c-regions", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: REGIONS },
                { key: "c-new", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: REGIONS },
            ],
        },
        live: some({ version: 1n, page: { title: "Overview", filters: [], cells: [{ key: "c-regions", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: REGIONS }] } }),
    })],
], compareFor(Studio.Types.Key));

/** An alert on the chart: a region over 60, in the quarter. */
const OVER: Alert = { page: OVERVIEW, cell: "c-regions", condition: condition(".revenue > 60"), filters: [QUARTER_FILTER], paused: false, firing: none };

const SOURCES = new Map([[LISTED_ORDERS.key, LISTED_ORDERS]]);

describe("alertStanding (#1674)", () => {
    it("is due on a visual of its page's live version, over a listed source", () => {
        const standing = alertStanding(OVER, PAGES, SOURCES);
        expect(standing.kind).toBe("due");
        if (standing.kind === "due") expect(standing.read).toEqual(ORDERS_SOURCE);
    });

    it("says its visual is removed — a placement only the draft holds, or none at all — before it says it is paused", () => {
        expect(alertStanding({ ...OVER, cell: "c-new" }, PAGES, SOURCES).kind).toBe("removed");
        expect(alertStanding({ ...OVER, cell: "c-gone", paused: true }, PAGES, SOURCES).kind).toBe("removed");
        expect(alertStanding({ ...OVER, page: { project: "Sales desk", page: "Gone" } }, PAGES, SOURCES).kind).toBe("removed");
    });

    it("is paused, unchecked, where its author paused it; and unlisted where the surface lists no source of its visual", () => {
        expect(alertStanding({ ...OVER, paused: true }, PAGES, SOURCES).kind).toBe("paused");
        expect(alertStanding(OVER, PAGES, new Map()).kind).toBe("unlisted");
    });

    it("of a project's alerts, holds those on its pages alone", () => {
        const alerts: Alerts = new Map([
            ["Region over 60", OVER],
            ["Elsewhere", { ...OVER, page: { project: "Ops", page: "Overview" } }],
        ]);
        expect(projectAlerts(alerts, "Sales desk", PAGES, SOURCES).map((held) => [held.name, held.standing.kind])).toEqual([["Region over 60", "due"]]);
    });
});

describe("an alert's check (#1674)", () => {
    it("asks its visual's program with its filters in place of a reader's, and finds the rows that meet it", async () => {
        const standing = alertStanding(OVER, PAGES, SOURCES);
        if (standing.kind !== "due") throw new Error(standing.kind);
        const printed = checkOf(standing, OVER, QUARTER_NOW);
        if (printed.kind !== "ask") throw new Error(printed.kind);
        // The alert's own filters, as the visual's printer narrows by a page's.
        const visual = REGIONS.type === "visual" ? REGIONS.value : undefined;
        const direct = printAlert(visual!, ORDERS_SOURCE, printStateOf([QUARTER_FILTER], "orders", ORDERS_SOURCE, QUARTER_NOW), OVER.condition);
        expect(direct.kind === "ask" ? direct.ask.program : undefined).toBe(printed.ask.program);
        const answer = await asked(printed.ask.program);
        if (answer.kind !== "answered") throw new Error(answer.kind);
        const found = alertFound(answer);
        expect(found.count).toBe(1n);
        expect(decodeBeast2(found.rows).value).toEqual([{ region: "SA", revenue: 170 }]);
    });

    it("writes its firing once it fires — one change by its name, from the alert as read — and nothing while it is unchanged", async () => {
        const standing = alertStanding(OVER, PAGES, SOURCES);
        if (standing.kind !== "due") throw new Error(standing.kind);
        const printed = checkOf(standing, OVER, QUARTER_NOW);
        if (printed.kind !== "ask") throw new Error(printed.kind);
        const answer = await asked(printed.ask.program);
        if (answer.kind !== "answered") throw new Error(answer.kind);
        const fired = step(OVER.firing, alertFound(answer), QUARTER_NOW);
        const changes = firingChanges("Region over 60", OVER, fired, "check-1");
        expect(changes?.changes.map((change) => change.id)).toEqual(["Region over 60"]);
        // Saved as a page's check saves it, through a record that lays each patch as e3 does: the alert now fires.
        let record: Alerts = new Map([["Region over 60", OVER]]);
        const handle = {
            read: () => record,
            history: () => none,
            commit: {
                patch: async (_requestId: string, patch: unknown) => {
                    record = applyAlerts(record, patch as never);
                    return variant("committed", { commitHash: "c1", stateHash: "s1" });
                },
            },
        };
        expect((await save(handle, changes!)).type).toBe("applied");
        const written = record.get("Region over 60")!;
        expect(isFiring(written)).toBe(true);
        expect(written.firing.type === "some" ? written.firing.value.at : undefined).toEqual(QUARTER_NOW);
        // Checked again over the same rows, it is unchanged: nothing is written.
        expect(firingChanges("Region over 60", written, step(written.firing, alertFound(answer), QUARTER_NOW), "check-2")).toBeUndefined();
    });
});

describe("an alert's writes (#1674)", () => {
    it("are a batch by each alert's name: a Save's one change, a rename's two — the old name deleted, the new written", () => {
        const saved = alertChanges([{ name: "Region over 60", before: undefined, after: OVER }], "New alert", "save-1");
        expect(saved.changes.map((change) => change.id)).toEqual(["Region over 60"]);
        expect(saved.base).toEqual(variant("snapshot", []));
        const renamed = alertChanges([
            { name: "Region over 60", before: OVER, after: undefined },
            { name: "Big regions", before: undefined, after: OVER },
        ], "Save", "rename-1");
        expect(renamed.changes.map((change) => change.id)).toEqual(["Region over 60", "Big regions"]);
        expect(renamed.base).toEqual(variant("snapshot", [OVER]));
    });

    it("find a visual's alerts by its page and placement, and whether each fires", () => {
        const firing = { ...OVER, firing: some({ at: QUARTER_NOW, count: 1n, rows: new Uint8Array(), cleared: none }) };
        const cleared = { ...OVER, firing: some({ at: QUARTER_NOW, count: 1n, rows: new Uint8Array(), cleared: some(QUARTER_NOW) }) };
        const alerts: Alerts = new Map([["A", firing], ["B", cleared], ["C", { ...OVER, cell: "c-other" }]]);
        expect(placementAlerts(alerts, OVERVIEW, "c-regions").map((held) => [held.name, isFiring(held.alert)])).toEqual([["A", true], ["B", false]]);
    });

    it("refuse a name that is empty, or another alert's — never the alert's own", () => {
        const alerts: Alerts = new Map([["Region over 60", OVER]]);
        expect(alertNameRefusal("", alerts, undefined)).toBe("missing");
        expect(alertNameRefusal("Region over 60", alerts, undefined)).toBe("taken");
        expect(alertNameRefusal("Region over 60", alerts, "Region over 60")).toBeUndefined();
        expect(alertNameRefusal("Big regions", alerts, "Region over 60")).toBeUndefined();
    });
});
