/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A page's alerts (#1674), on e3 itself: the tile tests' three orders
 * (`tile.test-utils.tsx`) on a page of their own, and the Studio examples'
 * alerts record (`alerts.examples.tsx`) bound as a surface binds it, set to
 * each test's own before it mounts. A visual's bell starts a new alert under
 * the visual's goal, shows the rows that meet it now and saves it as one
 * patch, which the page's check then fires; the check of alerts set before the
 * page opened writes a firing once; a delete another session's edit overtakes
 * is refused, naming the alert; an alert whose last condition is removed in
 * its rows holds none, so its editor says one is needed and Save waits (ruled
 * 22 November 2026); and the bell for a host's bar opens a firing alert's page
 * with its filters, under a banner naming it.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
    ArrayType, East, FloatType, NullType, SortedMap, StringType, StructType, compareFor, decodeBeast2, decodeBeast2For, encodeBeast2For, none, printJq, some,
    variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Record, Studio, StudioFiltersType, studioAlertOpenedKey, studioFiltersKey, type StudioPagesType } from "@elaraai/e3-ui/internal";
import * as alertsExamples from "@elaraai/e3-ui/examples/studio/alerts";
import * as studio from "@elaraai/e3-ui/examples/studio/studio";
import * as tiles from "@elaraai/e3-ui/examples/studio/tiles";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { condition } from "../query/visual/visual.test-utils.js";
import type { Alert, Alerts } from "./alerts.js";
import { PAGE, cell, sized } from "./tile.test-utils.js";
// The page and the bar's bell are extensions: their renderers register as they load.
import "./page.js";
import "./alert-bell.js";

const h = e3Harness({ "studio/studio": studio, "studio/tiles": tiles, "studio/alerts": alertsExamples }, { measure: false });

const v = Studio.visual;

/** Revenue by region over the tile tests' orders — South Australia's 160, New South Wales' 50 — against a goal of 80. */
const REGIONS = v.of("orders", v.column({ x: v.group("region"), values: [v.sum("revenue", { goal: 80 })] }));
const CELLS = [cell("c-regions", REGIONS)];

/** The tiles' page, live as it is drafted. */
const PAGES: ValueTypeOf<typeof StudioPagesType> = new SortedMap([
    [PAGE, variant("page", { draft: { title: "Orders", cells: CELLS, filters: [] }, live: some({ version: 1n, page: { title: "Orders", cells: CELLS, filters: [] } }) })],
], compareFor(Studio.Types.Key));

/** Where the surface notes the page an alert opened from the bar asks for. */
const ASKED = "alerts-test.asked";

/**
 * The tiles' page with its alerts, as a surface mounts it: the alerts record
 * bound, the bell for the bar over the page, and the page an alert opens noted.
 */
const alertsPage = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const orders = $.let(Data.bind(tiles.tileTestOrders));
        const alerts = $.let(Record.bind(alertsExamples.studioAlerts));
        const asked = $.let(State.bind([Studio.Types.Key], ASKED, { project: "", page: "" }));
        const note = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(asked.write(key)); }));
        return Stack.VStack([
            Studio.AlertBell({ alerts, onOpen: note }),
            Studio.Page({
                pages: PAGES, components: [], page: PAGE, alerts,
                sources: { orders: Studio.source(orders, { name: "Orders", icon: "receipt", range: "ordered_at" }) },
            }),
        ]);
    }))),
};

/** An alert on the regions, its condition the given jq, made with no filter. */
const alertOn = (where: string, over: Partial<Alert> = {}): Alert =>
    ({ page: PAGE, cell: "c-regions", condition: condition(where), filters: [], paused: false, firing: none, ...over });

/** Sets the alerts record to the test's own, as another session's write would, and mounts the page over it. */
async function mountWith(alerts: Alerts) {
    await h.patch(alertsExamples.studioAlerts, alerts);
    return h.mount(alertsPage, { storageKey: "alerts-test" });
}

/** The alerts record as e3 holds it now. */
const readAlerts = () => h.read(alertsExamples.studioAlerts);

/** How many commits the alerts record holds. */
const commitCount = async () => (await h.history(alertsExamples.studioAlerts)).commits.length;

/** The visual's bell. */
const visualBell = () => document.querySelector<HTMLElement>("[data-studio-alert-bell]")!;

/** Presses a control, and lets what it sets off settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** An alert's firing, once a check has written one. */
function firingOf(alert: Alert | undefined) {
    if (alert?.firing.type !== "some") throw new Error("the alert has not fired");
    return alert.firing.value;
}

