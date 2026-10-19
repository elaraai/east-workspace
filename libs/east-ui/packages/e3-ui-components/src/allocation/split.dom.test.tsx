/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Split loads and Find a fit (#1332, `Allocation Spec.md` §9.10, A70–A74) over
 * the kiln yard's Wed 12, its loads split across kilns, through the
 * dispatcher, the shared drag layer and the yard's fit served by name: the
 * card's line and the Partly allocated issue (A70); `Split…`, each part's
 * field, Unlink of one part, the connector and a link's drag, and the Table's
 * part chips with `+ resource` (A71); a link per part, weighted within its
 * family (A72); the fit asked for the quantity placed (A73); and Find a fit,
 * as an issue's fix and a bin's action, in the Library's Resources tab (A74).
 * Every fit is the yard's answer.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { pointAt } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, stubLinkGeometry, WED } from "./harness.test-utils.js";

const h = allocationHarness();
type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
const byScore = compareFor(FloatType);
const details = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>('[data-allocation-inspector="details"]')!;
const issuesTab = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>('[data-allocation-inspector="issues"]')!;
const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-allocation-card="${id}"]`)!;
const connector = (c: HTMLElement, id: string) => card(c, id).querySelector<HTMLElement>("[data-allocation-connector]")!;
const row = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource="${key}"]`)!;
const tableRow = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row="${key}"]`)!;
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
const save = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.apply() });
const text = (el: Element | null | undefined) => el?.textContent ?? null;
const button = (root: HTMLElement, name: string | RegExp) => within(root).getByRole("button", { name });
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
async function open(example: { fn: { toIR(): unknown } } = ex.allocationSplit) { const r = mount(example); await settle(); return r.container; }
async function tab(c: HTMLElement, side: "start" | "end", name: string) { await press(within(slot(c, side)).getAllByRole("tab").find(t => t.textContent!.startsWith(name))); }
async function hover(from: Element, into: Element) {
    expect(from).toBeTruthy(); expect(into).toBeTruthy();
    await act(async () => { pointAt(from); fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 0, clientY: 0 }); pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 10 }); });
    await settle();
    await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 12, clientY: 12 }); });
    await settle();
}
async function over(into: Element, x = 14) { await act(async () => { pointAt(into); fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x, clientY: 12 }); }); await settle(); }
async function release() { await act(async () => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: 14, clientY: 12 }); }); await settle(); }
/** The yard fit's latest answer to placing a bin, with a quantity. */
const answerFor = (bin: string, quantity: number) => [...h.fits.history].reverse().find(a => {
    const ask = (a as FitResult).ask;
    return ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin && ask.value.quantity === quantity;
}) as FitResult | undefined;
/** Every quantity the fit was asked to place a bin with, in turn. */
const placedOf = (bin: string) => h.fits.history.flatMap(a => {
    const ask = (a as FitResult).ask;
    return ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin ? [ask.value.quantity] : [];
});
/** An answer's fits, best first — ties in the resources' order — but those it leaves out. */
const fitsOf = (a: FitResult, except: readonly string[] = []) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && !except.includes(k) ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).map(f => f.k);
const whyOf = (a: FitResult, key: string) => { const f = a.resources.get(key)!; return f.type === "fits" ? `${f.value.why}${f.value.warn.type === "some" ? ` · ${f.value.warn.value}` : ""}` : f.value.reason; };
/** The day's bin as the record holds it. */
const saved = (bin: string) => h.read(ex.kilnPlans).get(WED)!.bins.get(bin)!;
/** A bin's parts as Assigned to lists them: each field's resource — its key, and its label the resource's name — and its quantity. */
const partsShown = (c: HTMLElement) => [...details(c).querySelectorAll<HTMLElement>("[data-allocation-parts] [data-field]")].map(f => {
    expect(f.querySelector("label")?.textContent).toBe(`${f.getAttribute("data-field")}${f.getAttribute("data-field")}`);
    return [f.getAttribute("data-field"), Number(f.querySelector("input")?.value)];
});
const remainder = (c: HTMLElement) => text(details(c).querySelector("[data-allocation-remainder]"));
/** `Split…`'s popover, portaled out of the pane. */
const splitBox = (bin: string) => document.querySelector<HTMLElement>(`[data-allocation-split="${bin}"]`);
const options = (root: HTMLElement, section: string) => [...root.querySelectorAll(`[role=group][aria-label="${section}"] [role=option]`)]
    .map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent);

describe("a split bin on its card and in Issues (A70)", () => {
    test("A70 — the card's second line reads `→ K-601 + 1` with `4 m³ unallocated` in warn after it, its tooltip the whole; a wholly split bin's says only where it is", async () => {
        const c = await open();
        const line = card(c, "3201").querySelector<HTMLElement>("[data-allocation-to]")!;
        expect([line.textContent, text(line.querySelector("[data-allocation-left]"))]).toEqual(["K-601 + 1 · 4 m³ unallocated", "4 m³ unallocated"]);
        expect(card(c, "3201").title).toContain("on K-601 + 1 · 4 m³ unallocated");
        expect([text(card(c, "3202").querySelector("[data-allocation-to]")), card(c, "3202").querySelector("[data-allocation-left]")]).toEqual(["K-107 + 1", null]);
    });

    test("A70 — Issues lists it as Partly allocated, a warning: `LD-2232 · 30 m³`, `4 m³ unallocated · B-1 06:15`; it never blocks Save", async () => {
        const c = await open();
        await tab(c, "end", "Issues");
        const group = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="unallocated"]')!;
        expect([group.firstElementChild!.textContent, group.firstElementChild!.getAttribute("data-tone")]).toEqual(["Partly allocated1", "warning"]);
        const issue = group.querySelector<HTMLElement>("[data-allocation-issue]")!;
        expect([...issue.children].slice(0, 2).map(e => e.textContent)).toEqual(["LD-2232 · 30 m³Show", "4 m³ unallocated · B-1 06:15"]);
        // A draft of another bin Saves with the issue standing.
        await press(card(c, "3202"));
        await press(button(details(c), "One hour later"));
        await press(save(c));
        expect(saved("3202").at).toEqual(new Date("2027-05-12T08:35:00Z"));
        expect([...saved("3201").parts]).toEqual([["K-208", 6], ["K-601", 20]]);
    });
});

describe("splitting (A71, A73)", () => {
    test("A71 — Assigned to: each part's quantity a field, by its resource, and what they leave in warn; `Split…` while some is left", async () => {
        const c = await open();
        await press(card(c, "3201"));
        expect(partsShown(c)).toEqual([["K-208", 6], ["K-601", 20]]);
        expect(remainder(c)).toBe("4 m³ unallocated");
        expect(details(c).querySelector("[data-allocation-split-open]")).not.toBeNull();
        // A wholly split bin: its parts, nothing left, and no `Split…`.
        await press(card(c, "3202"));
        expect([partsShown(c), remainder(c), details(c).querySelector("[data-allocation-split-open]")]).toEqual([[["K-107", 12], ["K-110", 6]], null, null]);
    });

    test("A71, A73 — `Split…` puts the remainder on another resource: the quantity the remainder's, the Chooser the fit's answer for it, the bin's own resources left out; one draft that Saves", async () => {
        const c = await open();
        await press(card(c, "3201"));
        await press(details(c).querySelector("[data-allocation-split-open]"));
        const box = splitBox("3201")!;
        expect(box.closest("[role=dialog]")!.textContent).toContain("Split LD-2232 · 4 m³ unallocated");
        expect(Number((within(box).getByRole("spinbutton") as HTMLInputElement).value)).toBe(4);
        // The question is the remainder's: 4 m³ of the bin placed (A73).
        const answer = answerFor("3201", 4)!;
        expect(answer).toBeDefined();
        const offered = options(box, "Gaps that fit");
        expect(offered).toEqual(fitsOf(answer, ["K-208", "K-601"]));
        expect(offered.some(k => k === "K-208" || k === "K-601")).toBe(false);
        await press(within(box).getByRole("option", { name: new RegExp(offered[0]!) }));
        expect(splitBox("3201")).toBeNull();
        expect([partsShown(c).map(([k]) => k), remainder(c)]).toEqual([[...["K-208", "K-601", offered[0]!].sort()], null]);
        expect(text(card(c, "3201").querySelector("[data-allocation-to]"))).toBe("K-601 + 2");
        await press(save(c));
        expect(saved("3201").parts.get(offered[0]!)).toBe(4);
        await tab(c, "end", "Issues");
        expect(issuesTab(c).querySelector('[data-allocation-issue-group="unallocated"]')).toBeNull();
    });

    test("A71, A73 — a part's field sets what it holds, no more than it and the remainder: 20 → 16 leaves 8; its Clear, or nothing, unlinks it", async () => {
        const c = await open();
        await press(card(c, "3201"));
        const user = userEvent.setup();
        const k601 = within(details(c).querySelector<HTMLElement>('[data-allocation-parts] [data-field="K-601"]')!).getByRole("spinbutton");
        await user.clear(k601);
        for (const k of "16") { await user.type(k601, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        expect([partsShown(c), remainder(c)]).toEqual([[["K-208", 6], ["K-601", 16]], "8 m³ unallocated"]);
        // More than the part and the remainder together is held to them: 24.
        const again = within(details(c).querySelector<HTMLElement>('[data-allocation-parts] [data-field="K-601"]')!).getByRole("spinbutton");
        await user.clear(again);
        for (const k of "99") { await user.type(again, k); await settle(); }
        await user.keyboard("{Enter}");
        await settle();
        expect([partsShown(c), remainder(c)]).toEqual([[["K-208", 6], ["K-601", 24]], null]);
        // Its Clear unlinks K-208: what it held is unallocated again.
        await press(button(details(c), "Unlink LD-2232 from K-208"));
        expect([partsShown(c), remainder(c)]).toEqual([[["K-601", 24]], "6 m³ unallocated"]);
        // Each edit one step: Undo puts K-208 back.
        await press(undo(c));
        expect(partsShown(c)).toEqual([["K-208", 6], ["K-601", 24]]);
        await press(save(c));
        expect([...saved("3201").parts]).toEqual([["K-208", 6], ["K-601", 24]]);
    });

    test("A71, A73 — the connector links the remainder: the fit asked for 4 m³, a drop on a fit puts 4 m³ there", async () => {
        const c = await open();
        await press(card(c, "3201"));
        await hover(connector(c, "3201"), row(c, "K-101"));
        const answer = answerFor("3201", 4)!;
        const best = fitsOf(answer, ["K-601"])[0]!;
        await over(details(c).querySelector<HTMLElement>(`[data-allocation-drop-row="${best}"]`)!);
        await release();
        const held = best === "K-208" ? 10 : 4;
        expect([partsShown(c).find(([k]) => k === best), remainder(c)]).toEqual([[best, held], null]);
        await press(save(c));
        expect(saved("3201").parts.get(best)).toBe(held);
        expect(placedOf("3201")).toContain(4);
    });
});

describe("the Table's parts (A71, A73)", () => {
    /** The Table on Wed 12, its pane scrolled until the split bins' rows are mounted. */
    async function table() {
        const c = await open(ex.allocationTable);
        await key(c, "]");
        const el = c.querySelector<HTMLElement>("[data-allocation-table] [data-virtual-rows]")!;
        for (let top = 0; (c.querySelector('[data-allocation-row="bin:3201"]') === null || c.querySelector('[data-allocation-row="bin:3202"]') === null) && top <= 120 * 36; top += 6 * 36) {
            await act(async () => { el.scrollTop = top; fireEvent.scroll(el); }); await settle();
        }
        expect([tableRow(c, "bin:3201"), tableRow(c, "bin:3202")].every(r => r !== null)).toBe(true);
        return c;
    }
    const chips = (c: HTMLElement, bin: string) => [...tableRow(c, `bin:${bin}`).querySelectorAll<HTMLElement>('[data-allocation-chip="part"]')]
        .map(chip => [chip.getAttribute("data-allocation-part"), text(chip.querySelector("span:first-child")), text(chip.querySelector("span:nth-child(2)"))]);

    test("A71 — a split bin's parts as resource chips with their quantities, largest first, and `+ resource` for its remainder; a wholly split bin has none", async () => {
        const c = await table();
        expect(chips(c, "3201")).toEqual([["K-601", "K-601", "20 m³"], ["K-208", "K-208", "6 m³"]]);
        const plus = tableRow(c, "bin:3201").querySelector<HTMLElement>('[data-allocation-placeholder="remainder"]')!;
        expect([plus.textContent, plus.getAttribute("aria-label")]).toEqual(["resource", "Choose a resource for the 4 m³ unallocated"]);
        expect(chips(c, "3202")).toEqual([["K-107", "K-107", "12 m³"], ["K-110", "K-110", "6 m³"]]);
        expect(tableRow(c, "bin:3202").querySelector('[data-allocation-placeholder="remainder"]')).toBeNull();
    });

    test("A71, A73 — `+ resource` links the remainder, asked for 4 m³, the bin's resources left out; a chip's face moves its part, asked for its own 6 m³; its × unlinks it", async () => {
        const c = await table();
        await press(tableRow(c, "bin:3201").querySelector('[data-allocation-placeholder="remainder"]'));
        const box = document.querySelector<HTMLElement>('[data-allocation-choices="bin:3201|resource:+"]')!;
        const remainderFits = options(box, "Gaps that fit");
        expect(remainderFits).toEqual(fitsOf(answerFor("3201", 4)!, ["K-208", "K-601"]));
        await press(within(box).getByRole("option", { name: new RegExp(remainderFits[0]!) }));
        expect(chips(c, "3201").map(([k, , q]) => [k, q])).toContainEqual([remainderFits[0]!, "4 m³"]);
        expect(tableRow(c, "bin:3201").querySelector('[data-allocation-placeholder="remainder"]')).toBeNull();
        // K-208's face: its own part, 6 m³, onto another resource.
        await press(button(tableRow(c, "bin:3201"), "Move the 6 m³ on K-208 to another resource"));
        const moving = document.querySelector<HTMLElement>('[data-allocation-choices="bin:3201|resource:K-208"]')!;
        expect(options(moving, "Current")).toEqual(["K-208"]);
        expect(placedOf("3201")).toContain(6);
        const to = options(moving, "Gaps that fit").find(k => k !== remainderFits[0] && k !== "K-601")!;
        await press(within(moving).getByRole("option", { name: new RegExp(to) }));
        expect(chips(c, "3201").map(([k, , q]) => [k, q])).toContainEqual([to, "6 m³"]);
        expect(chips(c, "3201").some(([k]) => k === "K-208")).toBe(false);
        // A chip's × unlinks its part, and `+ resource` comes back for what it held.
        await press(button(tableRow(c, "bin:3201"), `Unlink LD-2232 from ${to}`));
        expect(tableRow(c, "bin:3201").querySelector<HTMLElement>('[data-allocation-placeholder="remainder"]')!.getAttribute("aria-label")).toBe("Choose a resource for the 6 m³ unallocated");
    });
});

describe("links (A72, A71)", () => {
    test("A72 — each part is its own link, weighted by its quantity within the family: the split bin in the focus links to each of its resources", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(card(c, "3201"));
        const links = [...c.querySelectorAll("[data-allocation-links] [data-plan-link]")].map(g => [g.querySelector("[data-link]")!.getAttribute("data-allocation-link"),
            Number(g.querySelector("[data-plan-ribbon-band]")!.getAttribute("stroke-width"))] as const);
        // K-601's family: the split bin's part there, 20 m³, the family's largest, and its other part, 6 m³ on K-208, a third of it at most.
        expect(links).toEqual([["3201|K-601", 8], ["3201|K-208", 2]]);
    });

    test("A71, A73 — dragging a link moves its part alone: the fit asked for its 6 m³", async () => {
        stubLinkGeometry();
        const c = await open();
        await press(card(c, "3201"));
        const caption = c.querySelector<SVGGElement>('[data-allocation-caption="3201|K-208"]')!;
        await hover(caption, row(c, "K-101"));
        expect(placedOf("3201")).toContain(6);
        const answer = answerFor("3201", 6)!;
        const to = fitsOf(answer, ["K-208"])[0]!;
        await over(details(c).querySelector<HTMLElement>(`[data-allocation-drop-row="${to}"]`)!);
        await release();
        await press(save(c));
        // Its 6 m³ moves alone: onto K-601, it joins the part there.
        const parts = Object.fromEntries(saved("3201").parts);
        expect(parts).toEqual(to === "K-601" ? { "K-601": 26 } : { "K-601": 20, [to]: 6 });
    });
});

describe("Find a fit (A74, A73)", () => {
    /** The Library's Resources tab: its cards in order, each its key and its line. */
    const resourceCards = (c: HTMLElement) => [...slot(c, "start").querySelectorAll<HTMLElement>('[data-allocation-library="resources"] [data-library-item]')]
        .map(item => [item.getAttribute("data-library-item"), text(item.querySelector("[data-library-note]"))]);
    /** The fits best first, as the Library lays them out: in its groups, each group where its best card stands. */
    const asListed = (c: HTMLElement, fits: readonly string[]) => {
        const groupOf = new Map<string, string>();
        let head = "";
        for (const el of slot(c, "start").querySelectorAll<HTMLElement>('[data-allocation-library="resources"] [data-library-head], [data-allocation-library="resources"] [data-library-item]')) {
            if (el.hasAttribute("data-library-head")) head = el.textContent ?? ""; else groupOf.set(el.getAttribute("data-library-item")!, head);
        }
        const groups = [...new Set(fits.map(k => groupOf.get(k) ?? ""))];
        return groups.flatMap(g => fits.filter(k => (groupOf.get(k) ?? "") === g));
    };
    const chip = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>("[data-allocation-find] button");
    const resourcesTab = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources"))!;

    test("A74 — Partly allocated's fix asks the fit for the bin's 4 m³ and opens Resources on the fits, best first, each its reason, under a chip that clears it", async () => {
        const c = await open();
        await tab(c, "end", "Issues");
        await press(button(issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="unallocated"]')!, "Find a fit"));
        const answer = answerFor("3201", 4)!;
        expect(answer).toBeDefined();
        expect(resourcesTab(c).getAttribute("aria-selected")).toBe("true");
        expect(text(chip(c))).toBe("Find · LD-2232 · 4 m³");
        const fits = fitsOf(answer);
        const listed = resourceCards(c);
        expect(listed.length).toBeGreaterThan(0);
        expect(listed).toEqual(asListed(c, fits).slice(0, listed.length).map(k => [k, whyOf(answer, k)]));
        expect(resourcesTab(c).textContent).toBe(`Resources ${fits.length} of 33`);
        // The rail and the board stay as they are: the find is the tab's.
        expect(c.querySelectorAll("[data-allocation-resource]").length).toBeGreaterThan(fits.length);
        await press(chip(c));
        expect([chip(c), resourcesTab(c).textContent]).toEqual([null, "Resources 33"]);
        expect(resourceCards(c).every(([, note]) => note === null || !fits.some(k => note === whyOf(answer, k)))).toBe(true);
    });

    test("A74 — a bin's action too, and a Not linked issue's beside Choose; `Finding…` while its answer is on its way", async () => {
        const c = await open();
        await press(card(c, "3201"));
        const letGo = h.fits.hold();
        // Unlinked, the bin's whole 30 m³ is what Find asks the fit for.
        await press(button(details(c), "Unlink"));
        await tab(c, "end", "Issues");
        const unlinked = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue-group="unlinked"]')!;
        expect(within(unlinked).getAllByRole("button").map(b => b.textContent)).toEqual(["Show", "Choose a resource", "Find a fit"]);
        await press(button(unlinked, "Find a fit"));
        expect(within(issuesTab(c)).getAllByRole("button").some(b => b.textContent === "Finding…")).toBe(true);
        expect(slot(c, "start").querySelector('[data-allocation-library="resources"]')!.getAttribute("aria-busy")).toBe("true");
        await act(async () => { letGo(); }); await settle();
        expect(text(chip(c))).toBe("Find · LD-2232 · 30 m³");
        const found = resourceCards(c).map(([k]) => k);
        expect(found).toEqual(asListed(c, fitsOf(answerFor("3201", 30)!)).slice(0, found.length));
        // The bin's own action: Find a fit, with its head's.
        await tab(c, "end", "Details");
        await press(card(c, "3201"));
        expect([...details(c).querySelectorAll("[data-allocation-bin-actions] button")].map(b => b.textContent)).toEqual(["Revert", "Back to Events", "Find a fit"]);
    });

    test("A74 — a find whose bin is placed whole is done: its chip goes, and does not come back when some of the bin is left again", async () => {
        const c = await open();
        await press(card(c, "3201"));
        await press(details(c).querySelector("[data-allocation-find]"));
        expect(text(chip(c))).toBe("Find · LD-2232 · 4 m³");
        // K-601's part takes the remainder too: 24 of 30, and K-208's 6 — nothing left.
        const user = userEvent.setup();
        const k601 = () => within(details(c).querySelector<HTMLElement>('[data-allocation-parts] [data-field="K-601"]')!).getByRole("spinbutton");
        const type = async (value: string) => {
            await user.clear(k601());
            for (const k of value) { await user.type(k601(), k); await settle(); }
            await user.keyboard("{Enter}");
            await settle();
        };
        await type("24");
        expect([remainder(c), chip(c)]).toEqual([null, null]);
        // 4 m³ left again: the find was done, and a new one is the viewer's to ask.
        await type("20");
        expect([remainder(c), chip(c)]).toEqual(["4 m³ unallocated", null]);
    });

    test("A74 — with no Resources tab to show the fits in, nothing offers Find a fit", async () => {
        const c = await open(ex.allocationMinimal);
        await key(c, "]");
        expect(slot(c, "end")).toBeNull();
        expect(c.querySelector("[data-allocation-find]")).toBeNull();
    });
});
