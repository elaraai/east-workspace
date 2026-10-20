/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The narrow layout (#1333, `Allocation Spec.md` §9.12, A78) over the kiln
 * yard's Tue 11, through the dispatcher and the yard's fit served by name:
 * below 480px of main the Timeline is a card per resource — its load line, its
 * bins with Unlink, Move, `Split…` and Back to Events, and `Book an event…` —
 * and the Table a card per row — `Book…`, `Reserve…`, `Allocate…`, a whole
 * bin's `Split…`, `Unlink`, `Back to Events` — each action one of the board's
 * commands, nothing registered to drag; resizing keeps the layout, the
 * selection and the drafts.
 */
import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { compareFor, decodeBeast2For, encodeBeast2For, FloatType, none, printFor, StringType, variant, type ValueTypeOf } from "@elaraai/east";
import { AllocationFitResultType } from "@elaraai/e3-ui/internal";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { editingMessages, StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { act, allocationHarness, mount, settle, slot, TUE, TUE_4, WED, width } from "./harness.test-utils.js";

const h = allocationHarness();
/** A source's narrowing written as the rail writes it: one field's values (the follows-rail tests' way). */
async function narrow(store: UIStore, example: string, source: "lanes" | "resources", field: string, values: readonly string[]) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none,
        where: new Map([[field, variant("values", values.map(v => printFor(StringType)(v)))]]) })); });
    await settle();
}
async function key(c: HTMLElement, k: string) { await act(async () => { fireEvent.keyDown(slot(c, "main"), { key: k }); }); await settle(); }
/** The cards' list, scrolled until a card is mounted: the list is virtualised, as the Table's rows are. */
async function scrollTo(c: HTMLElement, mounted: () => Element | null) {
    const list = c.querySelector<HTMLElement>("[data-allocation-cards] [data-virtual-rows]")!;
    for (let top = 0; mounted() === null && top <= 160 * 62; top += 4 * 62) { await act(async () => { list.scrollTop = top; fireEvent.scroll(list); }); await settle(); }
    expect(mounted()).not.toBeNull();
}
type FitResult = ValueTypeOf<typeof AllocationFitResultType>;
const byScore = compareFor(FloatType);
const byKey = compareFor(StringType);
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const undo = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.undo() });
const save = (c: HTMLElement) => toolbar(c).getByRole("button", { name: editingMessages.apply() });
const text = (el: Element | null | undefined) => el?.textContent ?? null;
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const button = (root: HTMLElement, name: string | RegExp) => within(root).getByRole("button", { name });
/** A resource's card, and a bin's line on it. */
const resourceCard = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-resource-card="${key}"]`);
const binLine = (c: HTMLElement, resource: string, bin: string) => resourceCard(c, resource)?.querySelector<HTMLElement>(`[data-allocation-card-bin="${bin}"]`) ?? null;
/** A Table row's card. */
const rowCard = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-allocation-row-card="${key}"]`);
/** A Chooser's popover, portaled out of main, by its cell; `Split…`'s, by its bin. */
const choices = (id: string) => document.querySelector<HTMLElement>(`[data-allocation-choices="${id}"]`);
const splitBox = (bin: string) => document.querySelector<HTMLElement>(`[data-allocation-split="${bin}"]`);
const options = (root: HTMLElement, section: string) => [...root.querySelectorAll(`[role=group][aria-label="${section}"] [role=option]`)]
    .map(o => o.querySelector("span:nth-child(2) > span:first-child")!.textContent);
/** The record's day, as Save wrote it. */
const saved = (day: Date) => h.read(ex.kilnPlans).get(day)!;
/** The yard fit's latest answer to placing a bin with a quantity, or to taking a resource. */
const placed = (bin: string, quantity: number) => [...h.fits.history].reverse().find(a => {
    const ask = (a as FitResult).ask;
    return ask.type === "place" && ask.value.subject.type === "bin" && ask.value.subject.value === bin && ask.value.quantity === quantity;
}) as FitResult | undefined;
const taken = (resource: string) => [...h.fits.history].reverse().find(a => { const ask = (a as FitResult).ask; return ask.type === "take" && ask.value.resource === resource; }) as FitResult | undefined;
/** An answer's fitting resources, best first. */
const fitsOf = (a: FitResult, except: readonly string[] = []) => [...a.resources].flatMap(([k, f]) => f.type === "fits" && !except.includes(k) ? [{ k, score: f.value.score }] : [])
    .sort((x, y) => byScore(y.score, x.score)).map(f => f.k);
