/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A bin's quantity outside the bounds a hint gives it (#1585), over the kiln
 * yard on e3 itself, a hint holding a bin to at most 40 m³: LD-2204's bin
 * 3104 is stored at 47. Stored, Details says it under the bin's quantity and
 * it holds no Save — another bin's change saves; its own measured spec
 * retyped, Save waits, Issues saying it among what is not saved yet, by the
 * hint's label, in its own words.
 */
import { expect, test } from "vitest";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allocationHarness, kilnYard, settle } from "./harness.test-utils.js";
import { card, details, issuesTab, press, save, tab } from "./inspector.test-utils.js";

const h = allocationHarness();

test("a stored bin past its most: Details says it under its quantity and it holds no Save — another bin's change saves; its own spec retyped, Save waits and Issues says it (#1585)", async () => {
    const c = (await h.mount(kilnYard({ most: 40 }))).container;
    const user = userEvent.setup();
    /** The line under the selected bin's quantity. */
    const said = () => details(c).querySelector('[data-allocation-bin-section] [data-field="quantity"] [data-scope=field][data-part=error-text]')?.textContent;
    /** Retypes the selected bin's measured spec, committed with Enter. */
    const retype = async (text: string) => {
        const spec = within(details(c).querySelector<HTMLElement>('[data-field="specMeasured"]')!).getByRole("textbox");
        await user.clear(spec);
        await user.type(spec, `${text}{Enter}`);
        await settle();
    };
    // Another bin's change saves: the stored breach holds nothing.
    await press(card(c, "3113"));
    expect(said()).toBeUndefined();
    await retype("MC08");
    expect(save(c)).toHaveProperty("disabled", false);
    // Stored: the line under its quantity.
    await press(card(c, "3104"));
    expect(said()).toBe("at most 40");
    // Its own spec retyped: Save waits, and Issues says why.
    await retype("MC12");
    expect(save(c)).toHaveProperty("disabled", true);
    await tab(c, "Issues");
    const refusal = issuesTab(c).querySelector<HTMLElement>('[data-allocation-issue="refusal"]');
    expect([refusal?.querySelector("[title]")?.textContent, refusal?.lastElementChild?.textContent]).toEqual(["LD-2204", "Volume: at most 40"]);
});
