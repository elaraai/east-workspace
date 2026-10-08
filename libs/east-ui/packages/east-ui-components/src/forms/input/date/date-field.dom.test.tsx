/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The segmented date field (#1263): a date outside its range marks the field
 * invalid with Font Awesome's ban — never a text glyph — and a date inside it
 * draws no mark.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CalendarDate } from "@internationalized/date";
import { faIcons, loneGlyphs } from "../../../testing/icons.js";
import { DateField } from "./DateField.js";

afterEach(cleanup);

describe("DateField — its invalid mark is Font Awesome's ban (#1263)", () => {
    test("a date before the field's least marks it with the ban; a date in range, with nothing", () => {
        const outside = render(<DateField label="Due" value={new CalendarDate(2026, 1, 5)} minValue={new CalendarDate(2026, 6, 1)} />);
        expect(faIcons(outside.container, "ban")).toHaveLength(1);
        expect(loneGlyphs(outside.container)).toEqual([]);
        cleanup();
        const inside = render(<DateField label="Due" value={new CalendarDate(2026, 7, 5)} minValue={new CalendarDate(2026, 6, 1)} />);
        expect(faIcons(inside.container, "ban")).toHaveLength(0);
    });
});