/** What nothing on a narrow board may carry: a drag source, a drop target, a grip or a connector. */
const DRAG = "[data-draggable], [data-drag-cell], [data-allocation-grip], [data-allocation-connector], [data-allocation-timeline], [data-allocation-table]";

describe("the Timeline's cards (A78)", () => {
    test("A78 — below 480px of main the Timeline is a card per resource, in key order: its load line, its bins today, each with Unlink, Move, Split… and Back to Events, and Book an event…; nothing registered to drag", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        expect(c.querySelector("[data-allocation-timeline]")).not.toBeNull();
        await width(479);
        expect(c.querySelector('[data-allocation-cards="timeline"]')).not.toBeNull();
        expect(c.querySelector(DRAG)).toBeNull();
        // The first cards, in the resources' key order, as the Timeline's rows are (A18).
        const keys = [...c.querySelectorAll("[data-allocation-resource-card]")].map(card => card.getAttribute("data-allocation-resource-card"));
        expect(keys.slice(0, 4)).toEqual(["K-101", "K-102", "K-103", "K-104"]);
        // K-108's card: its name, its load line, bin 3113 (LD-2210, 32 m³) with its four actions, and Book an event….
        const card = resourceCard(c, "K-108")!;
        expect(text(card.querySelector("[data-allocation-card-line]"))).toMatch(/32 m³/);
        expect(text(binLine(c, "K-108", "3113")!.querySelector("button"))).toContain("LD-2210");
        expect(within(binLine(c, "K-108", "3113")!).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Unlink", "Move", "Split…", "Back to Events"]);
        expect(button(card, "Book an event…")).toBeTruthy();
    });

    test("A78 — a bin's Unlink unlinks its part there and Back to Events removes it, each at once, one draft Undo puts back; a card's head selects its resource", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        await press(button(binLine(c, "K-108", "3113")!, "Unlink"));
        expect(binLine(c, "K-108", "3113")).toBeNull();
        await press(undo(c));
        expect(binLine(c, "K-108", "3113")).not.toBeNull();
        await press(button(binLine(c, "K-108", "3113")!, "Back to Events"));
        expect(binLine(c, "K-108", "3113")).toBeNull();
        await press(save(c));
        expect(saved(TUE).bins.has("3113")).toBe(false);
        // The head selects the resource: its card is selected, and the Inspector shows it.
        await press(resourceCard(c, "K-108")!.querySelector("button"));
        expect(resourceCard(c, "K-108")!.hasAttribute("data-selected")).toBe(true);
    });

    test("A78, A73 — a bin's Move is its part's Chooser, the fit asked for its 32 m³: a choice moves it to another resource, one draft that Saves", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        await press(button(binLine(c, "K-108", "3113")!, "Move"));
        const box = choices("bin:3113|resource:K-108")!;
        const answer = placed("3113", 32)!;
        expect(answer).toBeDefined();
        const offered = options(box, "Gaps that fit");
        expect(offered).toEqual(fitsOf(answer, ["K-108"]));
        await press(within(box).getByRole("option", { name: new RegExp(offered[0]!) }));
        expect(binLine(c, "K-108", "3113")).toBeNull();
        expect(binLine(c, offered[0]!, "3113")).not.toBeNull();
        await press(save(c));
        expect([...saved(TUE).bins.get("3113")!.parts]).toEqual([[offered[0]!, 32]]);
    });

    test("A78, A71, A73 — a bin's Split… is the Inspector's popover: half its part there by default, the fit asked for that half, its own resource left out; a choice puts it on another resource, one draft that Saves (#1362)", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        await press(button(binLine(c, "K-108", "3113")!, "Split…"));
        const box = splitBox("3113")!;
        expect(box.closest("[role=dialog]")!.textContent).toContain("Split LD-2210 · 32 m³ on K-108");
        expect(Number((within(box).getByRole("spinbutton") as HTMLInputElement).value)).toBe(16);
        const answer = placed("3113", 16)!;
        expect(answer).toBeDefined();
        const offered = options(box, "Gaps that fit");
        expect(offered.length).toBeGreaterThan(0);
        expect(offered).toEqual(fitsOf(answer, ["K-108"]));
        await press(within(box).getByRole("option", { name: new RegExp(offered[0]!) }));
        // K-108 keeps half: its line says the 16 m³ it holds now, as the other kiln's card does.
        expect(text(binLine(c, "K-108", "3113")!.querySelector("button"))).toContain("16 m³");
        await scrollTo(c, () => binLine(c, offered[0]!, "3113"));
        expect(text(binLine(c, offered[0]!, "3113")!.querySelector("button"))).toContain("16 m³");
        await press(save(c));
        expect([...saved(TUE).bins.get("3113")!.parts]).toEqual([["K-108", 16], [offered[0]!, 16]].sort((x, y) => byKey(x[0] as string, y[0] as string)));
    });

    test("A78, A36 — Book an event… lists the events the fit takes on the resource; a choice books it there at the day's first free slot, B-1 00:15", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        await press(button(resourceCard(c, "K-107")!, "Book an event…"));
        const box = choices("resource:K-107|book")!;
        const answer = taken("K-107")!;
        expect(answer).toBeDefined();
        const fits = options(box, "Fits K-107");
        expect(fits.length).toBeGreaterThan(0);
        // Every one the fit says fits (F4): the yard's loads are keyed by their codes.
        for (const code of fits) expect(answer.events.get(code)?.type).toBe("fits");
        await press(within(box).getByRole("option", { name: new RegExp(fits[0]!) }));
        const line = [...resourceCard(c, "K-107")!.querySelectorAll("[data-allocation-card-bin]")].find(l => l.textContent!.includes(fits[0]!))!;
        expect(text(line.querySelector("button"))).toContain("00:15 · B-1");
        await press(save(c));
        const booked = [...saved(TUE).bins.values()].find(bin => bin.event.type === "some" && bin.event.value === fits[0])!;
        expect([booked.lane, booked.at.getTime(), [...booked.parts.keys()]]).toEqual(["B-1", Date.UTC(2027, 4, 11, 0, 15), ["K-107"]]);
    });
});

