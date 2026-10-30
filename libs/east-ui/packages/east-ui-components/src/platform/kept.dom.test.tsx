/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 */

/**
 * Kept state — read before the first draw, written before the task ends, read
 * defensively, never thrown, scoped and cleared, one value a key in a page —
 * against jsdom's own storages and address.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import {
    NOT_KEPT, clearKept, kept, keptBytes, keptFlag, keptJson, keptRead, keptReachable, keptText, onClearKept,
    onKeptFailure, resetKept, setKeptScope, useKept, type KeptFailure,
} from "./kept.js";

/** The task's queued writes, done: what a reload would find. */
const endOfTask = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

beforeEach(() => {
    resetKept();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("kept state", () => {
    test("a value written is read back after a reload, before anything draws", async () => {
        kept("plan.zoom", keptText).write("month");
        await endOfTask();
        resetKept();
        expect(kept("plan.zoom", keptText).read()).toBe("month");
    });

    test("a write reaches storage before its task ends, once however often it changed in the task", async () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const zoom = kept("plan.zoom", keptText);
        zoom.write("week");
        zoom.write("month");
        zoom.write("year");
        expect(zoom.read()).toBe("year");
        expect(setItem).not.toHaveBeenCalled();
        await endOfTask();
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem("east/s//plan.zoom")).toBe("year");
    });

    test("tab state is the tab's session storage; browser state the origin's", async () => {
        kept("a", keptText, { where: "tab" }).write("tab");
        kept("a", keptText).write("browser");
        await endOfTask();
        expect(window.sessionStorage.getItem("east/s//a")).toBe("tab");
        expect(window.localStorage.getItem("east/s//a")).toBe("browser");
    });

    test("text this version does not read is removed, reported, and read as nothing kept", () => {
        const failures: KeptFailure[] = [];
        onKeptFailure((failure) => failures.push(failure));
        window.localStorage.setItem("east/s//tabs", "{not json");
        const tabs = kept("tabs", keptJson(keptRead.record<{ tab: string }>({ tab: keptRead.string })));
        expect(tabs.read()).toBeUndefined();
        expect(window.localStorage.getItem("east/s//tabs")).toBeNull();
        expect(failures).toEqual([{ key: "tabs", where: "browser", reason: "unreadable" }]);
    });

    test("a full storage keeps the page's value, says why, and reports it once", async () => {
        const failures: KeptFailure[] = [];
        onKeptFailure((failure) => failures.push(failure));
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
        const zoom = kept("plan.zoom", keptText);
        zoom.write("month");
        await endOfTask();
        zoom.write("year");
        await endOfTask();
        expect(zoom.read()).toBe("year");
        expect(zoom.failure()).toBe("full");
        expect(failures).toEqual([{ key: "plan.zoom", where: "browser", reason: "full" }]);
    });

    test("a write that lands after a failure clears it", async () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
        onKeptFailure(() => undefined);
        const zoom = kept("plan.zoom", keptText);
        let heard = 0;
        zoom.subscribe(() => { heard++; });
        zoom.write("month");
        await endOfTask();
        expect(zoom.failure()).toBe("full");
        zoom.write("year");
        await endOfTask();
        expect(zoom.failure()).toBeUndefined();
        expect(setItem).toHaveBeenCalledTimes(2);
        expect(heard).toBe(4);
    });

    test("storage the page cannot reach throws nothing: the page's value stands", async () => {
        onKeptFailure(() => undefined);
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
        expect(keptReachable("browser")).toBe(false);
        const zoom = kept("plan.zoom", keptText);
        expect(zoom.read()).toBeUndefined();
        zoom.write("month");
        await endOfTask();
        expect(zoom.read()).toBe("month");
        expect(zoom.failure()).toBe("unavailable");
    });

    test("a value its codec cannot write is unwritable, and the page's value stands", async () => {
        onKeptFailure(() => undefined);
        const counts = kept("counts", keptJson<unknown>((stored) => stored));
        counts.write({ n: 1n });
        await endOfTask();
        expect(counts.failure()).toBe("unwritable");
        expect(counts.read()).toEqual({ n: 1n });
    });

    test("another scope's keys are other keys", async () => {
        setKeptScope("person-a");
        kept("plan.zoom", keptText).write("month");
        await endOfTask();
        setKeptScope("person-b");
        expect(kept("plan.zoom", keptText).read()).toBeUndefined();
        setKeptScope("person-a");
        expect(kept("plan.zoom", keptText).read()).toBe("month");
    });

    test("clearing removes every scoped key of every scope, page and storage, keeps the device's, and clears the other stores", async () => {
        setKeptScope("person-a");
        const zoom = kept("plan.zoom", keptText);
        zoom.write("month");
        kept("draft", keptText, { where: "tab" }).write("held");
        kept("color-mode", keptText, { scoped: false }).write("dark");
        await endOfTask();
        setKeptScope("person-b");
        kept("plan.zoom", keptText).write("year");
        await endOfTask();
        window.localStorage.setItem("someone-else", "theirs");
        let cleared = 0;
        onClearKept(() => { cleared++; });
        let heard = 0;
        zoom.subscribe(() => { heard++; });

        clearKept();
        await endOfTask();

        const left = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();
        expect(left(window.localStorage)).toEqual(["east/d/color-mode", "someone-else"]);
        expect(left(window.sessionStorage)).toEqual([]);
        expect(kept("plan.zoom", keptText).read()).toBeUndefined();
        expect(kept("color-mode", keptText, { scoped: false }).read()).toBe("dark");
        expect(cleared).toBe(1);
        // The handle reads the scope it is read under: the second person's value, cleared.
        expect(heard).toBe(1);
    });

    test("an address is rewritten at most every 350 ms, with the latest value, and is never scoped", () => {
        vi.useFakeTimers();
        setKeptScope("person-a");
        const replace = vi.spyOn(window.history, "replaceState");
        const search = kept("slice.works", keptText, { where: "url" });
        for (const value of ["a", "b", "c"]) search.write(value);
        expect(replace).not.toHaveBeenCalled();
        vi.advanceTimersByTime(349);
        expect(replace).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(replace).toHaveBeenCalledTimes(1);
        expect(new URLSearchParams(window.location.search).get("slice.works")).toBe("c");
        search.write("d");
        vi.advanceTimersByTime(350);
        expect(new URLSearchParams(window.location.search).get("slice.works")).toBe("d");
        search.remove();
        vi.advanceTimersByTime(350);
        expect(new URLSearchParams(window.location.search).has("slice.works")).toBe(false);
    });

    test("a component draws what was kept on its first render, and every component of the key hears a write", async () => {
        kept("sheet.pane", keptFlag).write(true);
        await endOfTask();
        resetKept();
        const draws: boolean[] = [];
        function Pane({ id }: { id: string }) {
            const [collapsed, setCollapsed] = useKept("sheet.pane", keptFlag, false);
            if (id === "a") draws.push(collapsed);
            return <button data-testid={id} onClick={() => setCollapsed((current) => !current)}>{collapsed ? "collapsed" : "open"}</button>;
        }
        render(<><Pane id="a" /><Pane id="b" /></>);
        expect(draws[0]).toBe(true);
        act(() => { screen.getByTestId("b").click(); });
        expect(screen.getByTestId("a").textContent).toBe("open");
        expect(screen.getByTestId("b").textContent).toBe("open");
        await endOfTask();
        expect(window.localStorage.getItem("east/s//sheet.pane")).toBe("false");
    });

    test("another tab's write moves nothing here: a reload reads it", async () => {
        const zoom = kept("plan.zoom", keptText);
        zoom.write("month");
        await endOfTask();
        window.localStorage.setItem("east/s//plan.zoom", "year");
        window.dispatchEvent(new StorageEvent("storage", { key: "east/s//plan.zoom", newValue: "year" }));
        expect(zoom.read()).toBe("month");
        resetKept();
        expect(kept("plan.zoom", keptText).read()).toBe("year");
    });
});

