/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The jq view (#937, `Query Editor Spec.md` §4.8, §7 J1–J4), through
 * `<Query.Builder>`'s carrier over a saved queries record in memory, with a
 * one-shot call that never reaches a server:
 *
 * - **J1**: highlighting — each token's kind from east's lexer; the gutter's
 *   numbers, and its dots by the worst problem on a line; marks under the
 *   problems' ranges.
 * - **J2**: completions — the bound sources at the root, a variant's `type`
 *   and `value`, case names inside a string, builtins inserting `name(`, a
 *   closing quote not doubled; keys; and the data's values from a summary the
 *   builder holds, never fetched.
 * - **J3**: the problems panel — codes, positions and sentences, a note on a
 *   part that stays a jq step, going to a range, and each text-edit fix making
 *   a program that checks clean, one gesture of its own.
 * - **J4**: the jq left is one transaction; ⌘⏎ runs it; Tab inserts two
 *   spaces; the completions close as the caret moves and on blur.
 * - **Another query opened while it shows one** (#1132): the opened query's
 *   own program from its first render — the jq of a query that is not steps,
 *   the visual view of one that is — run as it opens, and no draft left on it.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { ArrayType, IntegerType, StringType, checkJq, decodeBeast2, equalFor, evaluateJq, none, some, variant } from "@elaraai/east";
import type { ExecuteResult } from "@elaraai/e3-types";
import { system } from "@elaraai/east-ui-components";
import { JqEditor } from "./jq-editor.js";
import { SummaryCache, summaryAt, type Summary } from "./model/summaries.js";
import { usePartStyles } from "./parts.js";
import {
    FIXTURE_VALUE, FixtureType, ROOT, enabled, fixtureCall, mountBuilder, offlineCall, openQuery, press, recordHarness, savedQuery, savedRecord, settle,
} from "./query.test-utils.js";
import { parseSteps } from "./steps/parse.js";
import { useQueryWords } from "./words.js";

/** The shared fixture's default query (`Query Editor Spec.md` §4.7). */
const DEFAULT_PROGRAM = [
    ".customers as $customers",
    ".orders",
    "map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "sort_by(-.total)",
    ".[:10]",
].join("\n| ");
const TOP = savedQuery("Top shipped orders, 2026", DEFAULT_PROGRAM);
const BIG = savedQuery("Big orders", ".orders\n| map(select(.total >= 1000))");

beforeEach(() => {
    recordHarness(savedRecord([TOP, BIG]));
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ─── What the jq view shows, and how it is worked ────────────────────────────

/** The jq view's text field. */
const area = () => screen.getByRole("textbox", { name: "jq query" }) as HTMLTextAreaElement;
/** The highlighting's lines. */
const highlightLines = () => [...document.querySelector<HTMLElement>("[data-query-jq-highlight]")!.children] as HTMLElement[];
/** A line's tokens: each kind and text, its whitespace left out. */
const tokensOf = (line: HTMLElement) => [...line.querySelectorAll<HTMLElement>("[data-kind]")]
    .filter((t) => t.getAttribute("data-kind") !== "ws")
    .map((t) => [t.getAttribute("data-kind"), t.textContent]);
/** The gutter: each line's number, and its dot's severity. */
const gutter = () => [...document.querySelector<HTMLElement>("[data-query-jq-gutter]")!.children]
    .map((line) => [line.textContent, line.querySelector("[data-severity]")?.getAttribute("data-severity") ?? null]);
/** The tokens marked, each with its mark. */
const marked = () => [...document.querySelectorAll<HTMLElement>("[data-query-jq-highlight] [data-mark]")].map((t) => [t.textContent, t.getAttribute("data-mark")]);
/** The problems panel's check. */
const checkWord = () => document.querySelector<HTMLElement>("[data-query-jq-check]")!.textContent;
/** The problems panel's rows: each code, position and sentence. */
const problemRows = () => [...document.querySelectorAll<HTMLElement>("[data-query-jq-problem]")].map((row) => {
    const go = row.querySelector("button")!;
    const head = go.firstElementChild!;
    return [head.children[0]!.textContent, head.children[1]?.textContent ?? "", go.lastElementChild!.textContent];
});
/** A problem's row, by its code. */
const rowOf = (code: string) => document.querySelector<HTMLElement>(`[data-query-jq-problem="${code}"]`)!;
/** The completions, when open. */
const completions = () => document.querySelector<HTMLElement>("[data-query-completions]");
/** Their labels, glyphs and details. */
const offered = () => [...completions()!.querySelectorAll<HTMLElement>("[role=option]")]
    .map((o) => [o.querySelector("[data-glyph]")!.textContent, o.querySelector("[data-label]")!.textContent, o.querySelector("[data-detail]")!.textContent]);
/** The active completion's line in the footer. */
const doc = () => completions()!.querySelector("[data-doc]")!.textContent;

/** Opens a saved query, and shows it as jq. */
async function openJq(name: string) {
    await openQuery(variant("saved", name));
    await act(async () => { fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "jq" })); });
    await settle();
}
/** Types the jq, the caret at `caret` (its end by default). */
async function type(text: string, caret = text.length) {
    await act(async () => { fireEvent.change(area(), { target: { value: text, selectionStart: caret, selectionEnd: caret } }); });
}
/** Presses a key in the text field. */
async function key(name: string, init: Record<string, unknown> = {}) {
    await act(async () => { fireEvent.keyDown(area(), { key: name, ...init }); });
}
/** Leaves the editor. */
async function leave() {
    await act(async () => { fireEvent.blur(area()); });
    await settle();
}

// ─── J1 ──────────────────────────────────────────────────────────────────────

describe("the jq view (#937) — J1 highlighting", () => {
    test("the default query's tokens carry east's lexer's kinds; the gutter numbers each line", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(TOP.name);
        expect(area().value).toBe(DEFAULT_PROGRAM);
        const lines = highlightLines();
        expect(lines.map((l) => l.textContent)).toEqual(DEFAULT_PROGRAM.split("\n"));
        expect(tokensOf(lines[0]!)).toEqual([["field", ".customers"], ["keyword", "as"], ["variable", "$customers"]]);
        expect(tokensOf(lines[2]!).slice(0, 12)).toEqual([
            ["pipe", "|"], ["builtin", "map"], ["punctuation", "("], ["builtin", "select"], ["punctuation", "("], ["field", ".status"], ["field", ".type"],
            ["operator", "=="], ["string", "\"shipped\""], ["punctuation", ")"], ["pipe", "|"], ["builtin", "select"],
        ]);
        expect(tokensOf(lines[2]!).filter(([kind]) => kind === "number" || kind === "keyword")).toEqual([["number", "100"], ["keyword", "and"], ["number", "2026"]]);
        expect(gutter()).toEqual(["1", "2", "3", "4", "5", "6", "7"].map((n) => [n, null]));
        expect([checkWord(), problemRows()]).toEqual(["Checks clean", []]);
    }, 30_000);

    test("a problem on line 3: its dot in the gutter, its range marked wavy, and the jq step around it dotted", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders\n| sort_by(-.total)\n| map(.totl)");
        expect(gutter()).toEqual([["1", null], ["2", null], ["3", "error"]]);
        expect(marked()).toEqual([["map", "note"], ["(", "note"], [".totl", "error"], [")", "note"]]);
        expect(checkWord()).toBe("1 problem");
        // A line ending and an empty last line are lines too.
        await type(".orders\n");
        expect(gutter().map(([n]) => n)).toEqual(["1", "2"]);
        expect(highlightLines().map((l) => l.textContent)).toEqual([".orders", ""]);
    }, 30_000);
});

