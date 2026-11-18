/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A value's format as its menu offers it (#1672): the choice a stored format
 * is, the format a choice stores, what a currency's code is, and a form's
 * edit of the choice.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isValueOf, none, some, variant } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { StudioFormatChoiceType, choiceFormat, editedFormatChoice, formatChoice, isCurrencyCode } from "@elaraai/e3-ui/internal";

describe("A value's format, as its menu offers it (#1672)", () => {
    test("a value with no format of its own is as its field's; a number and a percentage are their own cases; a currency is its code", () => {
        assert.deepEqual(formatChoice(none), variant("auto", null));
        assert.deepEqual(formatChoice(some(variant("number", null))), variant("number", null));
        assert.deepEqual(formatChoice(some(variant("percent", null))), variant("percent", null));
        assert.deepEqual(formatChoice(some(variant("currency", { code: "AUD", compact: true }))), variant("currency", "AUD"));
    });

    test("a compact format is a plain number, which a visual prints it as; a date or a time pattern is no number's, and shown as its field's", () => {
        assert.deepEqual(formatChoice(some(variant("compact", null))), variant("number", null));
        assert.deepEqual(formatChoice(some(variant("date", "MMM YYYY"))), variant("auto", null));
        assert.deepEqual(formatChoice(some(variant("time", "HH:mm"))), variant("auto", null));
        assert.deepEqual(formatChoice(some(variant("datetime", "MMM D HH:mm"))), variant("auto", null));
    });

    test("a choice stores its format, and none for as its field's — each a value's format, and the choice read back", () => {
        const choices = [variant("auto", null), variant("number", null), variant("percent", null), variant("currency", "USD")] as const;
        for (const choice of choices) {
            assert.ok(isValueOf(choice, StudioFormatChoiceType), choice.type);
            const stored = choiceFormat(choice);
            assert.ok(isValueOf({ ...Studio.visual.count(), format: stored }, Studio.Types.Value), `${choice.type} is a value's format`);
            assert.deepEqual(formatChoice(stored), choice);
        }
        assert.deepEqual(choiceFormat(variant("auto", null)), none);
        assert.deepEqual(choiceFormat(variant("currency", "USD")), some(variant("currency", { code: "USD", compact: false })));
    });

    test("a currency chosen keeps the compact flag the value's currency held, and no other format's", () => {
        const compact = some(variant("currency", { code: "AUD", compact: true }));
        assert.deepEqual(choiceFormat(variant("currency", "NZD"), compact), some(variant("currency", { code: "NZD", compact: true })));
        assert.deepEqual(choiceFormat(variant("currency", "NZD"), some(variant("compact", null))), some(variant("currency", { code: "NZD", compact: false })));
        assert.deepEqual(choiceFormat(variant("number", null), compact), some(variant("number", null)));
    });

    test("a currency's code is three capital letters", () => {
        assert.deepEqual(["AUD", "USD", "aud", "AU", "AUDX", "A1D", ""].map(isCurrencyCode), [true, true, false, false, false, false, false]);
    });

    test("a case picked is the choice — whatever the control hands with it; a currency picked starts as its field's; the case it holds picked again leaves it", () => {
        const auto = variant("auto", null);
        assert.deepEqual(editedFormatChoice(auto, [], variant("percent", null), "AUD"), { choice: variant("percent", null) });
        // A form starts a currency's code empty; a segment hands its case alone.
        assert.deepEqual(editedFormatChoice(auto, [], variant("currency", ""), "AUD"), { choice: variant("currency", "AUD") });
        assert.deepEqual(editedFormatChoice(auto, [], variant("currency", null), "AUD"), { choice: variant("currency", "AUD") });
        assert.deepEqual(editedFormatChoice(variant("number", null), [], auto, "AUD"), { choice: auto });
        assert.deepEqual(editedFormatChoice(variant("currency", "NZD"), [], variant("currency", null), "AUD"), { choice: variant("currency", "NZD") });
    });

    test("a currency's code typed is taken in capitals", () => {
        assert.deepEqual(editedFormatChoice(variant("currency", "AUD"), ["currency"], "nzd", "AUD"), { choice: variant("currency", "NZD") });
    });

    test("an edit it does not take is refused, saying which: a code that is not three letters, or a value that is no choice", () => {
        const aud = variant("currency", "AUD");
        assert.deepEqual(editedFormatChoice(aud, ["currency"], "AU", "AUD"), { refused: "code" });
        assert.deepEqual(editedFormatChoice(aud, ["currency"], "dollars", "AUD"), { refused: "code" });
        assert.deepEqual(editedFormatChoice(aud, ["currency"], 12, "AUD"), { refused: "value" });
        assert.deepEqual(editedFormatChoice(variant("auto", null), [], variant("date", "MMM"), "AUD"), { refused: "value" });
        assert.deepEqual(editedFormatChoice(variant("auto", null), [], "percent", "AUD"), { refused: "value" });
        // A currency's code set while the choice is no currency: there is none to set.
        assert.deepEqual(editedFormatChoice(variant("number", null), ["currency"], "AUD", "AUD"), { refused: "value" });
        // A currency picked whose starting code is none.
        assert.deepEqual(editedFormatChoice(variant("auto", null), [], variant("currency", null), ""), { refused: "code" });
    });
});
