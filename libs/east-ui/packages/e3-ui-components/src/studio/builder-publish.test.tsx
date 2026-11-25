/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000), publishing: Save as template (D7,
 * #997); the publish preview (#998), in the canvas's place — its bar (E1), the
 * page (E2), the rail along its foot (E3, E5) — its change list shut or shown
 * by its toggle, Preview opening it shut and Publish shown (ruled 20 November
 * 2026) — every mark in it Font Awesome's (#1263), and its actions (E6); and
 * the conflicts example, a save another session's overtakes. The record and
 * the builders are `builder.test-utils.tsx`'s.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { East, applyFor } from "@elaraai/east";
import { markOf } from "@elaraai/east-ui-components/testing";
import { Studio, StudioPagesType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { conflictCards, act, settle } from "../e3-web-mount.test-utils.js";
import {
    REGIONAL, h, before, mountBuilder, withEntry, templateAt, openPage, readRecord, commits, tile, spanOf, keyOn, press, type Key,
} from "./builder.test-utils.js";

const applyPages = applyFor(StudioPagesType);

describe("<Studio.Builder> — Save as template (#997)", () => {
    const TEMPLATE: Key = { project: "ops", page: "Overview template" };

    /** Open its popover from the toolbar. */
    async function openPopover() {
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save as template" })); });
        await settle();
        return within(screen.getByRole("dialog"));
    }

    test("D7: it names a template — offering the page's title — and saves the open page, as last saved, in one commit", async () => {
        const { container } = await mountBuilder();
        // A draft the canvas has not saved is not what it saves.
        await keyOn(container, "c-trend", { key: "]" });
        const popover = await openPopover();
        // The design system's edit popover, hanging from the button: its head names the page it saves.
        expect(screen.getByRole("button", { name: "Save as template" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
        expect(popover.getByText("Save as template ·").textContent).toBe("Save as template · Overview");
        expect((popover.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("Overview template");
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(["patch", ...before]);
        const template = (await readRecord()).get(TEMPLATE)!;
        if (template.kind.type !== "template") throw new Error("expected a template");
        expect(template.title).toBe("Overview template");
        expect(template.draft.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 8n]]);
        // The page's draft is still the canvas's to save.
        expect(spanOf(container, "c-trend")).toBe("9");
    });

    test("D7: a name the project holds is the field's error, an empty one asks for a name, and nothing is written", async () => {
        await mountBuilder();
        const popover = await openPopover();
        const name = popover.getByRole("textbox", { name: "Template name" });
        await act(async () => { fireEvent.change(name, { target: { value: "b-weekly" } }); });
        expect(popover.getByText("b-weekly is already a page or a template here.")).toBeTruthy();
        expect(name.getAttribute("aria-invalid")).toBe("true");
        expect((popover.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.change(name, { target: { value: " " } }); });
        expect(popover.getByText("Give the template a name to save it.")).toBeTruthy();
        expect((popover.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Cancel" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(before);
    });

    test("D7: a name another write took first is refused in the popover, in its words, and the other write stands", async () => {
        await mountBuilder();
        const popover = await openPopover();
        // Another operator saves a template under the same name between this popover's read and its commit.
        await h.race(ex.studioPages, () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); },
            withEntry(TEMPLATE, templateAt(TEMPLATE, { title: "Theirs", cells: [], filters: [] })));
        expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Another write took the name Overview template first — choose another");
        const template = (await readRecord()).get(TEMPLATE)!;
        if (template.kind.type !== "template") throw new Error("expected a template");
        expect(template.title).toBe("Theirs");
        expect(await commits()).toEqual(["patch", ...before]);
    });

    test("D7: while a template is open it is disabled, and says why", async () => {
        await mountBuilder();
        expect((screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement).disabled).toBe(false);
        await openPage("e-starter");
        const button = screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("A template is open — open a page to save it as a template");
    });
});

describe("<Studio.Builder> — the publish preview (#998)", () => {
    /** The preview. */
    const preview = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-studio-publish]")!;
    /** An element of the preview, by its data attribute. */
    const part = (c: HTMLElement, name: string) => preview(c).querySelector<HTMLElement>(`[data-publish-${name}]`);
    /** The change list's rows: each one's sign — the Font Awesome icon it draws (#1263) — its words and its detail. */
    const rows = (c: HTMLElement) => [...preview(c).querySelectorAll("[data-publish-change]")]
        .map((row) => [...row.children].flatMap((el) => (el.children.length > 0 && el.tagName === "DIV" ? [...el.children] : [el]))
            .map((el) => (el.hasAttribute("data-sign") ? markOf(el) : el.textContent)));
    /** The footer's buttons. */
    const saveButton = (c: HTMLElement) => part(c, "save") as HTMLButtonElement;
    const publishButton = (c: HTMLElement) => part(c, "publish") as HTMLButtonElement;

    /** Open a page and its publish preview, from the toolbar's Preview. */
    async function previewPage(page: string) {
        await openPage(page);
        await press("Preview");
    }

    test("E1: headerless — its bar first: ● Preview, Desktop · Tablet · Mobile, the Env pill and Exit, which returns to the canvas", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const bar = part(container, "bar")!;
        expect(preview(container).firstElementChild).toBe(bar);
        expect(bar.firstElementChild!.textContent).toBe("Preview");
        const devices = [...part(container, "devices")!.querySelectorAll("button")];
        expect(devices.map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"], ["Mobile", "false"]]);
        expect(part(container, "env")!.textContent).toBe("Env ·Staging");
        expect(part(container, "env")!.querySelector("svg[data-icon=chevron-down]")).not.toBeNull();
        await act(async () => { fireEvent.click(part(container, "exit")!); });
        await settle();
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        expect(container.querySelector<HTMLElement>("[data-studio-canvas]")!.hidden).toBe(false);
    });

    test("E2: the page as it will publish — its project, its title, and its layout at the device's width, unscaled where there is no room to measure", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const frame = () => part(container, "frame")!;
        // The page's head sits in the frame with it.
        expect(frame().firstElementChild!.textContent).toBe("opsRegional");
        expect(frame().querySelector("h2")!.textContent).toBe("Regional");
        // A test's DOM lays nothing out, so the room is never measured and the page never scaled; a browser's is
        // `studio-builder.spec.ts`'s E2.
        expect([frame().style.width, frame().style.zoom]).toEqual(["1440px", ""]);
        expect([...frame().querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getAttribute("data-snap-grid-cell")))
            .toEqual(["p-kpi", "p-trend", "p-bars"]);
        await act(async () => { fireEvent.click(part(container, 'device="tablet"')!); });
        expect(frame().style.width).toBe("1024px");
        await act(async () => { fireEvent.click(part(container, 'device="mobile"')!); });
        expect(frame().style.width).toBe("390px");
        expect(frame().getAttribute("data-publish-frame")).toBe("mobile");
        expect(part(container, 'device="mobile"')!.getAttribute("aria-pressed")).toBe("true");
        // The builder's canvas keeps its own width.
        expect(container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1440px");
    });

    test("#1759: the page is named by its layout's title, the one its publish lists it under: the preview's heading and the published entry's title are one, whatever a writer of the solution's own left the entry's title at", async () => {
        const { container } = await mountBuilder();
        // Another writer's entry: its title no longer its layout's, as no write of the builder's leaves one.
        const key = { project: "ops", page: "f-regional" };
        const entry = (await readRecord()).get(key)!;
        expect([entry.title, entry.draft.title]).toEqual(["Regional", "Regional"]);
        await h.patch(ex.studioPages, withEntry(key, { ...entry, title: "Regional, as listed" })(await readRecord()));
        await previewPage("f-regional");
        expect([part(container, "frame")!.querySelector("h2")!.textContent, part(container, "versions")!.textContent]).toEqual(["Regional", "Regional · v3 → v4"]);
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        // Published under the title the preview named it by.
        const published = (await readRecord()).get(key)!;
        expect([published.title, published.draft.title, part(container, "versions")!.textContent]).toEqual(["Regional", "Regional", "Regional · v4 live"]);
    });

    test("E3, E5: ready to publish — the version it replaces and the next, the changes since, and who sees it when", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Regional · v3 → v4");
        expect(part(container, "versions")!.lastElementChild!.textContent).toBe("v4");
        expect(part(container, "count")!.textContent).toBe("2 changes since v3");
        expect(rows(container)).toEqual([
            ["fas plus-minus", "Resized Revenue trend", "span 12 → 8"],
            ["fas plus", "Added Breakdown bars", "row 2 · span 4"],
        ]);
        expect(part(container, "facts")!.textContent).toBe("AudienceField ops · 24 usersRolloutImmediate");
        expect(publishButton(container).textContent).toBe("Publish v4 to Staging");
        expect(publishButton(container).disabled).toBe(false);
        // Nothing unsaved: there is no draft to save.
        expect(saveButton(container).disabled).toBe(true);
    });

    test("E3: the rail — Preview opens it on the page, its change list shut under the toggle that names it; the toggle shows the list and shuts it; Publish opens it on what changed", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const toggle = () => part(container, "toggle")!;
        const list = () => part(container, "changes")!;
        expect([markOf(toggle()), toggle().getAttribute("aria-expanded"), toggle().getAttribute("aria-controls") === list().id, list().hidden])
            .toEqual(["fas chevron-up 2 changes since v3", "false", true, true]);
        await act(async () => { fireEvent.click(toggle()); });
        expect([markOf(toggle()), toggle().getAttribute("aria-expanded"), list().hidden]).toEqual(["fas chevron-down 2 changes since v3", "true", false]);
        await act(async () => { fireEvent.click(toggle()); });
        expect([toggle().getAttribute("aria-expanded"), list().hidden]).toEqual(["false", true]);
        // Back on the canvas, Publish opens it on what changed: the list shown.
        await act(async () => { fireEvent.click(part(container, "exit")!); });
        await settle();
        await press("Publish");
        expect([toggle().getAttribute("aria-expanded"), list().hidden]).toEqual(["true", false]);
    });

    test("E3: a page never published is its first version — every placement added", async () => {
        const { container } = await mountBuilder();
        await previewPage("a-overview");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Overview · v1");
        expect(part(container, "count")!.textContent).toBe("2 changes · first version");
        expect(rows(container)).toEqual([["fas plus", "Added KPI rail", "row 1 · span 12"], ["fas plus", "Added Revenue trend", "row 2 · span 8"]]);
        expect(publishButton(container).textContent).toBe("Publish v1 to Staging");
    });

    test("E3: a placement the draft removes since the live version is signed with Font Awesome's minus (#1263)", async () => {
        const { container } = await mountBuilder();
        await openPage("f-regional");
        await keyOn(container, "p-kpi", { key: "Delete" });
        await press("Preview");
        // The changes in the draft's order, then what it removed.
        expect(rows(container).map((row) => row.slice(0, 2))).toEqual([
            ["fas plus-minus", "Resized Revenue trend"],
            ["fas plus", "Added Breakdown bars"],
            ["fas minus", "Removed KPI rail"],
        ]);
    });

    test("E3: a page live as it stands is up to date — nothing to publish", async () => {
        const { container } = await mountBuilder();
        await previewPage("b-weekly");
        expect(part(container, "head")!.textContent).toBe("Up to date");
        expect(part(container, "versions")!.textContent).toBe("Weekly · v1 live");
        expect(part(container, "count")!.textContent).toBe("No changes since v1");
        // Nothing to list: the count is words, no toggle.
        expect([part(container, "changes"), part(container, "toggle")]).toEqual([null, null]);
        expect(publishButton(container).disabled).toBe(true);
        expect(saveButton(container).disabled).toBe(true);
    });

    test("E3: a template is not published — no change list", async () => {
        const { container } = await mountBuilder();
        await previewPage("e-starter");
        expect(part(container, "head")!.textContent).toBe("Templates are not published");
        expect(part(container, "versions")!.textContent).toBe("Starter · template");
        expect([part(container, "count"), part(container, "toggle")]).toEqual([null, null]);
        expect(publishButton(container).textContent).toBe("Publish");
        expect(publishButton(container).disabled).toBe(true);
    });

    test("E6: Publish is one commit — the draft the next live version — and the page is up to date", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", ...before]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.kind.type !== "page" || regional.live.type !== "some") throw new Error("expected a published page");
        expect(regional.live.value.version).toBe(4n);
        expect(regional.live.value.page).toEqual(regional.draft);
        expect(part(container, "versions")!.textContent).toBe("Regional · v4 live");
    });

    test("E6: with drafts on the canvas, the page shown is the drafted one; Publish saves them first — the canvas's own commit — then publishes them", async () => {
        const { container } = await mountBuilder();
        await openPage("f-regional");
        await keyOn(container, "p-trend", { key: "[" });
        await press("Preview");
        // The preview shows what will publish: the trend at 7, unsaved.
        expect(rows(container)[0]).toEqual(["fas plus-minus", "Resized Revenue trend", "span 12 → 7"]);
        expect(saveButton(container).disabled).toBe(false);
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", "patch", ...before]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.kind.type !== "page" || regional.live.type !== "some") throw new Error("expected a published page");
        expect(regional.live.value.version).toBe(4n);
        expect(regional.live.value.page.cells.map((c) => [c.key, c.span])).toEqual([["p-kpi", 12n], ["p-trend", 7n], ["p-bars", 4n]]);
        expect(saveButton(container).disabled).toBe(true);
    });

    test("E6: Save as draft is the canvas's Save alone — one commit to the draft, nothing published", async () => {
        const { container } = await mountBuilder();
        await openPage("f-regional");
        await keyOn(container, "p-trend", { key: "[" });
        await press("Preview");
        await act(async () => { fireEvent.click(saveButton(container)); });
        await settle();
        await waitFor(() => expect(saveButton(container).disabled).toBe(true));
        expect(await commits()).toEqual(["patch", ...before]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.kind.type !== "page" || regional.live.type !== "some") throw new Error("expected a page");
        expect(regional.draft.cells.find((c) => c.key === "p-trend")!.span).toBe(7n);
        expect(regional.live.value.version).toBe(3n);
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
    });

    test("E6: a publish another overtook is refused above the footer, in the preview's words — and the other stands", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        // Another operator publishes between this publish's read and its commit.
        const publish = East.compile(Studio.publish, []);
        await h.race(ex.studioPages, () => { fireEvent.click(publishButton(container)); }, (now) => applyPages(now, publish(now, REGIONAL)));
        await waitFor(() => expect(part(container, "refused")).not.toBeNull());
        expect(part(container, "refused")!.getAttribute("role")).toBe("alert");
        expect(part(container, "refused")!.textContent).toBe("Another write changed this page first — review it and publish again");
        expect(await commits()).toEqual(["patch", ...before]);
    });
});

describe("the conflicts example (studioConflicts)", () => {
    test("a tile narrowed here, then Someone else saves, is one conflict named by the tile's title, the tile wearing the ring until it is chosen", async () => {
        const { container } = await h.mount(ex.studioConflicts, { storageKey: "studio-conflicts" });
        await settle();
        await waitFor(() => expect(container.querySelector('[data-snap-grid-tile="a-orders"]')).not.toBeNull());
        // Two columns narrower, 6: someone else's save makes it 7, a column narrower.
        await keyOn(container, "a-orders", { key: "[" });
        await keyOn(container, "a-orders", { key: "[" });
        await act(async () => { fireEvent.click(within(container).getByRole("button", { name: "Someone else saves" })); });
        await settle();
        const [card, ...more] = await conflictCards(container);
        expect(more).toEqual([]);
        expect(card!.item).toBe("Orders by week");
        expect(tile(container, "a-orders").hasAttribute("data-conflict")).toBe(true);
        await act(async () => { fireEvent.click(card!.radio("source")); });
        await settle();
        expect(tile(container, "a-orders").hasAttribute("data-conflict")).toBe(false);
    });
});