// ─── J2 ──────────────────────────────────────────────────────────────────────

describe("the jq view (#937) — J2 completions", () => {
    test("`.` at the root lists the bound sources in plain words; a variant offers type and value; a string the case names", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".");
        expect(offered()).toEqual([
            ["ds", "customers", "Dict<String, Struct{name: String, region: String, tier: Variant{gold, standard}}>"],
            ["ds", "orders", "Array<Struct{customer_id: String, discount: Option<Float>, id: Integer, lines: Array<Struct{price: Float, qty: Integer, sku: String}>, status: Variant{cancelled, pending, shipped}, total: Float}>"],
        ]);
        expect(doc()).toBe("lookup table");
        await key("ArrowDown");
        expect(doc()).toBe("list of orders");
        await type(".orders[0].status.");
        expect(offered().map(([glyph, label]) => [glyph, label])).toEqual([[".f", "type"], [".f", "value"]]);
        await type(".orders | map(select(.status.type == \"");
        expect(offered().map(([glyph, label]) => [glyph, label])).toEqual([["cs", "cancelled"], ["cs", "pending"], ["cs", "shipped"]]);
    }, 30_000);

    test("a word lists the builtins, and takes `select(`; inside quotes a case does not double its closing quote", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders | map(sel");
        expect(offered()).toEqual([["fn", "select", "select(f)"]]);
        await key("Enter");
        expect([area().value, completions()]).toEqual([".orders | map(select(", null]);
        // Typed inside quotes, before the closing one: the case names that start with it.
        const text = ".orders | map(select(.status.type == \"sh\"))";
        const caret = text.indexOf("sh\"") + 2;
        await type(text, caret);
        expect(offered().map(([, label]) => label)).toEqual(["shipped"]);
        await key("Escape");
        expect(completions()).toBeNull();
        // Ctrl Space opens them again where the caret is.
        area().setSelectionRange(caret, caret);
        await key(" ", { code: "Space", ctrlKey: true });
        expect(offered().map(([, label]) => label)).toEqual(["shipped"]);
        await key("Tab");
        await settle();
        expect(area().value).toBe(".orders | map(select(.status.type == \"shipped\"))");
        expect(area().selectionStart).toBe(".orders | map(select(.status.type == \"shipped\"".length);
    }, 30_000);

    test("↓ ↑ wrap, Esc closes, and a click takes one", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders[0].status.");
        const active = () => completions()!.querySelector("[aria-selected=true] [data-label]")!.textContent;
        expect(active()).toBe("type");
        await key("ArrowUp");
        expect(active()).toBe("value");
        await key("ArrowDown");
        expect(active()).toBe("type");
        await key("Escape");
        expect(completions()).toBeNull();
        await type(".orders[0].sta");
        await act(async () => { fireEvent.click(completions()!.querySelector("[role=option]")!); });
        await settle();
        expect(area().value).toBe(".orders[0].status");
    }, 30_000);
});

