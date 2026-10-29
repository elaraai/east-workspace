/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's previews on e3 itself (#1453, `Decision Queue Spec.md`
 * §9.5), over the full queue's example (§3.3): the models' cases read through
 * the rail's source, each option's change landing where its tag says — here
 * the warehouse rota's duties, drawn as the Roster draws them. The cases are
 * laid out by when each is due, money printed as money and the orders as a
 * count, the routine case in its band (R1–R3, R28); a card's preview stands
 * between its title and its chip line, open or closed (P1), the People week's
 * crop of the people the change lands on, their hours before → after in the
 * tone the change gives them, the duty it proposes marked where it lands and
 * a ghost where it was, every other as it stands, and one sentence naming it
 * (P4, P13, P14, P19, P24, P25); the recommended option says so on its line
 * (R14); choosing another option draws its change, and one that changes
 * nothing draws the people the recommendation lands on, unmarked (P4); Apply,
 * once the question is answered, writes the duty and the verdict through their
 * doors (R16, R23, R29); and the routine band's Apply all adds the request it
 * proposes (R28).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/decision/decision";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { decisionQueueMessages as m } from "./messages.js";
import "./index.js";

const h = e3Harness({ "decision/decision": ex }, { main: "data-decision-main" });

const verdictEqual = equalFor(ex.OpsVerdict);
const dutiesEqual = equalFor(ex.rosterDuties.type);
const compareTime = compareFor(DateTimeType);
const byString = compareFor(StringType);

/** Saturday's late, which the routine case asks an agency to cover. */
const SAT_LATE = new Date("2028-03-11T14:00:00Z");
const SAT_LATE_END = new Date("2028-03-11T22:00:00Z");

