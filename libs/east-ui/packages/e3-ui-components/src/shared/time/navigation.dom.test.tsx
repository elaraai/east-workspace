/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { system } from "@elaraai/east-ui-components";
import { act, settle } from "../builder-harness.test-utils.js";
import { TimeNavigator, type TimeNavigatorProps } from "./navigation.js";

afterEach(cleanup);
const JAN31 = Date.UTC(2028, 0, 31);
const NOW = new Date(Date.UTC(2028, 2, 16, 14, 30));
function mount(props: Partial<TimeNavigatorProps> = {}, locale = "en-US") {
    const onChange = vi.fn<(date: number) => void>();
    const view = render(<ChakraProvider value={system}><I18nProvider locale={locale}>
        <TimeNavigator scope="test" date={JAN31} period="day" sunday={false} now={NOW} onChange={onChange} {...props} />
    </I18nProvider></ChakraProvider>);
    return { ...view, onChange };
}
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
const popup = () => within(document.body).getByRole("dialog");
async function open(container: HTMLElement) { await press(within(container).getByRole("button", { name: "Choose date" })); await within(document.body).findByRole("dialog"); }
async function closed() { await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull()); }

describe("Shared time navigation", () => {
    test.each([
        ["hour", JAN31 + 3_600_000], ["day", Date.UTC(2028, 1, 1)], ["week", Date.UTC(2028, 1, 7)],
        ["month", Date.UTC(2028, 1, 29)], ["quarter", Date.UTC(2028, 3, 30)], ["year", Date.UTC(2029, 0, 31)],
    ] as const)("arrows step a %s; month ends clamp through the shared calendar arithmetic", async (period, expected) => {
        const { container, onChange } = mount({ period });
        await press(within(container).getByRole("button", { name: `Next ${period}` }));
        expect(onChange.mock.calls).toEqual([[expected]]);
    });
    test("date trigger sits between the arrows, and popup Today chooses UTC today and closes", async () => {
        const { container, onChange } = mount();
        expect([...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual(["Previous day", "Choose date", "Next day"]);
        await open(container);
        expect(onChange).not.toHaveBeenCalled();
        await press(within(popup()).getByRole("button", { name: "Today" }));
        expect(onChange.mock.calls).toEqual([[Date.UTC(2028, 2, 16)]]);
        await closed();
    });
    test.each([false, true])("week selection preserves the anchor's weekday with Sunday=%s, across the year", async sunday => {
        const { container, onChange } = mount({ date: Date.UTC(2027, 11, 29), period: "week", sunday });
        await open(container);
        await press(within(popup()).getByRole("button", { name: "Next month" }));
        const target = Date.UTC(2028, 0, sunday ? 2 : 3);
        await press(popup().querySelector(`[data-time-week="${target}"]`)!);
        expect(onChange.mock.calls).toEqual([[Date.UTC(2028, 0, 5)]]);
    });
    test("month/year browsing is read-only until a day is chosen; Escape cancels", async () => {
        const { container, onChange } = mount();
        await open(container);
        await press(within(popup()).getByRole("button", { name: "Choose month" }));
        await press(within(popup()).getByRole("button", { name: "Choose year" }));
        await press(within(popup()).getByRole("button", { name: "2029" }));
        await press(within(popup()).getByRole("button", { name: "February 2029" }));
        expect(onChange).not.toHaveBeenCalled();
        await userEvent.setup().keyboard('{Escape}'); await closed();
        expect(onChange).not.toHaveBeenCalled();
        await open(container);
        await press(within(popup()).getByRole("button", { name: "Next month" }));
        await press(popup().querySelector(`[data-time-day="${Date.UTC(2028, 1, 29)}"]`)!);
        expect(onChange.mock.calls).toEqual([[Date.UTC(2028, 1, 29)]]);
    });
    test("month selection preserves and clamps the anchor day, and uses the app's locale", async () => {
        const { container, onChange } = mount({ period: "month" }, "de-DE");
        expect(container.textContent).toContain("Januar 2028");
        await open(container);
        await press(within(popup()).getByRole("button", { name: "Februar 2028" }));
        expect(onChange.mock.calls).toEqual([[Date.UTC(2028, 1, 29)]]);
    });
    test("hour navigation and picking a day retain sub-day precision; the shared range editor stays reachable", async () => {
        const time = 13 * 3_600_000 + 45 * 60_000 + 12_345;
        const { container, onChange } = mount({ date: JAN31 + time, period: "hour", rangeEditor: <div>Shared range controls</div> });
        await press(within(container).getByRole("button", { name: "Next hour" }));
        expect(onChange.mock.lastCall).toEqual([JAN31 + time + 3_600_000]);
        await open(container);
        await press(within(popup()).getByRole("radio", { name: "Range" }));
        expect(within(popup()).getByText("Shared range controls")).toBeTruthy();
        await press(within(popup()).getByRole("radio", { name: "Days" }));
        await press(popup().querySelector(`[data-time-day="${Date.UTC(2028, 1, 1)}"]`)!);
        expect(onChange.mock.lastCall).toEqual([Date.UTC(2028, 1, 1) + time]);
    });
    test("compact navigation keeps Today and only requests the currently browsed weeks", async () => {
        const onWeeks = vi.fn<(dates: readonly Date[]) => void>();
        const { container, onChange, unmount } = mount({ compact: true, initialPanel: "week", onWeeks });
        expect(onWeeks).not.toHaveBeenCalled();
        await open(container);
        expect(onWeeks.mock.lastCall![0].length).toBeLessThanOrEqual(6);
        const before = onWeeks.mock.lastCall![0][0]!.getTime();
        await press(within(popup()).getByRole("button", { name: "Next month" }));
        expect(onWeeks.mock.lastCall![0][0]!.getTime()).toBeGreaterThan(before);
        expect(onChange).not.toHaveBeenCalled();
        await press(within(popup()).getByRole("button", { name: "Today" }));
        expect(onChange.mock.calls).toEqual([[Date.UTC(2028, 2, 16)]]);
        expect(onWeeks.mock.lastCall![0]).toEqual([]); await closed();
        await open(container); unmount(); expect(onWeeks.mock.lastCall![0]).toEqual([]);
    });
});
