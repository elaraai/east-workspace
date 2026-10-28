/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The mount harness lets go of what a test's spies recorded once the test
 * ends (`e3-web-mount.test-utils.tsx`): vitest keeps every spy a file makes
 * until the file ends, and restoring one keeps its calls, each with the
 * element it was called on — which reaches the whole page the test drew, and
 * what React drew it from. Kept, the harness's measures, new each test, held
 * every page a file had drawn, and the Calendar's records file passed 4 GiB.
 */
import { describe, expect, test, vi, type MockInstance } from "vitest";
import { render } from "@testing-library/react";
import { e3Harness } from "./e3-web-mount.test-utils.js";

e3Harness({});

/** The spies the first test made calls through: the harness's measure, and one of the test's own. */
let recorded: readonly MockInstance[] | undefined;

describe("what a test's spies recorded goes with the test", () => {
    test("while it runs, the harness's measure and a spy of its own record each call, with the element it was called on", () => {
        const { container } = render(<div data-builder-main="" />);
        const main = container.querySelector<HTMLElement>("[data-builder-main]")!;
        const own = vi.spyOn(HTMLElement.prototype, "focus");
        main.getBoundingClientRect();
        main.focus();
        const measure = vi.mocked(Element.prototype.getBoundingClientRect);
        expect(measure.mock.contexts).toContain(main);
        expect(own.mock.contexts).toContain(main);
        recorded = [measure, own];
    });

    test("once it has ended, neither holds a call it recorded: no element of its page, no argument and no answer", () => {
        if (recorded === undefined) throw new Error("the test before makes the calls this one checks: run the two together");
        for (const spy of recorded) {
            expect(spy.mock.calls).toEqual([]);
            expect(spy.mock.contexts).toEqual([]);
            expect(spy.mock.results).toEqual([]);
        }
    });
});