/** The jq editor alone, its text its own, over the root and a builder's summaries. */
function Alone({ initial, summaries }: { initial: string; summaries: { cache: SummaryCache; hashes: ReadonlyMap<string, string> } }) {
    const [text, setText] = useState(initial);
    const ps = usePartStyles(useQueryWords());
    return (
        <JqEditor text={text} checked={checkJq(text, ROOT.type, { root: true })} root={ROOT} summaries={summaries} ps={ps}
            onText={setText} onLeave={() => {}} onFix={setText} />
    );
}

describe("the jq view (#937) — J2 the data's values", () => {
    test("inside `== \"` the values come from the summary the builder holds of the rows there; with none held, none, and nothing is fetched", async () => {
        const fetched: string[] = [];
        const cache = new SummaryCache(async (request) => {
            fetched.push(request.prefix);
            return { summary: evaluateJq(request.program, FIXTURE_VALUE, { inputType: FixtureType, root: true }) as Summary, hashes: new Map() };
        });
        const summaries = { cache, hashes: new Map<string, string>() };
        const text = ".orders\n| map(select(.customer_id == \"C0";
        render(<ChakraProvider value={system}><Alone initial=".orders" summaries={summaries} /></ChakraProvider>);
        await type(text);
        // No summary of the orders yet: no values, and none fetched.
        expect([completions(), fetched]).toEqual([null, []]);
        // The visual view's value slot fetched the orders' summary.
        const parsed = parseSteps(".orders", ROOT.type);
        if ("error" in parsed) throw new Error(parsed.error.message);
        await cache.ensure(summaryAt(parsed.query, 0, ROOT.type)!, summaries.hashes);
        area().setSelectionRange(text.length, text.length);
        await key(" ", { code: "Space", ctrlKey: true });
        expect(offered().map(([glyph, label]) => [glyph, label])).toEqual(["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"].map((c) => ["\"v", c]));
        expect(offered().every(([, , detail]) => /^\d+ in data$/.test(detail!))).toBe(true);
        expect(fetched).toEqual([".orders"]);
        await key("Enter");
        expect(area().value).toBe(".orders\n| map(select(.customer_id == \"C01\"");
    }, 30_000);
});

