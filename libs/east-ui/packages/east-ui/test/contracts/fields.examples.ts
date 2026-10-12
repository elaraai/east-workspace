/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, BooleanType, East, IntegerType, NullType, OptionType, StringType, StructType, VariantType, example } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";

export const fieldsSpecs = example({
    keywords: ["Fields", "specs", "form", "inspector", "editor", "hint", "number", "select", "reference", "hidden", "checklist", "Fields.Types.Spec"],
    description: "A typed form's fields, resolved — each field's editor from its East type, a hint adding a unit and bounds, a case's words or the keyed set a String names; the hinted fields first, a hidden one left out",
    fn: East.function([], ArrayType(StringType), ($) => {
        const Status = VariantType({ planned: NullType, in_progress: NullType, on_hold: NullType });
        const Check = StructType({ text: StringType, done: BooleanType });
        const Job = StructType({
            task: StringType, crew: IntegerType, status: Status, rush: BooleanType,
            bay: OptionType(StringType), checks: ArrayType(Check), notes: StringType,
        });
        const specs = $.const(Fields.specs(Job, {
            crew: Fields.number({ unit: "people", min: 1n, max: 20n }),
            status: Fields.select({ labels: { on_hold: "Paused" } }),
            bay: Fields.reference({ of: "bays", label: "Work bay" }),
            notes: Fields.hidden(),
        }), ArrayType(Fields.Types.Spec));
        return specs.map((_$, spec) => East.str`${spec.label}: ${spec.editor.getTag()}`);
    }),
    inputs: [],
    returns: ["Crew: number", "Status: select", "Work bay: reference", "Task: text", "Rush: checkbox", "Checks: checklist"],
});

export const fieldsSelect = example({
    keywords: ["Fields", "select", "variant", "cases", "labels", "order", "status", "spelled out"],
    description: "A variant field's select — the cases the hint gives words to first, in its order, then the rest, each name spelled out",
    fn: East.function([], ArrayType(StringType), ($) => {
        const Status = VariantType({ planned: NullType, in_progress: NullType, on_hold: NullType, done: NullType });
        const Job = StructType({ task: StringType, status: Status });
        const specs = $.const(Fields.specs(Job, {
            status: Fields.select({ labels: { planned: "Planned", in_progress: "Underway", on_hold: "Paused" } }),
        }), ArrayType(Fields.Types.Spec));
        return specs.get(0n).editor.unwrap("select").map((_$, option) => option.label);
    }),
    inputs: [],
    returns: ["Planned", "Underway", "Paused", "Done"],
});