describe("the Table's cards (A78)", () => {
    test("A78 — below 480px of main the Table is a card per row in its bands: a free row's Book… and Reserve…; nothing registered to drag", async () => {
        const { container: c } = mount(ex.allocationTable); await settle();
        await width(479);
        expect(c.querySelector('[data-allocation-cards="table"]')).not.toBeNull();
        expect(c.querySelector(DRAG)).toBeNull();
        // The first band's head, then its first row: the day's first slot, B-1 00:15, free.
        const first = c.querySelector<HTMLElement>("[data-allocation-row-card]")!;
        expect([first.getAttribute("data-kind"), text(first.querySelector("button")!.firstElementChild)]).toEqual(["free", "B-1 · 00:15"]);
        expect(within(first).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Book…", "Reserve…"]);
        expect(first.querySelector("[data-status]")!.getAttribute("data-status")).toBe("Free");
    });

    test("A78 — a free row's Book… books an event there; its card's Allocate… links it, Unlink unlinks it and Back to Events removes it, each one draft", async () => {
        const { container: c } = mount(ex.allocationTable); await settle();
        await width(479);
        const first = c.querySelector<HTMLElement>('[data-allocation-row-card][data-kind="free"]')!;
        const key = first.getAttribute("data-allocation-row-card")!;
        await press(button(first, "Book…"));
        const book = choices(`${key}|event`)!;
        const code = options(book, "Book here")[0]!;
        await press(within(book).getByRole("option", { name: new RegExp(code) }));
        // A new bin there, not linked yet: its card a bin's.
        const id = [...c.querySelectorAll<HTMLElement>('[data-allocation-row-card][data-kind="bin"]')].find(card => card.textContent!.includes(code))!.getAttribute("data-allocation-row-card")!;
        const card = () => rowCard(c, id)!;
        expect(card().querySelector("[data-status]")!.getAttribute("data-status")).toBe("Not linked");
        expect(within(card()).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Allocate…", "Back to Events"]);
        // Allocate…: the fit's answer for its whole quantity.
        await press(button(card(), "Allocate…"));
        const allocate = choices(`${id}|resource`)!;
        const bin = id.slice("bin:".length);
        const quantity = h.read(ex.arrivals).get(code)!.m3;
        const offered = options(allocate, "Gaps that fit");
        expect(offered).toEqual(fitsOf(placed(bin, quantity)!));
        await press(within(allocate).getByRole("option", { name: new RegExp(offered[0]!) }));
        expect(card().querySelector("[data-status]")!.getAttribute("data-status")).toBe("Draft");
        expect(within(card()).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Allocate…", "Split…", "Unlink", "Back to Events"]);
        await press(button(card(), "Unlink"));
        expect(card().querySelector("[data-status]")!.getAttribute("data-status")).toBe("Not linked");
        await press(button(card(), "Back to Events"));
        expect(rowCard(c, id)).toBeNull();
        expect(rowCard(c, key)).not.toBeNull();
    });

    test("A78 — a free row's Reserve… reserves it on a resource the fit takes; the reservation's card offers Book…, Reserve… and Remove", async () => {
        const { container: c } = mount(ex.allocationTable); await settle();
        await width(479);
        const first = c.querySelector<HTMLElement>('[data-allocation-row-card][data-kind="free"]')!;
        const key = first.getAttribute("data-allocation-row-card")!;
        await press(button(first, "Reserve…"));
        const box = choices(`${key}|resource`)!;
        const offered = options(box, "Can be reserved");
        expect(offered.length).toBeGreaterThan(0);
        await press(within(box).getByRole("option", { name: new RegExp(offered[0]!) }));
        const reserved = c.querySelector<HTMLElement>('[data-allocation-row-card][data-kind="reserved"]')!;
        expect(text(reserved.querySelector("button"))).toContain(`Reserved on ${offered[0]}`);
        expect(within(reserved).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Book…", "Reserve…", "Remove"]);
        await press(button(reserved, "Remove"));
        expect(c.querySelector('[data-allocation-row-card][data-kind="reserved"]')).toBeNull();
    });
});

describe("a split bin's cards (A78, A71, A73)", () => {
    test("A78, A73 — on its resource's card a split bin's Move asks the fit for that part's 6 m³, and its Unlink unlinks that part alone", async () => {
        const { container: c } = mount(ex.allocationSplit); await settle();
        await width(479);
        // 3201 (LD-2232, 30 m³): 20 on K-601, 6 on K-208, 4 unallocated.
        await scrollTo(c, () => binLine(c, "K-208", "3201"));
        await press(button(binLine(c, "K-208", "3201")!, "Move"));
        expect(choices("bin:3201|resource:K-208")).not.toBeNull();
        expect(placed("3201", 6)).toBeDefined();
        await press(button(binLine(c, "K-208", "3201")!, "Unlink"));
        expect(binLine(c, "K-208", "3201")).toBeNull();
        await press(save(c));
        expect([...saved(WED).bins.get("3201")!.parts]).toEqual([["K-601", 20]]);
    });

    test("A78, A71, A73 — the Table's card of a split bin: where its parts are and what they leave; Allocate… links the remainder, asked for 4 m³, its own resources left out", async () => {
        const { container: c } = mount(ex.allocationTable); await settle();
        await key(c, "]");
        await width(479);
        await scrollTo(c, () => rowCard(c, "bin:3201"));
        const card = rowCard(c, "bin:3201")!;
        expect(card.textContent).toContain("K-601 20 m³ · K-208 6 m³");
        expect(text(card.querySelector('[data-tone="warning"]'))).toBe("4 m³ unallocated");
        // Its Allocate… places what is left, so it offers no Split… (#1362).
        expect(within(card).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Allocate…", "Unlink", "Back to Events"]);
        await press(button(card, "Allocate…"));
        expect(placed("3201", 4)).toBeDefined();
        const offered = options(choices("bin:3201|resource:+")!, "Gaps that fit");
        expect(offered.length).toBeGreaterThan(0);
        expect(offered.some(k => k === "K-601" || k === "K-208")).toBe(false);
    });
});

describe("a whole bin's Split… on the Table's card (A78, A71, #1362)", () => {
    test("A78, A71, A73 — a bin wholly on its resources: Split… beside Allocate…, half its largest part by default; a choice splits it there, one draft that Saves", async () => {
        const { container: c } = mount(ex.allocationTable); await settle();
        await width(479);
        await scrollTo(c, () => rowCard(c, "bin:3113"));
        const card = () => rowCard(c, "bin:3113")!;
        expect(within(card()).getAllByRole("button").slice(1).map(b => b.textContent)).toEqual(["Allocate…", "Split…", "Unlink", "Back to Events"]);
        await press(button(card(), "Split…"));
        const box = splitBox("3113")!;
        expect(box.closest("[role=dialog]")!.textContent).toContain("Split LD-2210 · 32 m³ on K-108");
        expect(Number((within(box).getByRole("spinbutton") as HTMLInputElement).value)).toBe(16);
        const offered = options(box, "Gaps that fit");
        expect(offered).toEqual(fitsOf(placed("3113", 16)!, ["K-108"]));
        await press(within(box).getByRole("option", { name: new RegExp(offered[0]!) }));
        expect(card().textContent).toContain([["K-108", "K-108 16 m³"], [offered[0]!, `${offered[0]!} 16 m³`]].sort((x, y) => byKey(x[0]!, y[0]!)).map(([, said]) => said).join(" · "));
        await press(save(c));
        expect([...saved(TUE).bins.get("3113")!.parts]).toEqual([["K-108", 16], [offered[0]!, 16]].sort((x, y) => byKey(x[0] as string, y[0] as string)));
    });
});

describe("the cards follow the rail (A78, A92, A93)", () => {
    test("A78 — a resource narrowing shows its resources' cards alone, in key order", async () => {
        const store = new UIStore(); StateRuntime.initializeStore(store);
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        await narrow(store, "allocationKilnYard", "resources", "group", ["Hall B"]);
        expect([...c.querySelectorAll("[data-allocation-resource-card]")].map(card => card.getAttribute("data-allocation-resource-card")))
            .toEqual(["K-201", "K-202", "K-203", "K-204", "K-205", "K-206", "K-207", "K-208", "K-209"]);
    });

    test("A78 — a lane narrowing hides the Table's cards of the lanes it hides", async () => {
        const store = new UIStore(); StateRuntime.initializeStore(store);
        const { container: c } = mount(ex.allocationTable); await settle();
        await width(479);
        await narrow(store, "allocationTable", "lanes", "area", ["South"]);
        const lanes = [...c.querySelectorAll("[data-allocation-row-card]")].map(card => text(card.querySelector("button")!.firstElementChild)!.split(" · ")[0]);
        expect(lanes.length).toBeGreaterThan(0);
        expect(new Set(lanes)).toEqual(new Set(["B-3"]));
    });
});

describe("resizing and a published day (A78)", () => {
    test("A78 — a pick on a phone registers no drop target: the Inspector's fits are Book buttons, no drop cells", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await width(479);
        const start = slot(c, "start");
        if (start.hasAttribute("data-collapsed")) await press(button(start, "Expand Library"));
        await press(start.querySelector('[data-library-item="event:LD-2235"]'));
        const end = slot(c, "end");
        if (end.hasAttribute("data-collapsed")) await press(button(end, "Expand Inspector"));
        expect(within(end).getAllByRole("button", { name: "Book" }).length).toBeGreaterThan(0);
        expect(c.querySelector(DRAG)).toBeNull();
    });

    test("A78 — resizing keeps the layout, the selection and the drafts: a bin moved on the Timeline is selected and drafted on its card, and back", async () => {
        const { container: c } = mount(ex.allocationKilnYard); await settle();
        await press(c.querySelector('[data-allocation-card="3113"]'));
        // A draft: the bin an hour later, from the Inspector.
        await press(button(slot(c, "end"), "One hour later"));
        await width(479);
        const line = binLine(c, "K-108", "3113")!;
        expect([line.hasAttribute("data-selected"), line.hasAttribute("data-draft")]).toEqual([true, true]);
        await width(900);
        const card = c.querySelector<HTMLElement>('[data-allocation-card="3113"]')!;
        expect([card.hasAttribute("data-selected"), card.hasAttribute("data-draft"), c.querySelector("[data-allocation-main]")!.getAttribute("data-allocation-layout")]).toEqual([true, true, "timeline"]);
        await press(save(c));
        expect(saved(TUE).bins.get("3113")!.at.getTime()).toBe(Date.UTC(2027, 4, 11, 11, 35));
    });

    test("A78 — a published day's cards have no actions", async () => {
        const { container: c } = mount(ex.allocationPublished); await settle();
        await width(479);
        expect(c.querySelector('[data-allocation-main]')!.getAttribute("data-allocation-day")).toBe(String(TUE_4.getTime()));
        const cards = [...c.querySelectorAll<HTMLElement>("[data-allocation-resource-card]")];
        expect(cards.length).toBeGreaterThan(0);
        // Each card's head and its bins' heads select; nothing edits.
        for (const card of cards) for (const b of within(card).getAllByRole("button")) expect(b.hasAttribute("aria-pressed")).toBe(true);
    });
});
