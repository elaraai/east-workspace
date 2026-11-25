/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A cell's chips on one line (east-workspace#1741), over a layout the test
 * gives — jsdom lays nothing out: the members past the line's room fold into
 * `+n`, whose hover names each as its cell prints it, a counted member with
 * its count; a member alone wider than its line, which is shortened, says its
 * whole words on hover, where its half would say only which half it is; and a
 * line that wraps, Details', folds none.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import type { SheetMemberValue } from "../values.js";
import { LinkHalfView } from "./LinkCell.js";

/** Each part's width as the test lays it out, by its slot: a line with room for one chip and the `+n`. */
const ROOMY: Readonly<Record<string, number>> = { chipLine: 75, chip: 50, chipMore: 20 };
let WIDTHS = ROOMY;

beforeEach(() => {
    WIDTHS = ROOMY;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const width = WIDTHS[this.getAttribute("data-slot") ?? ""] ?? 0;
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 14, width, height: 14, toJSON: () => ({}) } as DOMRect;
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const identified = (key: string): SheetMemberValue => variant("identified", { key });
const counted = (n: bigint, key: string): SheetMemberValue => variant("counted", { n, key });
const LIVE = { live: true, lock: "" };

/** A link's destination half over the members, as its cell draws it — or as Details does, wrapping. */
function halfOf(members: readonly SheetMemberValue[], wrap?: boolean) {
    return render(
        <ChakraProvider value={system}>
            <LinkHalfView styles={{}} half="to" members={members} state={LIVE} vocab={undefined} flags={[]} ghost={false} driverName={undefined} wrap={wrap} />
        </ChakraProvider>,
    ).container;
}

describe("a cell's chips on one line (east-workspace#1741)", () => {
    test("a counted member folded into +n is named in its hover with its count, as its cell prints it", () => {
        const half = halfOf([identified("R2140"), counted(4n, "CNC router")]);
        expect([...half.querySelectorAll('[data-slot="chipText"]')].map((el) => el.textContent)).toEqual(["R2140"]);
        const more = half.querySelector('[data-slot="chipMore"]');
        expect([more?.textContent, more?.getAttribute("title")]).toEqual(["+1", "4 × CNC router"]);
    });

    test("a member alone wider than its line is shortened, and its hover says its whole words, a counted one with its count; one that fits says none of its own", () => {
        // A line 40 wide under a chip of 50: the chip shows alone, cut to its line.
        WIDTHS = { chipLine: 40, chip: 50, chipMore: 20 };
        const cut = halfOf([counted(1n, "edge bander")]).querySelector('[data-slot="chipLine"]');
        expect([cut?.hasAttribute("data-alone"), cut?.getAttribute("title")]).toEqual([true, "1 × edge bander"]);
        cleanup();
        WIDTHS = ROOMY;
        const whole = halfOf([counted(1n, "edge bander")]).querySelector('[data-slot="chipLine"]');
        expect([whole?.hasAttribute("data-alone"), whole?.getAttribute("title")]).toEqual([false, null]);
    });

    test("a line that wraps — Details' — draws every member and folds none, whatever its room", () => {
        const half = halfOf([identified("R2140"), counted(4n, "CNC router"), identified("R2141")], true);
        expect([...half.querySelectorAll('[data-slot="chipText"]')].map((el) => el.textContent)).toEqual(["R2140", "CNC router", "R2141"]);
        expect(half.querySelector('[data-slot="chipMore"]')).toBeNull();
        expect(half.querySelector('[data-slot="chipLine"]')?.hasAttribute("data-wrap")).toBe(true);
    });
});
