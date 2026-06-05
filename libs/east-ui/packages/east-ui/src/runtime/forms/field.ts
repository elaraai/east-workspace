/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Form `<Field.*>` tags — labelled form controls. Mirrors the `Field`
 * namespace so `<Field.StringInput label="Email" value="" />` desugars to
 * `Field.StringInput(label, value, style)`. The control value surfaces under
 * a meaningful prop key per member (`value` / `checked` / `values`); the
 * `FieldStyle & <control>Style` fields spread in.
 *
 * Each member destructures its own typed props and calls the factory
 * directly — so the wiring (which prop reaches which positional) is
 * type-checked, not cast away.
 */

import { Field as FieldFactory } from "../../forms/field/index.js";
import { hasKeys, type JsxTag } from "../combinators.js";

/** Props for a `(label, value, style?)` Field member, with the value under prop `K`. */
type FieldValueProps<F extends (...a: never[]) => unknown, K extends string> =
    { label: Parameters<F>[0] } & Record<K, Parameters<F>[1]> & NonNullable<Parameters<F>[2]>;

/** Props for `<Field.Select>` — `(label, value, items, style?)`. */
type FieldSelectProps =
    {
        label: Parameters<typeof FieldFactory.Select>[0];
        value: Parameters<typeof FieldFactory.Select>[1];
        items: Parameters<typeof FieldFactory.Select>[2];
    } & NonNullable<Parameters<typeof FieldFactory.Select>[3]>;

/** Props for `<Field.FileUpload>` — `(label, style?)`. */
type FieldFileUploadProps =
    { label: Parameters<typeof FieldFactory.FileUpload>[0] }
    & NonNullable<Parameters<typeof FieldFactory.FileUpload>[1]>;

/**
 * Labelled form-control tags keyed by control type — e.g.
 * `<Field.StringInput label="Email" value="" />`,
 * `<Field.Checkbox label="Accept" checked={false} />`,
 * `<Field.Select label="Country" value="" items={[Select.Item(…)]} />`.
 */
export const Field: {
    StringInput: JsxTag<FieldValueProps<typeof FieldFactory.StringInput, "value">>;
    IntegerInput: JsxTag<FieldValueProps<typeof FieldFactory.IntegerInput, "value">>;
    FloatInput: JsxTag<FieldValueProps<typeof FieldFactory.FloatInput, "value">>;
    DateTimeInput: JsxTag<FieldValueProps<typeof FieldFactory.DateTimeInput, "value">>;
    Textarea: JsxTag<FieldValueProps<typeof FieldFactory.Textarea, "value">>;
    Slider: JsxTag<FieldValueProps<typeof FieldFactory.Slider, "value">>;
    Checkbox: JsxTag<FieldValueProps<typeof FieldFactory.Checkbox, "checked">>;
    Switch: JsxTag<FieldValueProps<typeof FieldFactory.Switch, "checked">>;
    TagsInput: JsxTag<FieldValueProps<typeof FieldFactory.TagsInput, "values">>;
    Select: JsxTag<FieldSelectProps>;
    FileUpload: JsxTag<FieldFileUploadProps>;
    Types: typeof FieldFactory.Types;
} = {
    StringInput: ({ label, value, ...style }) =>
        FieldFactory.StringInput(label, value, hasKeys(style) ? style : undefined),
    IntegerInput: ({ label, value, ...style }) =>
        FieldFactory.IntegerInput(label, value, hasKeys(style) ? style : undefined),
    FloatInput: ({ label, value, ...style }) =>
        FieldFactory.FloatInput(label, value, hasKeys(style) ? style : undefined),
    DateTimeInput: ({ label, value, ...style }) =>
        FieldFactory.DateTimeInput(label, value, hasKeys(style) ? style : undefined),
    Textarea: ({ label, value, ...style }) =>
        FieldFactory.Textarea(label, value, hasKeys(style) ? style : undefined),
    Slider: ({ label, value, ...style }) =>
        FieldFactory.Slider(label, value, hasKeys(style) ? style : undefined),
    Checkbox: ({ label, checked, ...style }) =>
        FieldFactory.Checkbox(label, checked, hasKeys(style) ? style : undefined),
    Switch: ({ label, checked, ...style }) =>
        FieldFactory.Switch(label, checked, hasKeys(style) ? style : undefined),
    TagsInput: ({ label, values, ...style }) =>
        FieldFactory.TagsInput(label, values, hasKeys(style) ? style : undefined),
    Select: ({ label, value, items, ...style }) =>
        FieldFactory.Select(label, value, items, hasKeys(style) ? style : undefined),
    FileUpload: ({ label, ...style }) =>
        FieldFactory.FileUpload(label, hasKeys(style) ? style : undefined),
    Types: FieldFactory.Types,
};