/** The cases whose cards the list draws, in its order. */
const heads = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-head]")].map(el => el.getAttribute("data-decision-head"));
/** A case's card's head. */
const head = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-head="${key}"]`)!;
/** A case's card. */
const card = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`[data-decision-card="${key}"]`)!;
/** The open card's case's key; `undefined` while none is open. */
const openCard = (container: HTMLElement) => container.querySelector("[data-decision-card][data-open]")?.getAttribute("data-decision-card") ?? undefined;
/** Each section's head as it reads: its label, its count and its total. */
const sections = (container: HTMLElement) => [...container.querySelectorAll("[data-decision-section]")].map(el =>
    [el.getAttribute("data-decision-section"), [...el.children].map(part => part.textContent).filter(text => text !== "").join(" | ")]);
/** A case's preview: the one image in its card's head. */
const preview = (container: HTMLElement, key: string) => head(container, key).querySelector<HTMLElement>("[data-decision-preview]")!;
/** A preview's rows, by the name each heads. */
const previewRows = (frame: HTMLElement) => [...frame.querySelectorAll<HTMLElement>("[data-preview-row]")].map(row => row.getAttribute("data-preview-row"));
/** A preview's row by the name it heads. */
const previewRow = (frame: HTMLElement, name: string) => frame.querySelector<HTMLElement>(`[data-preview-row="${name}"]`)!;
/** A row's measure, as it reads, and the tone it is drawn in: `undefined` for neither better nor worse. */
function measure(row: HTMLElement, text: string): string | undefined {
    return within(row).getByText(text).getAttribute("data-tone") ?? undefined;
}
/** A duty's tile in a row, as the change marks it: its mark, its fill and its title. */
function tile(row: HTMLElement, key: string) {
    const el = row.querySelector<HTMLElement>(`[data-preview-tile="${key}"]`);
    return el === null ? undefined : { op: el.getAttribute("data-op") ?? undefined, fill: el.getAttribute("data-fill") ?? undefined, title: el.getAttribute("title") };
}
/** The duties a row draws that the change marks. */
const marked = (row: HTMLElement) => [...row.querySelectorAll("[data-preview-tile][data-op]")].map(el => el.getAttribute("data-preview-tile"));
/** One of a card's options, by the start of its name: its label. */
const optionOf = (container: HTMLElement, key: string, label: RegExp) => within(card(container, key)).getByRole("option", { name: label });
/** A card's chip line: `Proposed` or `Modified`, and the summary — the head's part after the preview. */
const chipLine = (container: HTMLElement, key: string) => head(container, key).children[3] as HTMLElement;
/** One of a card's actions. */
const action = (container: HTMLElement, key: string, name: string) => within(card(container, key)).getByRole("button", { name });
/** One of the history item's buttons. */
const history = (container: HTMLElement, name: string) => within(slot(container, "toolbar")).getByRole<HTMLButtonElement>("button", { name });
/** The mutations a test's Saves sent, by the record each wrote, in order. */
const mutated = () => h.requests("mutate").map(request => request.record).sort();

/** Presses a control, and lets what it records and sends settle. */
async function press(el: Element) {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Mounts the full queue, and waits until its cards show and the open one's preview has drawn its rows. */
async function open() {
    const ui = await h.mount(ex.decisionQueueOps);
    await waitFor(() => expect(heads(ui.container)).toEqual(["rota-tansy", "orders-ready", "price-coast"]));
    await waitFor(() => expect(previewRows(preview(ui.container, "rota-tansy"))).not.toEqual([]));
    return ui;
}

/** A case's saved verdict, given within a span: its time read off it, and every other field as given. */
async function savedVerdict(key: string, from: Date, to: Date, rest: { option: string; answer?: "yes" | "no" | "unsure" }) {
    const saved = (await h.read(ex.opsVerdicts)).get(key);
    expect(saved).toBeDefined();
    const at = saved!.verdict.value.at;
    expect(compareTime(at, from)).toBeGreaterThanOrEqual(0);
    expect(compareTime(at, to)).toBeLessThanOrEqual(0);
    expect(verdictEqual(saved!, {
        verdict: variant("applied", { at }), option: some(rest.option),
        answer: rest.answer === undefined ? none : some(variant(rest.answer, null)), reason: none, note: none,
    })).toBe(true);
}

// ── Laying out (R1–R3, R28) ─────────────────────────────────────────────────

test("the models' cases by when each is due — Overdue, Due today, This week — each its count and total, money as money and the orders as a count; the routine case in its band; the first opens on its recommendation (R1–R3, R7, R14, R28)", async () => {
    const { container } = await open();
    expect(sections(container)).toEqual([["overdue", "Overdue | 1 | +$80K"], ["today", "Due today | 1 | +3"], ["week", "This week | 1 | +$17K"]]);
    expect(slot(container, "toolbar").querySelector("[data-decision-title] [data-decision-count]")?.textContent).toBe("3");
    const band = container.querySelector<HTMLElement>("[data-decision-routine]")!;
    expect(band.textContent).toContain(m.together({ total: "+$1.2K" }));
    expect(within(band).getByRole("button", { name: m.applyAll({ n: "1" }) })).toBeDefined();
    // The overdue case opens, on its recommendation: its line says so before its note.
    expect(openCard(container)).toBe("rota-tansy");
    const rota = within(head(container, "rota-tansy"));
    expect(rota.getByText("Roster · Picking · W10")).toBeDefined();
    expect(rota.getByText("2h late").getAttribute("data-tone")).toBe("overdue");
    for (const words of [m.chip({ modified: false }), "B. Pumice · Fri 14–22", "+$80K", "uplift"]) expect(rota.getByText(words)).toBeDefined();
    const recommended = optionOf(container, "rota-tansy", /^B\. Pumice/u);
    expect(recommended.getAttribute("aria-selected")).toBe("true");
    expect(within(recommended).getByText(m.recommendedLine({ note: "B. Pumice lands at 32h of 38" }))).toBeDefined();
    expect(within(optionOf(container, "rota-tansy", /^A\. Osier/u)).getByText("A. Osier lands at 40h of 38")).toBeDefined();
});

// ── The Roster's crop (P1, P4, P13, P14, P19, P24, P25) ─────────────────────

test("the rota case's preview is the People week's crop of the people its change lands on: J. Tansy's late on Friday a ghost moving to B. Pumice, where it lands proposed; their hours before → after, J. Tansy's better; every other duty as it stands, and one sentence (P4, P13, P14, P19, P24, P25)", async () => {
    const { container } = await open();
    const frame = preview(container, "rota-tansy");
    expect(frame.getAttribute("role")).toBe("img");
    expect(frame.getAttribute("data-kind")).toBe("roster");
    expect(frame.getAttribute("data-layout")).toBe("roster");
    expect(frame.getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to B. Pumice");
    expect(previewRows(frame)).toEqual(["J. Tansy", "B. Pumice"]);
    const tansy = previewRow(frame, "J. Tansy"), pumice = previewRow(frame, "B. Pumice");
    expect(measure(tansy, "42 → 34h")).toBe("better");
    expect(measure(pumice, "24 → 32h")).toBeUndefined();
    expect(tile(tansy, "s234")).toEqual({ op: "from", fill: undefined, title: "Late · Fri 10 · moves to B. Pumice" });
    expect(tile(pumice, "s234")).toEqual({ op: "add", fill: "own", title: "Late · Fri 10 · proposed" });
    // Only the duty the change moves is marked; no other case changes it.
    expect(marked(tansy)).toEqual(["s234"]);
    expect(marked(pumice)).toEqual(["s234"]);
    expect(frame.querySelector("[data-preview-shared]")).toBeNull();
    // The preview sits between the title and the chip line, on the closed card as on the open one.
    const parts = [...head(container, "rota-tansy").children];
    expect(parts.indexOf(frame)).toBe(2);
    await act(async () => { fireEvent.keyDown(container.querySelector<HTMLElement>("[data-decision-main]")!, { key: "Escape" }); });
    await settle();
    expect(openCard(container)).toBeUndefined();
    expect(previewRows(preview(container, "rota-tansy"))).toEqual(["J. Tansy", "B. Pumice"]);
});

test("choosing another option draws its change: A. Osier takes the late, over contract, and the chip reads Modified; an option that changes nothing draws the people the recommendation lands on as they stand, unmarked (P1, P4, P24, R15)", async () => {
    const { container } = await open();
    await press(optionOf(container, "rota-tansy", /^A\. Osier/u));
    const frame = () => preview(container, "rota-tansy");
    await waitFor(() => expect(previewRows(frame())).toEqual(["J. Tansy", "A. Osier"]));
    expect(frame().getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to A. Osier");
    expect(measure(previewRow(frame(), "A. Osier"), "32 → 40h")).toBe("worse");
    expect(tile(previewRow(frame(), "A. Osier"), "s234")).toEqual({ op: "add", fill: "own", title: "Late · Fri 10 · proposed" });
    expect(chipLine(container, "rota-tansy").textContent).toBe(`${m.chip({ modified: true })}A. Osier`);
    expect(within(head(container, "rota-tansy")).getByText("+$72K")).toBeDefined();
    // Keep with J. Tansy changes nothing: J. Tansy and B. Pumice as the week stands, J. Tansy still over contract.
    await press(optionOf(container, "rota-tansy", /^Keep with J\. Tansy/u));
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("Nothing changes for J. Tansy and B. Pumice"));
    expect(previewRows(frame())).toEqual(["J. Tansy", "B. Pumice"]);
    expect(measure(previewRow(frame(), "J. Tansy"), "42h of 38")).toBe("worse");
    expect(measure(previewRow(frame(), "B. Pumice"), "24h of 38")).toBeUndefined();
    expect(frame().querySelectorAll("[data-preview-tile][data-op]")).toHaveLength(0);
    expect(tile(previewRow(frame(), "J. Tansy"), "s234")).toEqual({ op: undefined, fill: undefined, title: "Late · Fri 10" });
    expect(tile(previewRow(frame(), "B. Pumice"), "s234")).toBeUndefined();
    // Back on the recommendation, its change again.
    await press(optionOf(container, "rota-tansy", /^B\. Pumice/u));
    await waitFor(() => expect(frame().getAttribute("aria-label")).toBe("J. Tansy's Late shift on Fri moves to B. Pumice"));
    expect(chipLine(container, "rota-tansy").textContent).toBe(`${m.chip({ modified: false })}B. Pumice · Fri 14–22`);
});

// ── Apply and Save (R16, R23, R29) ──────────────────────────────────────────

test("Apply waits for the question's answer; answered Yes, it drafts the moved duty and the verdict as one step, and Save writes the duty to B. Pumice and the verdict with its option and answer, a request each (R16, R23, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    const apply = () => action(container, "rota-tansy", m.action({ action: "apply" }));
    expect(apply().getAttribute("aria-disabled")).toBe("true");
    expect(apply().getAttribute("title")).toBe(m.applyOff({ why: "needs" }));
    await press(within(card(container, "rota-tansy")).getByRole("radio", { name: m.answer({ answer: "yes" }) }));
    await waitFor(() => expect(apply().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(apply());
    expect(container.querySelector('[data-decision-receipt="rota-tansy"]')).not.toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.rosterDuties.name].sort());
    await savedVerdict("rota-tansy", from, new Date(), { option: "1-pumice", answer: "yes" });
    const friday = duties.get("s234")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties, ["s234", { ...friday, who: variant("staff", "bpumice") }]], byString))).toBe(true);
});

// ── The routine band (R28) ──────────────────────────────────────────────────

test("the routine band's Apply all drafts Saturday's agency request and its verdict as one step, its banner's Undo the history's; Save adds the request to the rota (R28, R29)", async () => {
    const { container } = await open();
    const duties = await h.read(ex.rosterDuties);
    const band = () => container.querySelector<HTMLElement>("[data-decision-routine]")!;
    const applyAll = () => within(band()).getByRole("button", { name: m.applyAll({ n: "1" }) });
    await waitFor(() => expect(applyAll().getAttribute("aria-disabled")).toBeNull());
    const from = new Date();
    await press(applyAll());
    const banner = m.batch({ n: "1" });
    expect(slot(container, "banners").textContent).toContain(banner.description);
    expect(container.querySelector("[data-decision-routine]")).toBeNull();
    await press(history(container, editingMessages.apply()));
    expect(mutated()).toEqual([ex.opsVerdicts.name, ex.rosterDuties.name].sort());
    await savedVerdict("rota-saturday", from, new Date(), { option: "1-request" });
    const thursday = duties.get("s250")!;
    expect(dutiesEqual(await h.read(ex.rosterDuties), new SortedMap([...duties, ["s319", { ...thursday, start: SAT_LATE, end: SAT_LATE_END }]], byString))).toBe(true);
});
