/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What every library of cards over its slice shares (#1761, #1762): its
 * gallery's one size and its one fact, the tags; the mark of the row its host
 * says is open; and New, the brand's solid button — its words, or its plus
 * alone, named by them, and a caret where it opens a menu. The gallery over a
 * slice's source, its rail and the rail's one chosen value are measured by the
 * query library's and the page library's own tests, which mount them on e3.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import type { RecordSliceEntry } from "@elaraai/east-ui/internal";
import { system } from "@elaraai/east-ui-components";
import { markOf } from "@elaraai/east-ui-components/testing";
import { LibraryNewButton, libraryCardMarks, libraryGallery, rowsOnce } from "./slice-gallery.js";

afterEach(() => { cleanup(); });

describe("a library of cards (#1761, #1762)", () => {
    test("its gallery: every card 300px at least and 224px tall, showing its row's tags; what the host draws of a row is the host's", () => {
        const onOpen = vi.fn();
        const item = vi.fn();
        const gallery = libraryGallery<string>({ item, onOpen });
        expect([gallery.least, gallery.cardPx, gallery.dims]).toEqual([300, 224, ["tags"]]);
        expect([gallery.item, gallery.onOpen, gallery.media, gallery.extras, gallery.clicks]).toEqual([item, onOpen, undefined, undefined, undefined]);
    });

    test("a page's entries made rows once each (east-workspace#1779): the same entry read again is the same row, made once; another entry its own; one that is none, none", () => {
        const decode = vi.fn((entry: RecordSliceEntry) => (entry.row?.type === "some" ? { entry } : undefined));
        const rowOf = rowsOnce(decode);
        const first: RecordSliceEntry = { ik: variant("by_name", "fir"), key: "fir", row: some({ name: "fir" }) };
        const second: RecordSliceEntry = { ik: variant("by_name", "tall"), key: "tall", row: some({ name: "tall" }) };
        const bare: RecordSliceEntry = { ik: variant("by_name", "stump"), key: "stump", row: none };
        const row = rowOf(first);
        expect(rowOf(first)).toBe(row);
        expect(rowOf(second)).not.toBe(row);
        expect([rowOf(bare), rowOf(bare)]).toEqual([undefined, undefined]);
        expect(decode).toHaveBeenCalledTimes(3);
    });

    test("a card's marks: the row its host says is open placed, its status the word in the info tone; its tags chips in their order; none of either otherwise", () => {
        const open = libraryCardMarks(true, "Open", ["sales", "weekly"]);
        expect(open.placed).toBe(true);
        expect(open.status).toEqual(some({ label: "Open", tone: variant("info", null), ring: false }));
        expect([...open.dims]).toEqual([["tags", variant("chips", ["sales", "weekly"])]]);
        const shut = libraryCardMarks(false, "Open", []);
        expect([shut.placed, shut.status, [...shut.dims]]).toEqual([false, none, []]);
    });

    test("New: its plus and its words, the brand's solid button; folded, the plus alone, named by its words; a caret where it opens a menu; it takes what its host hands it", () => {
        const onClick = vi.fn();
        render(
            <ChakraProvider value={system}>
                <LibraryNewButton label="New page in Ops console" labelled data-test-new="full" onClick={onClick} />
                <LibraryNewButton label="New page in Ops console" labelled={false} data-test-new="compact" />
                <LibraryNewButton label="New query" labelled caret data-test-new="menu" />
            </ChakraProvider>,
        );
        const [full, compact, menu] = ["full", "compact", "menu"].map((form) => document.querySelector<HTMLButtonElement>(`[data-test-new="${form}"]`)!);
        expect([markOf(full!), full!.getAttribute("aria-label"), full!.getAttribute("type")]).toEqual(["fas plus New page in Ops console", null, "button"]);
        expect([markOf(compact!), compact!.getAttribute("aria-label"), compact!.getAttribute("title")]).toEqual(["fas plus", "New page in Ops console", "New page in Ops console"]);
        expect(markOf(menu!)).toBe("fas plus fas caret-down New query");
        // Both forms are buttons of the one name: the folded one by its label, as a screen reader says it.
        expect(screen.getAllByRole("button", { name: "New page in Ops console" })).toEqual([full, compact]);
        fireEvent.click(full!);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
