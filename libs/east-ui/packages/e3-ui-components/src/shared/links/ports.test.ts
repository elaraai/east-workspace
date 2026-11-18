/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ports' case table (#1680's review): links at a shared end stacked
 * about its centre line, 2px apart, by where their other ends lie.
 */

import { describe, test, expect } from "vitest";
import { linkPorts, portSize, type LinkPort } from "./ports.js";

/** An end at J-4693, centred on 100: its exit, or its entry. */
const at = (side: "exit" | "entry", size: number, other: number): LinkPort => ({ at: `J-4693|${side}`, centre: 100, size, other });

describe("linkPorts — a shared end's ports (#1680's review)", () => {
    test("a lone link meets its element on its centre line", () => {
        expect(linkPorts([at("exit", 8, 40)])).toEqual([100]);
    });

    test("l3 and l6, two links of weight 8, out of J-4693's end: c − 5 and c + 5, the one to the higher row first", () => {
        // l6 is listed first, its other end lower down the page: it takes the lower port.
        expect(linkPorts([at("exit", portSize(8, "exit"), 300), at("exit", portSize(8, "exit"), 20)])).toEqual([105, 95]);
    });

    test("l2 and l5, two heads 8 wide (weight 4), into J-4693's start: c − 5 and c + 5", () => {
        expect(linkPorts([at("entry", portSize(4, "entry"), 10), at("entry", portSize(4, "entry"), 250)])).toEqual([95, 105]);
    });

    test("an end's exits and its entries are separate stacks, and so are two elements' ends", () => {
        const ports = [at("exit", 6, 20), at("exit", 6, 300), at("entry", 8, 10), { at: "J-4723|exit", centre: 40, size: 6, other: 100 }];
        // Two exits of 6: a stack 14 tall. The entry is alone on its start, and the other element's exit on its end.
        expect(linkPorts(ports)).toEqual([96, 104, 100, 40]);
    });

    test("three ports of mixed sizes stack 2 apart, about the centre, in their other ends' order; level other ends keep the order given", () => {
        // Sizes 6, 2 and 4 in that order: T = 12 + 4 = 16, from 92.
        const ports = [at("exit", 6, 50), at("exit", 2, 50), at("exit", 4, 400)];
        expect(linkPorts(ports)).toEqual([95, 101, 106]);
    });

    test("a port's size: a link's weight leaving an end, its head's width — max(8, 2 × weight) — entering a start", () => {
        expect([portSize(1.5, "exit"), portSize(6, "exit"), portSize(2, "entry"), portSize(6, "entry")]).toEqual([1.5, 6, 8, 12]);
    });
});