describe("a page's alerts (#1674)", () => {
    test("a visual's bell sets an alert: it starts under the visual's goal, Now shows the rows that meet it, Save writes it as one patch — and the page's check fires it", async () => {
        await mountWith(new Map());
        await waitFor(() => expect(visualBell()).not.toBeNull());
        expect(visualBell().getAttribute("aria-label")).toBe("Alerts · Revenue by region");
        expect(visualBell().hasAttribute("data-firing")).toBe(false);
        await press(visualBell());
        // A visual with no alert opens on a new one: named after the visual, its condition under the value's goal.
        const name = await screen.findByRole("textbox", { name: "Alert name" }) as HTMLInputElement;
        expect(name.value).toBe("Revenue by region alert");
        // Now: the rows under the goal of 80 — New South Wales' 50 — of the two regions.
        await waitFor(() => expect(document.querySelector("[data-studio-alert-now]")?.textContent).toContain("1 of 2 rows meets it now"));
        const save = document.querySelector<HTMLButtonElement>("[data-studio-alert-save]")!;
        expect(save.disabled).toBe(false);
        await press(save);
        await waitFor(async () => expect((await readAlerts()).size).toBe(1), { timeout: 10_000 });
        const saved = (await readAlerts()).get("Revenue by region alert")!;
        expect([saved.cell, saved.page, printJq(saved.condition).text, saved.filters, saved.paused]).toEqual(["c-regions", PAGE, ".revenue < 80", [], false]);
        // The page's check finds New South Wales under the line, and writes the alert's firing: its one row.
        await h.poll();
        await waitFor(async () => expect((await readAlerts()).get("Revenue by region alert")!.firing.type).toBe("some"), { timeout: 10_000 });
        const fired = firingOf((await readAlerts()).get("Revenue by region alert"));
        expect([fired.count, decodeBeast2(fired.rows).value, fired.cleared]).toEqual([1n, [{ region: "NSW", revenue: 50 }], none]);
        await h.poll();
        await waitFor(() => expect(visualBell().hasAttribute("data-firing")).toBe(true), { timeout: 10_000 });
    });

    test("an open page checks its project's alerts: one its visual's rows meet fires, written once — its bell marked, the bar counting it — and one they do not stays as it was", async () => {
        await h.patch(alertsExamples.studioAlerts, new Map([["Region over 100", alertOn(".revenue > 100")], ["Region over 1000", alertOn(".revenue > 1000")]]));
        const seeded = await commitCount();
        await h.mount(alertsPage, { storageKey: "alerts-test" });
        await waitFor(async () => expect(await commitCount()).toBe(seeded + 1), { timeout: 10_000 });
        const alerts = await readAlerts();
        const fired = firingOf(alerts.get("Region over 100"));
        expect([fired.count, decodeBeast2(fired.rows).value, fired.cleared]).toEqual([1n, [{ region: "SA", revenue: 160 }], none]);
        expect(alerts.get("Region over 1000")!.firing).toEqual(none);
        // Polled again, its rows still meet it: nothing more is written.
        await h.poll();
        await h.poll();
        expect(await commitCount()).toBe(seeded + 1);
        await waitFor(() => expect(visualBell().hasAttribute("data-firing")).toBe(true), { timeout: 10_000 });
        const bar = document.querySelector<HTMLElement>("[data-studio-alert-bar]")!;
        expect([bar.getAttribute("aria-label"), bar.textContent]).toEqual(["Alerts · 1 alert firing", "1"]);
        // The visual's bell lists both, each by where it stands.
        await press(visualBell());
        const list = await waitFor(() => {
            const found = document.querySelector<HTMLElement>("[data-studio-alerts]");
            if (found === null) throw new Error("the bell lists no alert");
            return found;
        });
        const status = (name: string) => list.querySelector(`[data-studio-alert="${name}"] [data-status]`);
        expect([status("Region over 100")?.getAttribute("data-status"), status("Region over 1000")?.getAttribute("data-status")]).toEqual(["firing", "watching"]);
        expect(status("Region over 1000")?.textContent).toBe("Watching");
        expect(status("Region over 100")?.textContent).toMatch(/^Firing since /);
    });

    test("a delete another session's edit overtakes is refused, naming the alert, and their edit stands", async () => {
        await mountWith(new Map([["Region over 1000", alertOn(".revenue > 1000")]]));
        await waitFor(() => expect(visualBell()).not.toBeNull());
        await press(visualBell());
        await press(await waitFor(() => {
            const row = document.querySelector<HTMLElement>('[data-studio-alert="Region over 1000"]');
            if (row === null) throw new Error("the bell lists no alert");
            return row;
        }));
        await press(document.querySelector<HTMLElement>("[data-studio-alert-delete]")!);
        expect(document.querySelector("[data-studio-alert-confirm]")?.textContent).toBe("Delete Region over 1000?");
        const confirm = document.querySelector<HTMLElement>("[data-studio-alert-delete-confirmed]")!;
        // Another session pauses the alert while the delete is on its way.
        await h.race(alertsExamples.studioAlerts, () => { fireEvent.click(confirm); },
            (now) => new Map([...now].map(([name, alert]) => [name, { ...alert, paused: true }])));
        await waitFor(() => expect(document.querySelector("[data-studio-alert-refused]")?.textContent).toMatch(/^Region over 1000: /), { timeout: 10_000 });
        const kept = (await readAlerts()).get("Region over 1000");
        expect(kept?.paused).toBe(true);
    });

    test("an alert's last condition removed in its rows: it holds none, so its editor says one is needed and Save waits — nothing is written", async () => {
        await mountWith(new Map([["Region over 1000", alertOn(".revenue > 1000")]]));
        const seeded = await commitCount();
        await waitFor(() => expect(visualBell()).not.toBeNull());
        await press(visualBell());
        await press(await waitFor(() => {
            const row = document.querySelector<HTMLElement>('[data-studio-alert="Region over 1000"]');
            if (row === null) throw new Error("the bell lists no alert");
            return row;
        }));
        const editor = await waitFor(() => {
            const found = document.querySelector<HTMLElement>("[data-studio-alert-editor] [data-studio-filter-rows]");
            if (found === null) throw new Error("the alert's editor draws no rows");
            return found;
        });
        const save = () => document.querySelector<HTMLButtonElement>("[data-studio-alert-save]")!;
        const needed = () => screen.queryByText("Finish the condition to save the alert.") !== null;
        expect([save().disabled, needed()]).toEqual([false, false]);
        await press(within(editor).getByRole("button", { name: "Remove" }));
        expect([[...editor.querySelectorAll("[data-query-line=row]")].length, save().disabled, needed()]).toEqual([0, true, true]);
        expect(await commitCount()).toBe(seeded);
    });

    test("the bar's bell lists a firing alert, and opening it sets its page's filters to the alert's, tells the host the page, and draws the banner — whose Show rows gives the rows that met it, and whose Dismiss puts it away", async () => {
        await sized(async () => {
            const rows = encodeBeast2For(ArrayType(StructType({ region: StringType, revenue: FloatType })))([{ region: "SA", revenue: 160 }]);
            const southAustralia = { source: "orders", where: condition(`.region == "SA"`), from: none };
            await mountWith(new Map([["Region over 100", alertOn(".revenue > 100", {
                filters: [southAustralia],
                firing: some({ at: new Date("2026-11-20T09:00:00Z"), count: 1n, rows, cleared: none }),
            })]]));
            const bar = await waitFor(() => {
                const found = document.querySelector<HTMLElement>("[data-studio-alert-bar]");
                if (found === null) throw new Error("no bar bell");
                return found;
            });
            expect(bar.hasAttribute("data-firing")).toBe(true);
            await press(bar);
            const listed = await waitFor(() => {
                const found = document.querySelector<HTMLElement>("[data-studio-alerts-firing]");
                if (found === null) throw new Error("the bar lists no alert");
                return found;
            });
            const line = listed.querySelector<HTMLElement>('[data-studio-alert="Region over 100"]')!;
            expect(within(line).getByText("Region over 100")).toBeTruthy();
            expect(line.querySelector("[data-status]")?.textContent).toMatch(/^Orders · fired /);
            await press(line);
            // The page's filters are the alert's, as its reader's; the host is told the page.
            const filters = StateRuntime.getStore().read(studioFiltersKey(PAGE));
            expect(filters === undefined ? undefined : decodeBeast2For(StudioFiltersType)(filters).map((filter) => [filter.source, printJq(filter.where).text]))
                .toEqual([["orders", `.region == "SA"`]]);
            const asked = StateRuntime.getStore().read(ASKED);
            expect(asked === undefined ? undefined : decodeBeast2For(Studio.Types.Key)(asked)).toEqual(PAGE);
            // The banner names the alert, when it fired and how many rows met it.
            await waitFor(() => expect(screen.getByText(/^Region over 100 fired at /)).toBeTruthy());
            expect(screen.getByText("1 row met it")).toBeTruthy();
            await press(screen.getByRole("button", { name: "Show rows" }));
            const shown = await waitFor(() => {
                const found = document.querySelector<HTMLElement>("[data-studio-alert-fired-rows]");
                if (found === null) throw new Error("Show rows shows nothing");
                return found;
            });
            await waitFor(() => expect(shown.textContent).toContain("SA"));
            expect(shown.textContent).toContain("160");
            await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
            await settle();
            await press(screen.getByRole("button", { name: "Dismiss" }));
            expect(screen.queryByText(/^Region over 100 fired at /)).toBeNull();
            expect(StateRuntime.getStore().read(studioAlertOpenedKey(PAGE))).toBeUndefined();
        });
    });
});