describe("kept codecs and readers", () => {
    test("bytes round-trip as base64url, and text that is no base64url reads as nothing", () => {
        const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
        const text = keptBytes.encode(bytes);
        expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(keptBytes.decode(text)).toEqual(bytes);
        expect(keptBytes.decode("not base64!")).toBeUndefined();
    });

    test("a flag is read only as true or false", () => {
        expect(keptFlag.decode("true")).toBe(true);
        expect(keptFlag.decode("false")).toBe(false);
        expect(keptFlag.decode("yes")).toBeUndefined();
    });

    test("readers take only the shape this version writes", () => {
        type Toolbar = { tab: string; density: "compact" | "comfortable"; widths: [string, number][]; anchor?: { key: string; offset: number } | undefined; pick: string[] | null };
        const read = keptRead.record<Toolbar>({
            tab: keptRead.string,
            density: keptRead.oneOf("compact", "comfortable"),
            widths: keptRead.array(keptRead.pair(keptRead.string, keptRead.number)),
            anchor: keptRead.optional(keptRead.record({ key: keptRead.string, offset: keptRead.number })),
            pick: keptRead.nullable(keptRead.array(keptRead.string)),
        });
        expect(read({ tab: "a", density: "compact", widths: [["x", 1]], pick: null, extra: 1 })).toEqual({ tab: "a", density: "compact", widths: [["x", 1]], pick: null });
        expect(read({ tab: "a", density: "compact", widths: [], anchor: { key: "r", offset: 3 }, pick: ["s"] })).toEqual({ tab: "a", density: "compact", widths: [], anchor: { key: "r", offset: 3 }, pick: ["s"] });
        expect(read({ tab: "a", density: "dense", widths: [], pick: null })).toBe(NOT_KEPT);
        expect(read({ tab: "a", density: "compact", widths: [["x", "1"]], pick: null })).toBe(NOT_KEPT);
        expect(read({ tab: "a", density: "compact", widths: [], anchor: { key: "r" }, pick: null })).toBe(NOT_KEPT);
        expect(read({ tab: "a", density: "compact", widths: [] })).toBe(NOT_KEPT);
        expect(read(["a"])).toBe(NOT_KEPT);
        expect(keptRead.number(Number.NaN)).toBe(NOT_KEPT);
    });

    test("JSON is read through its reader", () => {
        const codec = keptJson(keptRead.array(keptRead.string));
        expect(codec.decode(codec.encode(["a", "b"]))).toEqual(["a", "b"]);
        expect(codec.decode("[1]")).toBeUndefined();
        expect(codec.decode("{")).toBeUndefined();
    });
});
