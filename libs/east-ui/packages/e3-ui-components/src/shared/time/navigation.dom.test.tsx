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
import { act, settle } from "../../e3-web-mount.test-utils.js";
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
    test.each([
        ["day", 7, "7 days", Date.UTC(2028, 1, 7), Date.UTC(2028, 0, 24)],
        ["week", 4, "4 weeks", Date.UTC(2028, 1, 28), Date.UTC(2028, 0, 3)],
        ["month", 3, "3 months", Date.UTC(2028, 3, 30), Date.UTC(2027, 9, 31)],
    ] as const)("an arrow steps its stride of %ss, and is named for what it steps — in the row and in the popup (#1740)", async (period, stride, named, next, previous) => {
        const { container, onChange } = mount({ period, stride });
        expect([...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual([`Previous ${named}`, "Choose date", `Next ${named}`]);
        await press(within(container).getByRole("button", { name: `Next ${named}` }));
        await press(within(container).getByRole("button", { name: `Previous ${named}` }));
        expect(onChange.mock.calls).toEqual([[next], [previous]]);
        // The popup's own arrows step the same stride: a row that has given up its arrows keeps them there.
        await open(container);
        await press(within(popup()).getByRole("button", { name: `Next ${named}` }));
        expect(onChange.mock.lastCall).toEqual([next]);
    });
    test("the short label stands between the arrows: a row short of room gives up its words before its arrows (#1740)", () => {
        const { container } = mount({ period: "week", shortLabel: true, end: Date.UTC(2028, 2, 26, 23), rangeLabel: "The range" });
        expect([...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(["Previous week", "Choose date", "Next week"]);
        expect(container.querySelector("[data-time-label]")!.textContent).toBe("W5 – W12");
        expect(container.querySelector("[data-time-trigger]")!.getAttribute("title")).toBe("The range");
    });
    test("the popup opens again on the panel chosen last — Days, Weeks or Range — while its period is chosen by them (#1740)", async () => {
        const panel = () => popup().querySelector("[data-time-picker]")!.getAttribute("data-time-panel");
        const reopen = async (container: HTMLElement) => { await userEvent.setup().keyboard('{Escape}'); await closed(); await open(container); };
        const days = mount({ rangeEditor: <div>Shared range controls</div> });
        await open(days.container);
        expect(panel()).toBe("day");
        await press(within(popup()).getByRole("radio", { name: "Weeks" }));
        await reopen(days.container);
        expect(panel()).toBe("week");
        // A week chosen closes the popup; it opens on its weeks again.
        await press(popup().querySelector(`[data-time-week="${Date.UTC(2028, 0, 24)}"]`)!);
        await closed();
        await open(days.container);
        expect(panel()).toBe("week");
        await press(within(popup()).getByRole("radio", { name: "Range" }));
        await reopen(days.container);
        expect(panel()).toBe("range");
        expect(within(popup()).getByText("Shared range controls")).toBeTruthy();
        await userEvent.setup().keyboard('{Escape}'); await closed();
        days.unmount();
        // A month's navigator opens on its months whatever was chosen: its grid is its period's.
        const months = mount({ period: "month", rangeEditor: <div>Shared range controls</div> });
        await open(months.container);
        expect(panel()).toBe("month");
        await press(within(popup()).getByRole("radio", { name: "Range" }));
        expect(panel()).toBe("range");
        await reopen(months.container);
        expect(panel()).toBe("month");
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
    test("A2 — the day panel marks each day of its open month (dayMarker), reading only that month's weeks", async () => {
        const onWeeks = vi.fn<(dates: readonly Date[]) => void>();
        const marked = new Set([Date.UTC(2028, 0, 31), Date.UTC(2028, 0, 12)]);
        const { container } = mount({ onWeeks, dayMarker: day => <span data-mark={marked.has(day.getTime()) ? "draft" : "none"} /> });
        await open(container);
        const days = popup().querySelectorAll("[data-time-day]");
        expect(popup().querySelectorAll("[data-time-daymark]")).toHaveLength(days.length);
        expect(popup().querySelector(`[data-time-day="${Date.UTC(2028, 0, 31)}"] [data-mark]`)!.getAttribute("data-mark")).toBe("draft");
        expect(popup().querySelector(`[data-time-day="${Date.UTC(2028, 0, 30)}"] [data-mark]`)!.getAttribute("data-mark")).toBe("none");
        // The weeks it reads are the open month's alone, and move with it.
        const weeks = onWeeks.mock.lastCall![0];
        expect(weeks.length).toBeLessThanOrEqual(6);
        expect(weeks.every(week => week.getTime() >= Date.UTC(2027, 11, 27) && week.getTime() < Date.UTC(2028, 1, 1))).toBe(true);
        await press(within(popup()).getByRole("button", { name: "Next month" }));
        expect(onWeeks.mock.lastCall![0].every(week => week.getTime() >= Date.UTC(2028, 0, 31) && week.getTime() < Date.UTC(2028, 2, 1))).toBe(true);
        // A day still reads its number, its mark out of its flow.
        expect(popup().querySelector(`[data-time-day="${Date.UTC(2028, 1, 3)}"]`)!.textContent).toBe("3");
    });
    test.each([
        ["day", Date.UTC(2028, 1, 27, 23), "Jan 31 – Feb 27", "Jan 31"],
        ["week", Date.UTC(2028, 2, 26, 23), "W5 – W12", "W5"],
        ["month", Date.UTC(2029, 0, 30), "Jan 2028 – Jan 2029", "Jan 2028"],
        ["quarter", Date.UTC(2028, 5, 30), "Jan – Jun 2028", "Jan 2028"],
        ["year", Date.UTC(2037, 11, 31), "2028 – 2037", "2028"],
    ] as const)("a window of several periods: the short label names its first %s to its last, as the range label names the range (#1680's review)", (period, end, spans, one) => {
        const label = (props: Partial<TimeNavigatorProps>) => {
            const { container, unmount } = mount({ period, compact: true, rangeLabel: "The range", ...props });
            const text = [container.querySelector("[data-time-label]")!.textContent, container.querySelector("[data-time-trigger]")!.getAttribute("title")];
            unmount();
            return text;
        };
        expect(label({ end })).toEqual([spans, "The range"]);
        // A window of one period — or a host that names none — names that period.
        expect(label({ end: JAN31 + 3_600_000 })).toEqual([one, "The range"]);
        expect(label({})).toEqual([one, "The range"]);
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