// ─── J3 ──────────────────────────────────────────────────────────────────────

describe("the jq view (#937) — J3 the problems panel", () => {
    test("codes, positions and the checker's sentences; a part that stays a jq step, noted; going to one selects its range", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        const text = ".orders\n| sort_by(-.total)\n| map(.totl)";
        await type(text);
        expect(problemRows()).toEqual([
            ["unknown field", "L3:7", expect.stringMatching(/^unknown_field: \.totl is not a field of Struct\{.*\}\. Did you mean \.total\?$/)],
            ["note", "L3:3", "custom: not a visual step; it stays as jq in the visual editor."],
        ]);
        expect([checkWord(), within(rowOf("unknown_field")).getAllByRole("button").map((b) => b.textContent).slice(1)]).toEqual(["1 problem", ["Use .total"]]);
        await act(async () => { fireEvent.click(rowOf("unknown_field").querySelector("button")!); });
        expect([area().selectionStart, area().selectionEnd]).toEqual([text.indexOf(".totl"), text.indexOf(".totl") + 5]);
        expect([...document.querySelectorAll("[data-query-jq-highlight] [data-active]")].map((t) => t.textContent)).toEqual([".totl"]);
    }, 30_000);

    test("each fix makes a program that checks clean, the caret after it: Use .total, Narrow first, Use any(.lines[]; …)", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        const fixes: readonly (readonly [string, string, string, string])[] = [
            [".orders\n| sort_by(-.total)\n| map(.totl)", "unknown_field", "Use .total", ".orders\n| sort_by(-.total)\n| map(.total)"],
            [".orders | map(.status.value.date | year)", "type_mismatch", "Narrow first", ".orders | map(select(.status.type == \"shipped\") | .status.value.date | year)"],
            [".orders | map(select(.lines[].sku == \"BRK-100\"))", "duplicate_outputs", "Use any(.lines[]; …)", ".orders | map(select(any(.lines[]; .sku == \"BRK-100\")))"],
        ];
        for (const [before, code, label, after] of fixes) {
            await type(before);
            expect(checkWord()).not.toBe("Checks clean");
            await press(label, rowOf(code));
            expect([area().value, checkWord()]).toEqual([after, "Checks clean"]);
            const edited = [...after].findIndex((c, i) => c !== before[i]);
            expect(area().selectionStart).toBeGreaterThan(edited);
        }
    }, 30_000);

    test("a fix is a gesture of its own: Undo returns the jq as it was typed", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders\n| sort_by(-.total)\n| map(.totl)");
        await press("Use .total", rowOf("unknown_field"));
        expect(area().value).toBe(".orders\n| sort_by(-.total)\n| map(.total)");
        await press("Undo");
        expect(area().value).toBe(".orders\n| sort_by(-.total)\n| map(.totl)");
        await press("Undo");
        expect(area().value).toBe(".orders\n| map(select(.total >= 1000))");
    }, 30_000);
});

// ─── J4 ──────────────────────────────────────────────────────────────────────

describe("the jq view (#937) — J4 one gesture, and the keys", () => {
    test("the jq typed and left is one transaction: Undo restores the jq before it", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders\n| map(select(.total >= 2000))");
        await leave();
        await press("Undo");
        expect(area().value).toBe(".orders\n| map(select(.total >= 1000))");
        await press("Redo");
        expect(area().value).toBe(".orders\n| map(select(.total >= 2000))");
    }, 30_000);

    test("⌘⏎ runs the jq as typed, left first; Tab inserts two spaces", async () => {
        const offline = offlineCall();
        await mountBuilder(offline.call);
        await openJq(BIG.name);
        await type(".orders | length");
        await key("Enter", { metaKey: true });
        await settle();
        // Opening the query ran it (#938); ⌘⏎ runs it again: two calls, each with a run's limits, its time limit the server's (#1131).
        const runLimits = some({ timeoutMs: none, maxResultBytes: some(1_048_576n), maxLogBytes: none });
        expect(offline.requests.map((r) => r.limits)).toEqual([runLimits, runLimits]);
        await press("Undo");
        expect(area().value).toBe(".orders\n| map(select(.total >= 1000))");
        area().setSelectionRange(0, 0);
        await key("Tab");
        await settle();
        expect([area().value, area().selectionStart]).toEqual(["  .orders\n| map(select(.total >= 1000))", 2]);
    }, 30_000);

    test("the completions close when the caret moves, and on blur", async () => {
        await mountBuilder(offlineCall().call);
        await openJq(BIG.name);
        await type(".orders[0].");
        expect(completions()).not.toBeNull();
        // A click moves the caret.
        await act(async () => {
            area().focus();
            area().setSelectionRange(0, 0);
            fireEvent.mouseUp(area());
        });
        expect(completions()).toBeNull();
        await type(".orders[1].");
        expect(completions()).not.toBeNull();
        await leave();
        expect(completions()).toBeNull();
    }, 30_000);
});

