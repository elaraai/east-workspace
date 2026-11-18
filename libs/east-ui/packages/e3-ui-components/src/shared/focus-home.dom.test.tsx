/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A region's subject (#1680's review): a new one is shown from the start of
 * the pane it scrolls in, as one opened afresh — never where the subject
 * before left the pane — and a region that names none keeps the pane's scroll.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useFocusHome, viewSubject } from "./focus-home.js";

/** A region showing a subject, as a builder's Details does. */
function Region({ subject }: { subject: string | null | undefined }) {
    const home = useFocusHome(subject);
    return <div ref={home.ref}>{subject ?? "nothing"}</div>;
}

/** The region in a pane's body, as `DockPane` marks its own. */
function Pane({ subject }: { subject: string | null | undefined }) {
    return <div data-dock-body=""><Region subject={subject} /></div>;
}

afterEach(cleanup);

describe("a region's subject (#1680's review)", () => {
    test("a new subject is shown from the pane's start; the same subject drawn again keeps the pane where it is", () => {
        const { container, rerender } = render(<Pane subject="event:J-1" />);
        const pane = container.querySelector<HTMLElement>("[data-dock-body]")!;
        pane.scrollTop = 48;
        rerender(<Pane subject="event:J-1" />);
        expect(pane.scrollTop).toBe(48);
        rerender(<Pane subject="link:L-1" />);
        expect(pane.scrollTop).toBe(0);
        // From one to none — several picked, or nothing — is a new subject too.
        pane.scrollTop = 30;
        rerender(<Pane subject={null} />);
        expect(pane.scrollTop).toBe(0);
    });

    test("a region that names no subject keeps the pane's scroll, as a tab of issues does", () => {
        const { container, rerender } = render(<Pane subject={undefined} />);
        const pane = container.querySelector<HTMLElement>("[data-dock-body]")!;
        pane.scrollTop = 48;
        rerender(<Pane subject={undefined} />);
        expect(pane.scrollTop).toBe(48);
    });

    test("a view's subject is the key it is drawn under, and none for a view drawn under no key", () => {
        expect(viewSubject(<div key="event:J-1" />)).toBe("event:J-1");
        expect(viewSubject(<div />)).toBeNull();
        expect(viewSubject(null)).toBeNull();
    });
});
