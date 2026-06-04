/**
 * Scratch type-level check for the `<Field.*>` JSX tags: the per-member props
 * (value key + control style) must match the corresponding `Field.*` factory.
 * Type-checked by tsc; `@ts-expect-error` lines are negatives that MUST error.
 */

import { Field as FieldFactory, Select } from "@elaraai/east-ui";
import { Field } from "@elaraai/east-ui/jsx";

// ── Positive: each member's flat props mirror its factory ───────────────────
const a = Field.StringInput({ label: "Email", value: "", placeholder: "you@example.com" });
const b = Field.Checkbox({ label: "Accept", checked: false, helperText: "required" });
const c = Field.Select({ label: "Country", value: "", items: [Select.Item("us", "US")] });
const d = Field.FileUpload({ label: "Docs", accept: "application/pdf" });
void [a, b, c, d];

// Parity: the tag and the factory accept the same value type.
const viaFactory = FieldFactory.StringInput("Email", "", { placeholder: "x" });
const viaTag = Field.StringInput({ label: "Email", value: "", placeholder: "x" });
const _same: [typeof viaFactory, typeof viaTag] = [viaFactory, viaTag];
void _same;

// ── Negative: member prop types are enforced (not `any`) ────────────────────

// @ts-expect-error — Checkbox `checked` is a boolean value, not a string
Field.Checkbox({ label: "Accept", checked: "nope" });

// @ts-expect-error — StringInput requires a string `value`, not a number
Field.StringInput({ label: "Email", value: 42 });

// @ts-expect-error — `value` is the wrong key for Checkbox (it uses `checked`)
Field.Checkbox({ label: "Accept", value: false });

// @ts-expect-error — Select requires `items`
Field.Select({ label: "Country", value: "" });