// ─── Another query opened while it shows one ─────────────────────────────────

/** Two programs that are not steps — neither starts from a data source — so each shows as jq. */
const IDS_PROGRAM = "[.orders[] | select(.total >= 1000) | .id]";
const NAMES_PROGRAM = "[.customers[] | .name]";
const IDS = savedQuery("Big order ids", IDS_PROGRAM);
const NAMES = savedQuery("Customer names", NAMES_PROGRAM);

/** The view the Query tab shows. */
const viewShown = () => document.querySelector<HTMLElement>("[data-query-view]")!.getAttribute("data-query-view");
/** The save state the status line shows. */
const saveState = () => document.querySelector<HTMLElement>("[data-query-save]")!.getAttribute("data-query-save");
/** The results footer's fields. */
const resultFields = () => document.querySelector<HTMLElement>("[data-query-result-fields]")?.textContent ?? "";
/** What a one-shot call answered: its value, decoded. */
function answered(answer: ExecuteResult): unknown {
    if (answer.outcome.type !== "success") throw new Error(`the call answered ${answer.outcome.type}`);
    return decodeBeast2(answer.outcome.value.value).value;
}

describe("the jq view (#937) — another query opened while it shows one (#1132)", () => {
    test("a query that is not steps opened while the jq view shows another: its own jq from the start, which the run opening it runs, and no draft left on it", async () => {
        recordHarness(savedRecord([TOP, BIG, IDS, NAMES]));
        const one = fixtureCall();
        await mountBuilder(one.call, { query: IDS.name });
        expect([viewShown(), area().value]).toEqual(["jq", IDS_PROGRAM]);
        await openQuery(variant("saved", NAMES.name));
        expect([viewShown(), area().value]).toEqual(["jq", NAMES_PROGRAM]);
        // Two runs, each its own query's: the customers' names, not the big orders' ids again.
        expect(one.requests).toHaveLength(2);
        const ids = evaluateJq(IDS_PROGRAM, FIXTURE_VALUE, { inputType: FixtureType, root: true });
        const names = evaluateJq(NAMES_PROGRAM, FIXTURE_VALUE, { inputType: FixtureType, root: true });
        expect(equalFor(ArrayType(IntegerType))(answered(one.answers[0]!) as never, ids as never)).toBe(true);
        expect(equalFor(ArrayType(StringType))(answered(one.answers[1]!) as never, names as never)).toBe(true);
        // Nothing drafted on the query opened: nothing to undo, and saved as it was.
        expect([enabled("Undo"), saveState()]).toEqual([false, "saved"]);
    }, 30_000);

    test("a query of steps opened while the jq view shows another: the visual view, its own program run as it opens, and no draft left on it", async () => {
        const one = fixtureCall();
        await mountBuilder(one.call);
        await openJq(BIG.name);
        expect(viewShown()).toBe("jq");
        await openQuery(variant("saved", TOP.name));
        expect(viewShown()).toBe("visual");
        // Opening each ran it: the big orders, then the top shipped orders with their own fields.
        expect(one.requests).toHaveLength(2);
        expect(resultFields()).toBe("· order, customer, region, total, shipped");
        expect([enabled("Undo"), saveState()]).toEqual([false, "saved"]);
    }, 30_000);
});
