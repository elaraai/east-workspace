/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A tile's height on the canvas (`natural.ts`): a height is the frame's, a
 * stretched tile's the least it takes; and its content's own height is read
 * with the frame's height let go, whatever it stands at, and put back.
 */

import { afterEach, describe, expect, test } from "vitest";
import { LEAST_HEIGHT, contentHeight, frameHeight } from "./natural.js";

/**
 * A frame laid out as a browser would: at its height; held to a least height,
 * at its row's 480; and — its height `auto`, its least height and its mark let
 * go — at its content's 212.
 */
function frameAt(style: { height?: string; minHeight?: string }, least = false): HTMLElement {
    const frame = document.createElement("div");
    frame.style.height = style.height ?? "";
    frame.style.minHeight = style.minHeight ?? "";
    if (least) frame.setAttribute(LEAST_HEIGHT, "");
    Object.defineProperty(frame, "offsetHeight", {
        configurable: true,
        get: () => (frame.style.height === "auto" && frame.style.minHeight === "0px" && !frame.hasAttribute(LEAST_HEIGHT) ? 212
            : frame.style.height.endsWith("px") ? Number.parseFloat(frame.style.height) : 480),
    });
    document.body.append(frame);
    return frame;
}

afterEach(() => { document.body.replaceChildren(); });

describe("how a tile's frame takes its height", () => {
    test("a tile with no height of its own has none, stretched or not", () => {
        expect(frameHeight(undefined, false)).toEqual({ style: undefined, least: false });
        expect(frameHeight(null, true)).toEqual({ style: undefined, least: false });
    });

    test("a tile's height is its frame's", () => {
        expect(frameHeight(240, false)).toEqual({ style: { height: "240px" }, least: false });
    });

    test("a stretched tile's height is the least it takes: its row's height is its own", () => {
        expect(frameHeight(240, true)).toEqual({ style: { minHeight: "240px" }, least: true });
    });
});

describe("a tile's content's own height", () => {
    test("is its content's, not the height it has been given: a tile set to 480 reads 212, and stays set to 480", () => {
        const frame = frameAt({ height: "480px" });
        expect(contentHeight(frame)).toBe(212);
        expect([frame.style.height, frame.style.minHeight, frame.hasAttribute(LEAST_HEIGHT)]).toEqual(["480px", "", false]);
    });

    test("is its content's where its row stretches it: a frame with no height of its own, standing at its row's 480, reads 212 and keeps none", () => {
        const frame = frameAt({});
        expect(frame.offsetHeight).toBe(480);
        expect(contentHeight(frame)).toBe(212);
        expect([frame.style.height, frame.style.minHeight, frame.hasAttribute(LEAST_HEIGHT)]).toEqual(["", "", false]);
    });

    test("is its content's where it is held to a least height: its least height and its mark are let go for the read, and put back", () => {
        const frame = frameAt({ minHeight: "240px" }, true);
        expect(frame.offsetHeight).toBe(480);
        expect(contentHeight(frame)).toBe(212);
        expect([frame.style.height, frame.style.minHeight, frame.hasAttribute(LEAST_HEIGHT)]).toEqual(["", "240px", true]);
    });
});
