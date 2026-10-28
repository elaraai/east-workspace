/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The one chain every builder reads its sources by (`each-source.tsx`): each
 * source read in a component of its own, in order — its hooks keeping their
 * state whatever the number of sources a payload names around it — and what
 * renders with the reads handed each, in the sources' order, again only as a
 * read is another value.
 */

import { useEffect, useState, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { EachSource } from "./each-source.js";

/** What each source's read sets its count by, once it has rendered: by the source. */
const counters = new Map<string, (n: number) => void>();

/**
 * A source's read: a count of its own, kept in its component, and the context every read is given.
 *
 * @param source - The source
 * @param context - What every source's read is given
 * @returns What it read: the context, the source and its count
 */
function useCounted(source: string, context: string): string {
    const [n, setN] = useState(0);
    useEffect(() => { counters.set(source, setN); }, [source]);
    return `${context}:${source}${n}`;
}

/** Each set of reads the chain handed on, in order. */
const handed: (readonly string[])[] = [];

/** What renders with the reads: the same function every render, as a builder's is. */
const show = (read: readonly string[]): ReactNode => {
    handed.push(read);
    return <span data-read={read.join(",")} />;
};

/** The host the chain is in: what renders it again, with the sources it names. */
let renderAgain: () => void = () => {};

function Host({ sources }: { sources: readonly string[] }) {
    const [, setTick] = useState(0);
    useEffect(() => { renderAgain = () => setTick((n) => n + 1); }, []);
    return <EachSource sources={sources} context="rail" read={useCounted}>{show}</EachSource>;
}

const readOf = (container: HTMLElement) => container.querySelector("[data-read]")?.getAttribute("data-read");

describe("EachSource", () => {
    test("each source is read in a component of its own, in order, and what renders is handed every read in the sources' order", () => {
        handed.length = 0;
        const { container } = render(<Host sources={["a", "b", "c"]} />);
        expect(readOf(container)).toBe("rail:a0,rail:b0,rail:c0");
        expect(handed).toEqual([["rail:a0", "rail:b0", "rail:c0"]]);
    });

    test("a host rendering again with reads that hold renders nothing under them; a read that moves hands every read on again", () => {
        handed.length = 0;
        const sources = ["a", "b"];
        const { container } = render(<Host sources={sources} />);
        expect(handed).toHaveLength(1);
        act(() => { renderAgain(); });
        expect(handed).toHaveLength(1);
        act(() => { counters.get("b")!(1); });
        expect(handed).toHaveLength(2);
        expect(readOf(container)).toBe("rail:a0,rail:b1");
    });

    test("a source named after the others keeps their reads' state: each source's hooks hold their order in their own component", () => {
        handed.length = 0;
        const { container, rerender } = render(<Host sources={["a", "b"]} />);
        act(() => { counters.get("a")!(2); counters.get("b")!(3); });
        expect(readOf(container)).toBe("rail:a2,rail:b3");
        rerender(<Host sources={["a", "b", "c"]} />);
        expect(readOf(container)).toBe("rail:a2,rail:b3,rail:c0");
        rerender(<Host sources={["a"]} />);
        expect(readOf(container)).toBe("rail:a2");
    });
});
