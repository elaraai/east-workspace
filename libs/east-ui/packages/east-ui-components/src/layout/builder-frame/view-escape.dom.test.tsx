/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A view over another closes on an Esc from anywhere while it shows
 * (`useTopViewEscape`, `view-escape.ts`): heard first and taken — but not one a
 * control in the view takes itself and says so (`data-escape-layer`: a tags box
 * holding words, east-workspace#1779), where the view is given.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useTopViewEscape } from "./view-escape.js";

afterEach(cleanup);

/** A view showing, a plain box in it and one that takes Esc itself and says so; `given` hands the hook the view. */
function View({ onClose, given }: { onClose: () => void; given: boolean }) {
    const view = useRef<HTMLDivElement | null>(null);
    useTopViewEscape(true, onClose, given ? () => view.current : undefined);
    return (
        <div ref={view}>
            <input aria-label="plain" />
            <input aria-label="taking" data-escape-layer="" />
        </div>
    );
}

describe("useTopViewEscape (east-workspace#1779)", () => {
    test("an Esc from anywhere closes the view, the key taken; one a control in it takes itself and says so is the control's, left as it came", () => {
        const onClose = vi.fn();
        const { getByLabelText } = render(<View onClose={onClose} given />);
        // `fireEvent` says whether the key went on unprevented.
        expect(fireEvent.keyDown(getByLabelText("taking"), { key: "Escape" })).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
        expect(fireEvent.keyDown(getByLabelText("plain"), { key: "Escape" })).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("given no view, every Esc closes it, a control's that says it takes it too", () => {
        const onClose = vi.fn();
        const { getByLabelText } = render(<View onClose={onClose} given={false} />);
        fireEvent.keyDown(getByLabelText("taking"), { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
