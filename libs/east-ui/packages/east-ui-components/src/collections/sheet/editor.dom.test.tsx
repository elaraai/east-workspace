/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { DensityProvider } from "../../contracts/density.js";
import { system } from "../../theme/index.js";
import { SheetEditor } from "./Editor.js";

afterEach(cleanup);

test.each(["comfortable", "compact", "condensed"] as const)("%s date editor lets segments handle arrows and reserves Enter/Escape for Sheet", async density => {
    const change = vi.fn();
    const key = vi.fn(() => true);
    const outsideKey = vi.fn();
    const ui = render(<ChakraProvider value={system}><DensityProvider value={density}>
        <div onKeyDown={outsideKey}>
            <SheetEditor styles={{}} kind="date" value="14/9/26" date={new Date("2026-09-14T00:00:00Z")}
                seed={undefined} ghost="" resolve="" badge="" error={false} focus={{ seq: 0, selectAll: false }}
                ariaLabel="Start" link={undefined} onChange={change} onKey={key} onBlur={() => {}} onHalfDown={() => {}} />
        </div>
    </DensityProvider></ChakraProvider>);
    const day = ui.getAllByRole("spinbutton")[0]!;
    await act(async () => { day.focus(); fireEvent.keyDown(day, { key: "ArrowUp" }); });
    expect(change).toHaveBeenCalledWith("15/9/26");
    expect(key).not.toHaveBeenCalled();
    expect(outsideKey).not.toHaveBeenCalled();
    fireEvent.keyDown(day, { key: "Enter" });
    expect(key).toHaveBeenLastCalledWith(expect.objectContaining({ key: "Enter" }));
    fireEvent.keyDown(day, { key: "Escape" });
    expect(key).toHaveBeenLastCalledWith(expect.objectContaining({ key: "Escape" }));
    expect(outsideKey).not.toHaveBeenCalled();
});
