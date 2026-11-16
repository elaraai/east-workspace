/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The tone a form says a bound a target's row breaks in (#1585): an error while one of the target's issues holds Save —
 * a field still missing, or one refused — and a warning while each is a stored row's number outside its bounds.
 */

import { describe, expect, test } from "vitest";
import { targetBreachTone, type TargetIssue } from "./inspector.js";

/** An issue of a target's field, of a kind. */
const issue = (kind: TargetIssue["kind"], text: string): TargetIssue => ({ key: text, field: "Wear", name: "wear", text, kind });

describe("targetBreachTone (#1585)", () => {
    test("a stored row's breaches alone warn: they hold no Save", () => {
        expect(targetBreachTone([issue("warning", "Wear is above 100")])).toBe("warn");
        expect(targetBreachTone([])).toBe("warn");
    });

    test("an issue holding Save — a field still missing, or one refused — says a breach as an error", () => {
        expect(targetBreachTone([issue("warning", "Wear is above 100"), issue("incomplete", "Wear is required")])).toBe("error");
        expect(targetBreachTone([issue("invalid", "Wear is above 100")])).toBe("error");
    });
});
