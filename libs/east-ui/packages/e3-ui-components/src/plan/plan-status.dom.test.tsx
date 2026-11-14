/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * An item's status (#1541, U8), on e3 itself: `planStatuses` mounts as a
 * surface mounts it, its press's jobs, deliveries, shifts and checks read from
 * the record, and each item wears what its series' map returned as
 * `Plan.status(words, tone, { ring })` — its tone on `data-tone`, the open
 * ring on `data-ring`, and its words in its accessible name. An item with no
 * status wears neither and says none. What the recipe draws of the two
 * attributes is measured in a browser (east-ui-showcase's `plan-status`).
 */

import { describe, test, expect } from "vitest";
import { waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/plan/plan";
import { entry, planHarness, rowAt, settle } from "./frame/harness.test-utils.js";

const h = planHarness({ "plan/plan": ex });

/** How each week's item stands, as the example's one function shows it: the first week's has nothing to say. */
const SHOWN: readonly ({ readonly words: string; readonly tone: string; readonly ring: boolean } | undefined)[] = [
    undefined,
    { words: "Late", tone: "warning", ring: false },
    { words: "Blocked", tone: "danger", ring: false },
    { words: "Done", tone: "success", ring: false },
    { words: "Noted", tone: "info", ring: false },
    { words: "Parked", tone: "neutral", ring: false },
    { words: "Tentative", tone: "warning", ring: true },
];

/** Each series of the example: the attribute its items are keyed by, and the letter its items' ids start with. */
const SERIES = [
    { series: "jobs", item: "a run's bar", attribute: "data-run", id: "j" },
    { series: "drops", item: "a tile", attribute: "data-event", id: "d" },
    { series: "shifts", item: "a chip", attribute: "data-chip", id: "s" },
    { series: "checks", item: "a mark", attribute: "data-mark", id: "c" },
] as const;

describe("planStatuses: an item's status from its map (#1541)", () => {
    for (const { series, item, attribute, id } of SERIES) {
        test(`${item} wears its status's tone, a tentative one the open ring too, and says its status's words`, async () => {
            const { container: c } = await h.mount(ex.planStatuses);
            await settle();
            const row = rowAt(entry(series, "P03"));
            // A mark's caption is keyed as its glyph is: the glyph is the button.
            const at = (i: number) => c.querySelector<HTMLElement>(`${row} [role="button"][${attribute}="${id}${i + 1}"]`);
            await waitFor(() => expect(SHOWN.map((_shown, i) => at(i) !== null)).toEqual(SHOWN.map(() => true)));
            expect(SHOWN.map((_shown, i) => [at(i)!.getAttribute("data-tone"), at(i)!.hasAttribute("data-ring")]))
                .toEqual(SHOWN.map((shown) => [shown?.tone ?? null, shown?.ring ?? false]));
            // Its name ends in its status's own words; the one with none names no status of the example's.
            const names = SHOWN.map((_shown, i) => at(i)!.getAttribute("aria-label")!);
            expect(names.map((name) => SHOWN.find((shown) => shown !== undefined && name.endsWith(`, ${shown.words}`))?.words))
                .toEqual(SHOWN.map((shown) => shown?.words));
        });
    }
});
