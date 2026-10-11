/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 * @vitest-environment jsdom
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { DateTimeType, printFor } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { SliceRangeEditor, type SliceRangeEditorProps } from "./editor.js";

const editor = (props: SliceRangeEditorProps) => <ChakraProvider value={system}><SliceRangeEditor {...props} /></ChakraProvider>;
afterEach(cleanup);

test("Integer range retains all 64 bits and invalid/empty drafts; external bounds replace the draft", () => {
    const onApply = vi.fn();
    const props = { kind: "integer" as const, label: "Quantity", from: "9007199254740993", to: "9223372036854775807", exclusive: true, onApply };
    const view = render(editor(props));
    const from = screen.getByRole("textbox", { name: "Quantity from" });
    const apply = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenLastCalledWith(props.from, props.to);
    for (const invalid of ["", "-", "9223372036854775808", props.to]) {
        fireEvent.change(from, { target: { value: invalid } });
        expect((from as HTMLInputElement).value).toBe(invalid);
        expect((apply as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(apply);
    }
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.change(from, { target: { value: "9007199254740994" } });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenLastCalledWith("9007199254740994", props.to);
    view.rerender(editor({ ...props, from: "5", to: "6" }));
    expect((from as HTMLInputElement).value).toBe("5");
    expect((screen.getByRole("textbox", { name: "Quantity until" }) as HTMLInputElement).value).toBe("6");
});

test("Float partial input cannot commit a stale endpoint; local inclusive and record exclusive ranges stay distinct", () => {
    const onApply = vi.fn();
    const props = { kind: "float" as const, label: "Cost", from: "1.25", to: "2.5", onApply };
    const view = render(editor(props));
    const from = screen.getByRole("textbox", { name: "Cost from" });
    const apply = screen.getByRole("button", { name: "Apply" });
    for (const invalid of ["", "-", ".", "1e"]) {
        fireEvent.change(from, { target: { value: invalid } });
        expect((apply as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(from, { target: { value: "2.5" } });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    view.rerender(editor({ ...props, exclusive: true }));
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    view.rerender(editor({ ...props, single: true, exclusive: true }));
    expect(screen.queryByRole("textbox", { name: "Cost until" })).toBeNull();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith("2.5", "2.5");
});

test("Date range clearing one segment disables Apply; completing it preserves time, milliseconds and UTC", async () => {
    const onApply = vi.fn();
    const print = printFor(DateTimeType);
    const props = { kind: "datetime" as const, label: "Due", from: print(new Date("2026-10-11T09:10:11.123Z")),
        to: print(new Date("2026-10-12T13:14:15.456Z")), exclusive: true, onApply };
    render(editor(props));
    const from = screen.getByRole("group", { name: "Due from" });
    const day = within(from).getByRole("spinbutton", { name: /day/i });
    const apply = screen.getByRole("button", { name: "Apply" });
    const user = userEvent.setup();
    await user.click(day);
    await user.keyboard("{Delete}{Delete}");
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(within(from).getByRole("spinbutton", { name: /month/i }).getAttribute("aria-valuenow")).toBe("10");
    await user.keyboard("09");
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await user.click(apply);
    expect(onApply).toHaveBeenCalledWith(print(new Date("2026-10-09T09:10:11.123Z")), props.to);
});

test.each([true, false])("date drafts offer a start and calendar duration without applying on open (exclusive=%s)", async exclusive => {
    const print = printFor(DateTimeType);
    const onApply = vi.fn();
    const props = { kind: "datetime" as const, label: "Due", from: "", to: "", exclusive,
        defaultFrom: print(new Date("2028-01-31T00:00:00Z")), onApply };
    const view = render(editor(props));
    const start = screen.getByRole("group", { name: "Due from" });
    expect(within(start).queryByRole("spinbutton", { name: /hour/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Due until" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "1 month" }));
    // A late domain read must not overwrite a duration the user has chosen.
    view.rerender(editor({ ...props, defaultFrom: print(new Date("2028-02-10T00:00:00Z")) }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const end = Date.parse("2028-02-29T00:00:00Z") - (exclusive ? 0 : 1);
    expect(onApply).toHaveBeenLastCalledWith(props.defaultFrom, print(new Date(end)));
    fireEvent.click(screen.getByRole("button", { name: "Include time" }));
    fireEvent.click(screen.getByRole("button", { name: "Include time" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith(props.defaultFrom, print(new Date(end)));
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("group", { name: exclusive ? "Due until" : "Due to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Include time" }));
    expect(within(start).getByRole("spinbutton", { name: /hour/i })).toBeTruthy();
});
