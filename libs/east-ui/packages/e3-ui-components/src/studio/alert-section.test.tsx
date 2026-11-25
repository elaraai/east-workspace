/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * The builder's inspector's Alerts (#1674, asked 22 November 2026), on e3
 * itself: a builder over a page of the tile tests' three orders
 * (`tile.test-utils.tsx`), given the Studio examples' alerts record
 * (`alerts.examples.tsx`) set to each test's own. The selected visual's
 * Configure tab lists its alerts — its own alone — under New alert; a new one
 * is written in place and saved as one patch of the alerts record, none of
 * the page's; one opened is edited in place, Cancel giving the list back and
 * Delete asking first; and a builder given no alerts record draws no section.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, NullType, none, printJq, type ValueTypeOf } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Record, Studio, type StudioPagesType } from "@elaraai/e3-ui/internal";
import * as alertsExamples from "@elaraai/e3-ui/examples/studio/alerts";
import * as studio from "@elaraai/e3-ui/examples/studio/studio";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import type { Alert, Alerts } from "./alerts.js";
import { PAGE, cell } from "./tile.test-utils.js";
// The builder is an extension: its renderer registers as it loads.
import "./builder.js";

const h = e3Harness({ "studio/studio": studio, "studio/tiles": tiles, "studio/alerts": alertsExamples }, { measure: false });

const v = Studio.visual;

/** Revenue by region over the tile tests' orders — South Australia's 160, New South Wales' 50 — against a goal of 80; and the orders counted. */
const REGIONS = v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue", { goal: 80 })] }));
const CELLS = [cell("c-regions", REGIONS), cell("c-orders", v.of("orders", v.kpi({ value: v.count() })))];

/** The builder's pages: the tiles' page alone, live as it is drafted. */
const PAGES: ValueTypeOf<typeof StudioPagesType> = Studio.value([
    { key: PAGE, draft: { title: "Orders", cells: CELLS, filters: [] }, live: { version: 1n, page: { title: "Orders", cells: CELLS, filters: [] } } },
]);

/** Where the surface notes the page its builder asks for. */
const ASKED = "alerts-inspector.asked";

/** A builder over the tiles' page, as a surface mounts it, given the alerts record, bound. */
const alertsBuilder = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(Data.bind(tiles.tileTestOrders));
        const record = $.let(Record.bind(studio.studioPages, ["patch"]));
        const alerts = $.let(Record.bind(alertsExamples.studioAlerts));
        const asked = $.let(State.bind([Studio.Types.Key], ASKED, { project: "", page: "" }));
        const note = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(asked.write(key)); }));
        return Studio.Builder({
            pages: record, components: [], project: PAGE.project, page: PAGE, onOpen: note, alerts,
            sources: { orders: Studio.source(orders, { name: "Orders", icon: "receipt", range: "ordered_at" }) },
        });
    }))),
};

/** The same builder, given no alerts record. */
const bareBuilder = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(Data.bind(tiles.tileTestOrders));
        const record = $.let(Record.bind(studio.studioPages, ["patch"]));
        const asked = $.let(State.bind([Studio.Types.Key], ASKED, { project: "", page: "" }));
        const note = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(asked.write(key)); }));
        return Studio.Builder({
            pages: record, components: [], project: PAGE.project, page: PAGE, onOpen: note,
            sources: { orders: Studio.source(orders, { name: "Orders", icon: "receipt", range: "ordered_at" }) },
        });
    }))),
};

/** An alert on a visual of the page, its condition the given jq, made with no filter. */
const alertOn = (where: string, over: Partial<Alert> = {}): Alert =>
    ({ page: PAGE, cell: "c-regions", condition: condition(where), filters: [], paused: false, firing: none, ...over });

/** Sets the pages and the alerts records to the test's own, and mounts the builder over them with the regions' visual selected. */
async function mountWith(alerts: Alerts | undefined) {
    await h.patch(studio.studioPages, PAGES);
    if (alerts !== undefined) await h.patch(alertsExamples.studioAlerts, alerts);
    const mounted = await h.mount(alerts === undefined ? bareBuilder : alertsBuilder, { storageKey: "alerts-inspector" });
    await act(async () => { fireEvent.click(mounted.container.querySelector<HTMLElement>('[data-snap-grid-tile="c-regions"]')!); });
    await settle();
    return mounted;
}

/** The alerts record as e3 holds it now, and how many commits each record holds. */
const readAlerts = () => h.read(alertsExamples.studioAlerts);
const commitsOf = async (record: typeof alertsExamples.studioAlerts | typeof studio.studioPages) => (await h.history(record)).commits.length;

/** The open Configure tab's Alerts field. */
const section = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-frame-slot="end"] [role=tabpanel]:not([hidden]) [data-configure="alerts"]');
/** The alerts it lists: each one's name, and where it stands. */
const listed = (c: HTMLElement) => [...section(c)!.querySelectorAll("[data-studio-alert]")].map((row) => [row.getAttribute("data-studio-alert"), row.querySelector("[data-status]")?.textContent]);
/** A part of the section, by what marks it. */
const part = (c: HTMLElement, mark: string) => section(c)!.querySelector<HTMLElement>(`[${mark}]`);

/** Presses a control, and lets what it sets off settle. */
async function press(el: Element | null) {
    if (el === null) throw new Error("nothing to press");
    await act(async () => { fireEvent.click(el); });
    await settle();
}

