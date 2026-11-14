/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * What an element says of its status to its recipe (#1541): its tone, and the
 * open ring a tentative one draws as — over the builders' one status, decoded
 * from East.
 */

import { describe, test, expect } from "vitest";
import { ArrayType, East, OptionType, none, some, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { Plan, Schedule } from "@elaraai/e3-ui/internal";
import { statusAttributes } from "./status.js";

describe("a status's attributes (#1541)", () => {
    /** Statuses as `Plan.status` builds them, decoded. */
    const built = East.compile(East.function([], ArrayType(Plan.Types.Status), () => [
        Plan.status("Late", "warning"),
        Plan.status("Tentative", "info", { ring: true }),
        Plan.status("Parked", "neutral", { ring: false }),
    ]), [])();

    test("no status sets nothing", () => {
        expect(statusAttributes(undefined)).toEqual({});
        expect(statusAttributes(getSomeorUndefined(none as ValueTypeOf<OptionType<typeof Plan.Types.Status>>))).toEqual({});
    });

    test("a status sets its tone, and `data-ring` only where it draws as an open ring", () => {
        expect(built.map((status) => statusAttributes(status))).toEqual([
            { "data-tone": "warning" },
            { "data-tone": "info", "data-ring": "" },
            { "data-tone": "neutral" },
        ]);
    });

    test("an event kind's status case is the same status: it sets the same attributes", () => {
        const queued: ValueTypeOf<typeof Schedule.Types.Status> = built[1]!;
        expect(statusAttributes(getSomeorUndefined(some(queued)))).toEqual({ "data-tone": "info", "data-ring": "" });
    });
});
