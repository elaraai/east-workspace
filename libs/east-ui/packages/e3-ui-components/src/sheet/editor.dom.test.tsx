/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { DensityProvider } from "@elaraai/east-ui-components/internal";
import { system } from "@elaraai/east-ui-components";
import { SheetEditor } from "./Editor.js";

afterEach(cleanup);

/**
 * A key pressed at the end of a number field holding `text`, as a browser
 * presses it: its key down, then its key press — React reads the field's
 * beforeinput from that where there is no `textInput` (jsdom), the check that
 * dropped `k`, `m` and an integer's decimal point without a word. Whether the
 * key lands, and what the field's buffer was told.
 */
function press(kind: "quantity" | "integer", locale: string, text: string, key: string): { landed: boolean; told: readonly string[] } {
    const change = vi.fn<(val: string) => void>();
    const ui = render(<ChakraProvider value={system}><I18nProvider locale={locale}>
        <SheetEditor styles={{}} kind={kind} value={text} date={undefined}
            seed={undefined} ghost="" resolve="" badge="" error={false} focus={{ seq: 0, selectAll: false }}
            ariaLabel="Hours" link={undefined} onChange={change} onKey={() => false} onBlur={() => {}} onHalfDown={() => {}} />
    </I18nProvider></ChakraProvider>);
    const box = ui.getByRole("spinbutton") as HTMLInputElement;
    box.focus();
    // The field holds the text as typed — its own format would print `2.` as `2` — the caret at its end.
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    const code = key.charCodeAt(0);
    const landed = fireEvent.keyDown(box, { key }) && fireEvent.keyPress(box, { key, charCode: code, which: code });
    return { landed, told: change.mock.calls.map(([val]) => val) };
}

test.each([
    // A magnitude suffix completing a number: the field holds the number it reads, the decimal point moved.
    ["en-US", "quantity", "1.005", "k", false, ["1005"]],
    ["en-US", "quantity", "2.5", "m", false, ["2500000"]],
    ["en-US", "integer", "12", "K", false, ["12000"]],
    ["de-DE", "quantity", "1,5", "k", false, ["1500"]],
    // A decimal point in an integer column lands: the strip calls 2.5 unrecognised, the commit refuses it.
    ["en-US", "integer", "2", ".", true, []],
    ["en-US", "integer", "2.", "5", true, []],
    // A number on its way lands.
    ["en-US", "quantity", "1", ".", true, []],
    ["en-US", "quantity", "", "-", true, []],
    ["en-US", "quantity", "-", "7", true, []],
    ["de-DE", "quantity", "1", ",", true, []],
    ["de-DE", "quantity", "1", ".", true, []],
    // What the grammar never reads is refused.
    ["en-US", "quantity", "1", "x", false, []],
    ["en-US", "quantity", "4", "-", false, []],
    ["en-US", "quantity", "1.2", ".", false, []],
    ["de-DE", "quantity", "1,5", ",", false, []],
    ["en-US", "quantity", "", "k", false, []],
] as const)("%s %s holding %j: %s lands %s, the buffer told %j", (locale, kind, text, key, landed, told) => {
    expect(press(kind, locale, text, key)).toEqual({ landed, told });
});

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