describe("the builder's inspector's Alerts (#1674)", () => {
    test("lists the selected visual's alerts — its own alone, each by its name and where it stands — over New alert and what they are; a builder given no alerts record draws none", async () => {
        const { container, unmount } = await mountWith(new Map([
            ["Region over 100", alertOn(".revenue > 100")],
            ["Region under 60", alertOn(".revenue < 60", { paused: true })],
            // Another visual's, and another page's: no alert of this visual.
            ["Many orders", alertOn(".orders > 2", { cell: "c-orders" })],
            ["Elsewhere", alertOn(".revenue > 100", { page: { project: PAGE.project, page: "Stock" } })],
        ]));
        await waitFor(() => expect(section(container)).not.toBeNull());
        expect(listed(container)).toEqual([["Region over 100", "Watching"], ["Region under 60", "Paused"]]);
        expect([section(container)!.getAttribute("aria-label"), part(container, "data-studio-new-alert")?.textContent, part(container, "data-configure-hint")?.textContent])
            .toEqual(["Alerts", "New alert", "Checked on the published page. An alert is saved as you write it, not with the page."]);
        // After what the visual follows, before its source's fields.
        const parts = [...container.querySelectorAll('[data-frame-slot="end"] [role=tabpanel]:not([hidden]) [data-configure]')].map((el) => el.getAttribute("data-configure"));
        expect(parts.slice(parts.indexOf("follow"))).toEqual(["follow", "alerts", "fields"]);
        // The other visual's: its own one.
        await press(container.querySelector('[data-snap-grid-tile="c-orders"]'));
        await waitFor(() => expect(listed(container)).toEqual([["Many orders", "Watching"]]));
        unmount();
        // No alerts record: no bell on the canvas, and no section.
        const without = await mountWith(undefined);
        await waitFor(() => expect(without.container.querySelector('[data-frame-slot="end"] [data-configure="where"]')).not.toBeNull());
        expect([section(without.container), without.container.querySelector("[data-studio-alert-bell]")]).toEqual([null, null]);
    });

    test("New alert is written in place — named after the visual, its condition under its value's goal, Now the rows that meet it — and Save writes one patch of the alerts record, none of the page's; the list then holds it", async () => {
        const { container } = await mountWith(new Map());
        await waitFor(() => expect(section(container)).not.toBeNull());
        const [alertsWas, pagesWas] = [await commitsOf(alertsExamples.studioAlerts), await commitsOf(studio.studioPages)];
        expect(listed(container)).toEqual([]);
        await press(part(container, "data-studio-new-alert"));
        // Its editor, in the section: its name, and its condition's rows.
        const name = await waitFor(() => {
            const found = part(container, "data-studio-alert-name") as HTMLInputElement | null;
            if (found === null) throw new Error("no editor");
            return found;
        });
        expect([name.value, part(container, "data-studio-filter-rows") !== null, part(container, "data-configure-hint")]).toEqual(["Revenue by region alert", true, null]);
        // Now: the rows under the goal of 80 — New South Wales' 50 — of the two regions.
        await waitFor(() => expect(part(container, "data-studio-alert-now")?.textContent).toContain("1 of 2 rows meets it now"));
        // Its foot, the section's own: Cancel and Save — no Delete for one not saved yet.
        expect([part(container, "data-studio-alert-delete"), (part(container, "data-studio-alert-save") as HTMLButtonElement).disabled]).toEqual([null, false]);
        await press(part(container, "data-studio-alert-save"));
        await waitFor(async () => expect((await readAlerts()).size).toBe(1), { timeout: 10_000 });
        const saved = (await readAlerts()).get("Revenue by region alert")!;
        expect([saved.cell, saved.page, printJq(saved.condition).text, saved.paused]).toEqual(["c-regions", PAGE, ".revenue < 80", false]);
        // One patch of the alerts record; the page's record as it was — its draft holds no alert.
        expect([await commitsOf(alertsExamples.studioAlerts), await commitsOf(studio.studioPages)]).toEqual([alertsWas + 1, pagesWas]);
        await waitFor(() => expect(listed(container)).toEqual([["Revenue by region alert", "Watching"]]));
        expect(part(container, "data-studio-alert-name")).toBeNull();
    });

    test("an alert opened is edited in place: Cancel gives the list back as it was; Delete asks first, then takes it off the record", async () => {
        const { container } = await mountWith(new Map([["Region over 100", alertOn(".revenue > 100")]]));
        await waitFor(() => expect(listed(container)).toEqual([["Region over 100", "Watching"]]));
        await press(part(container, 'data-studio-alert="Region over 100"'));
        await waitFor(() => expect((part(container, "data-studio-alert-name") as HTMLInputElement | null)?.value).toBe("Region over 100"));
        // Cancel: the list, the record untouched.
        const cancel = [...section(container)!.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
        await press(cancel ?? null);
        expect([listed(container), part(container, "data-studio-alert-name")]).toEqual([[["Region over 100", "Watching"]], null]);
        // Delete: asked first, in the section's foot; confirmed, it is gone from the record and the list.
        await press(part(container, 'data-studio-alert="Region over 100"'));
        await press(await waitFor(() => {
            const found = part(container, "data-studio-alert-delete");
            if (found === null) throw new Error("no Delete");
            return found;
        }));
        expect(part(container, "data-studio-alert-confirm")?.textContent).toBe("Delete Region over 100?");
        await press(part(container, "data-studio-alert-delete-confirmed"));
        await waitFor(async () => expect((await readAlerts()).size).toBe(0), { timeout: 10_000 });
        await waitFor(() => expect([listed(container), part(container, "data-studio-new-alert")?.textContent]).toEqual([[], "New alert"]));
    });
});
