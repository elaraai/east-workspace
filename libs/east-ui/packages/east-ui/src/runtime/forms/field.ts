/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Field.*>` namespace tags — see the export's JSDoc.
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
 * Labelled form control — wraps an underlying input with a `label` and the
 * surrounding form chrome (`helperText`, `errorText`, `required`, `invalid`,
 * `schemaKey`). Reach for it to build proper form rows rather than dropping a
 * bare input on the page. The member name picks the control; the value surfaces
 * under a control-appropriate prop:
 *
 * - `<Field.StringInput>` / `IntegerInput` / `FloatInput` / `DateTimeInput` — the
 *   typed text/number/date inputs, value under `value`.
 * - `<Field.Textarea>` — multi-line text, value under `value`.
 * - `<Field.Slider>` — numeric slider, value under `value`.
 * - `<Field.Checkbox>` / `<Field.Switch>` — boolean toggles, value under `checked`.
 * - `<Field.TagsInput>` — multi-tag entry, value under `values`.
 * - `<Field.Select>` — dropdown, value under `value` with an `items` list.
 * - `<Field.FileUpload>` — file picker (label only, no value prop).
 *
 * Each member also accepts its wrapped control's own style props.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Field, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const form = East.function([], UIComponentType, _$ => (
 *     <VStack gap="4" align="stretch" width="100%">
 *         <Field.StringInput label="Email" value="" schemaKey="user.email" helperText="We'll never share your email." placeholder="you@example.com" />
 *         <Field.StringInput label="Password" value="" schemaKey="user.password" required={true} errorText="Password is required" invalid={true} placeholder="Enter password" />
 *     </VStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Field.Types`. Bind the control value to state and wire its `onChange`
 * inside a `<Reactive>` block for a live, validating field. Each member desugars
 * to `Field.<Member>(label, value, style)` (`Field.Select` adds `items`;
 * `Field.FileUpload` takes only `label`).
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
