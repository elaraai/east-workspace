/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The footer's loading line makes its styles as its rail is drawn, ahead of the
 * read that first shows it (#1594): a rule first added to the page's styles as
 * a line shows has the page's styles worked out again in that frame — in the
 * middle of the zoom, the pan or the drag whose read it tells of. Made as the
 * line first showed, a builder's first slow read added them mid-gesture, and
 * the checks that hold a gesture to adding no rule passed or failed by how long
 * a read took.
 *
 * A file of its own: the page's styles are the file's, so no line another test
 * showed has made them already.
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../../theme/index.js";
import { LoadingLine, type LoadingLineValue } from "./loading-line.js";

afterEach(cleanup);

/** How many rules the page's styles hold. */
const rules = (): number => [...document.styleSheets].reduce((n, sheet) => n + sheet.cssRules.length, 0);

const LOADING: LoadingLineValue = { kind: "loading", text: ["Loading work orders ", { strong: "8,301–8,500" }], short: "Loading…" };
const BUSY: LoadingLineValue = { kind: "busy", text: ["Optimising ", { strong: "W11" }], short: "Optimising…", aside: " 7 s" };
const FAILED: LoadingLineValue = { kind: "failed", text: ["Couldn't read ", { strong: "12–18 Mar" }], short: "Couldn't read", reason: "the server took too long", onRetry: () => undefined };

test("a line shown for the first time adds no rule to the page's styles: every part it draws — its dot, its words and their strong ink, its short form, a run's seconds, a failure's reason and Retry, the copies the fit measures — has its styles from the idle line's first draw", () => {
    const view = render(<ChakraProvider value={system}><LoadingLine value={undefined} shown={false} form="full" /></ChakraProvider>);
    const idle = rules();
    expect(idle).toBeGreaterThan(0);
    for (const [what, value, form] of [["a read", LOADING, "full"], ["a read, short", LOADING, "short"], ["a run", BUSY, "full"], ["a failure", FAILED, "full"], ["a failure, its dot", FAILED, "dot"]] as const) {
        view.rerender(<ChakraProvider value={system}><LoadingLine value={value} shown form={form} /></ChakraProvider>);
        expect(document.querySelector("[data-footer-line]")!.hasAttribute("data-idle"), what).toBe(false);
        expect(rules(), what).toBe(idle);
    }
});
