/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a well's pill opens in a visual's Configure tab (#1672).
 *
 * - **A value's menu** (EDT-6): its aggregate — the measures its field may
 *   take (EDT-4, East's `fieldMeasures`), or a number per another number, a
 *   ratio — then its period, its goal, which way is better, how its numbers
 *   are shown — as its field's format says, or a format of its own, a
 *   currency's code in a block under the choice — and its own label; a
 *   combo's value, the axis it is drawn against.
 * - **A group's popover** (EDT-7): its bucket, for a date field; its order;
 *   and how many groups it keeps, the rest folding into Other.
 *
 * Each is drawn as the spec's editor draws it (the `studioInspector` recipe's
 * `menu`): a value's aggregates as a menu's items under their head, each with
 * its icon, the chosen one tinted; then, under a rule, a form over the pill's
 * struct (`FieldForm`), its choices drawn as segment groups
 * ({@link segControls}). Each change is one edit of the pill, handed to its
 * well, which writes the visual's view.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { StringType, StructType, equalFor, isValueOf, variant, type ValueTypeOf } from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";
import { Studio, StudioFormatChoiceType, choiceFormat, editedFormatChoice, formatChoice, pillFields } from "@elaraai/e3-ui/internal";
import { FieldForm } from "@elaraai/east-ui-components";
import { Chooser, type ChooserSection } from "@elaraai/east-ui-components/internal";

import { useStudioMessages } from "./messages.js";
import { SegStrip, segControls } from "./seg.js";
import { studioEast } from "./studio-east.js";
import { fieldLabel, type VisualSource } from "./visual/values.js";

type Styles = Record<string, SystemStyleObject>;

/** A value of a visual. */
export type PillValue = ValueTypeOf<typeof Studio.Types.Value>;
/** What a visual groups by. */
export type PillGroup = ValueTypeOf<typeof Studio.Types.Group>;
/** A source's field. */
type Field = VisualSource["fields"][number];

const stringEqual = equalFor(StringType);
/** The buckets a date is offered, in order: an hour's and the automatic one only while a group holds them. */
const BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
/** Every bucket a group may hold. */
const UNITS = ["auto", "hour", ...BUCKETS] as const;
/** The order a value's menu's form draws its fields in, after its aggregate. */
const VALUE_ORDER = ["period", "goal", "better", "format", "label"] as const;
/**
 * A value as its menu's form edits it: its fields, its format the choice the
 * menu offers — as its field's a case of its own (e3-ui's `formatChoice`) —
 * so the form draws it as it draws any choice, a currency's code in a block
 * under it.
 */
const ValueFormType = StructType({ ...Studio.Types.Value.fields, format: StudioFormatChoiceType });
/** A currency format's code until its field says one, or the reader does. */
const DEFAULT_CURRENCY = "USD";
/** A value's fields of more than three cases whose names are short enough for segments: its format's. */
const VALUE_SHORT_NAMED = ["format"] as const;
/** The order a group's popover's form draws its fields in. */
const GROUP_ORDER = ["bucket", "sort", "top"] as const;
/** A group's fields of more than three cases whose names are short enough for segments: a date's buckets. */
const SHORT_NAMED = ["bucket"] as const;
/** Each aggregate's icon in a value's menu, as the spec draws them. */
const AGGREGATE_ICONS: Readonly<Record<string, IconName>> = {
    count: "list-ol", sum: "plus", mean: "divide", min: "arrow-down", max: "arrow-up", distinct: "fingerprint", ratio: "percent",
};

/** Specs in an order: each field named in it, in its place. */
function ordered(specs: readonly FieldSpecValue[], order: readonly string[]): FieldSpecValue[] {
    return order.flatMap((field) => specs.filter((spec) => stringEqual(spec.path[0] ?? "", field)));
}

/** The field a value is of: its measure's, a ratio's first; none for a count. */
function valueField(value: PillValue): string | undefined {
    return pillFields(variant("value", value))[0];
}

/** Props of {@link ValueMenu}. */
export interface ValueMenuProps {
    /** The value. */
    value: PillValue;
    /** The source its fields are of. */
    source: VisualSource;
    /** A combo's value: the side it is drawn against, and what a change of it does. */
    axis?: { right: boolean; onRight: (right: boolean) => void } | undefined;
    /** Told the value as an edit leaves it. */
    onChange: (value: PillValue) => void;
}

/**
 * A value pill's menu — see the module docs.
 *
 * @param props - The value, its source, a combo's axis, and where an edit goes
 * @returns The menu's body
 */
export function ValueMenu({ value, source, axis, onChange }: ValueMenuProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const east = studioEast();
    // Asking for the field a ratio is per.
    const [asking, setAsking] = useState(false);
    const of = valueField(value);
    const field = of === undefined ? undefined : source.fields.find((f) => stringEqual(f.id, of));
    const measures = useMemo(() => (field === undefined ? [] : east.fieldMeasures(field)), [east, field]);
    const numbers = field !== undefined && field.kind.type === "number";
    const measure = value.measure;
    const choices = [
        ...(measures.length === 0
            ? [{ id: "count", label: m.aggregate({ measure: "count", per: "" }), active: true }]
            : measures.map((offered) => ({ id: offered.type, label: m.aggregate({ measure: offered.type, per: "" }), active: stringEqual(offered.type, measure.type) }))),
        ...(numbers ? [{
            id: "ratio",
            label: measure.type === "ratio" ? m.aggregate({ measure: "ratio", per: fieldLabel(source, measure.value.per) }) : m.perAnother(),
            active: measure.type === "ratio",
        }] : []),
    ];
    const pick = (id: string) => {
        if (stringEqual(id, "ratio")) {
            setAsking(true);
            return;
        }
        const chosen = measures.find((offered) => stringEqual(offered.type, id));
        if (chosen !== undefined && !stringEqual(chosen.type, measure.type)) onChange({ ...value, measure: chosen });
    };
    const specs = useMemo(() => ordered(Fields.specs(ValueFormType, {
        label: Fields.text({ label: m.valueLabel() }),
        period: Fields.select({ label: m.period(), labels: { current: m.periodName({ period: "current" }), previous: m.periodName({ period: "previous" }), year_ago: m.periodName({ period: "year_ago" }) } }),
        goal: Fields.number({ label: m.goal() }),
        better: Fields.select({ label: m.better(), labels: { higher: m.betterName({ better: "higher" }), lower: m.betterName({ better: "lower" }) } }),
        format: Fields.select({
            label: m.format(), help: m.formatHelp(),
            labels: {
                auto: m.formatName({ format: "auto" }), number: m.formatName({ format: "number" }),
                percent: m.formatName({ format: "percent" }), currency: m.formatName({ format: "currency" }),
            },
            cases: { currency: Fields.text({ label: m.currencyCode() }) },
        }),
    }, ["measure"]), VALUE_ORDER), [m]);
    // The value as the form edits it: its format the choice the menu offers.
    const choice = useMemo(() => formatChoice(value.format), [value.format]);
    const edited = useMemo(() => ({ ...value, format: choice }), [value, choice]);
    // The currency its field's format declares: what a currency format of its own starts as.
    const fieldCurrency = field !== undefined && field.format.type === "some" && field.format.value.type === "currency" ? field.format.value.value.code : DEFAULT_CURRENCY;
    const onForm = useCallback((path: readonly string[], next: unknown) => {
        const name = path[0] ?? "";
        if (stringEqual(name, "format")) {
            // A case picked, or a currency's code — e3-ui's rule: a currency picked starts as its field's.
            const result = editedFormatChoice(choice, path.slice(1), next, fieldCurrency);
            if ("refused" in result) return result.refused === "code" ? m.currencyCodeNeeded() : m.cannotSet({ label: m.format() });
            onChange({ ...value, format: choiceFormat(result.choice, value.format) });
            return undefined;
        }
        const changed = { ...value, [name]: next };
        if (!isValueOf(changed, Studio.Types.Value)) return m.cannotSet({ label: name });
        onChange(changed);
        return undefined;
    }, [value, choice, fieldCurrency, onChange, m]);
    if (asking && of !== undefined) {
        const sections: ChooserSection[] = [{
            label: m.fieldGroup({ numbers: true }),
            options: source.fields.filter((f) => f.kind.type === "number" && !stringEqual(f.id, of)).map((f) => ({
                key: f.id, label: f.label, state: measure.type === "ratio" && stringEqual(measure.value.per, f.id) ? "current" : "enabled",
            })),
        }];
        return (
            <Box css={styles.menu} data-pill-menu="per">
                <Box as="span" css={styles.menuHead}>{m.perField()}</Box>
                <Chooser sections={sections} placeholder={m.findField()} surface="inline" autoFocus onClose={() => setAsking(false)}
                    onChoose={(per) => {
                        setAsking(false);
                        onChange({ ...value, measure: variant("ratio", { of, per }) });
                    }} />
            </Box>
        );
    }
    return (
        <Box css={styles.menu} data-pill-menu="value">
            <Box as="span" css={styles.menuHead} aria-hidden>{m.aggregates()}</Box>
            <Box role="radiogroup" aria-label={m.aggregates()} data-pill-aggregates="">
                {choices.map((choice) => (
                    <chakra.button key={choice.id} type="button" css={styles.menuItem} role="radio" aria-checked={choice.active} data-aggregate={choice.id}
                        onClick={() => pick(choice.id)}>
                        <Box as="span" css={styles.menuItemIcon} aria-hidden><FontAwesomeIcon icon={["fas", AGGREGATE_ICONS[choice.id] ?? "hashtag"]} /></Box>
                        {choice.label}
                    </chakra.button>
                ))}
            </Box>
            <Box css={styles.menuRule} role="separator" />
            <Box css={styles.menuForm}>
                {axis !== undefined && (
                    <Box css={styles.fld} role="group" aria-label={m.axis()}>
                        <Box as="span" css={styles.fldLabel} aria-hidden>{m.axis()}</Box>
                        <SegStrip label={m.axis()} name="axis" current={axis.right ? "right" : "left"}
                            options={[{ key: "left", label: m.axisSide({ right: false }) }, { key: "right", label: m.axisSide({ right: true }) }]}
                            onPick={(side) => axis.onRight(stringEqual(side, "right"))} />
                    </Box>
                )}
                <FieldForm specs={specs} value={edited} renderControl={segControls(edited, VALUE_SHORT_NAMED)} onChange={onForm} />
            </Box>
        </Box>
    );
}

/** Props of {@link GroupMenu}. */
export interface GroupMenuProps {
    /** What the visual groups by. */
    group: PillGroup;
    /** Its field, as its source lists it; `undefined` for one the source does not have. */
    field: Field | undefined;
    /** Told the group as an edit leaves it. */
    onChange: (group: PillGroup) => void;
}

/**
 * A group pill's popover — see the module docs.
 *
 * @param props - The group, its field, and where an edit goes
 * @returns The popover's body
 */
export function GroupMenu({ group, field, onChange }: GroupMenuProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const date = field !== undefined && field.kind.type === "date";
    const held = group.bucket.type === "some" ? group.bucket.value.type : undefined;
    const specs = useMemo(() => ordered(Fields.specs(Studio.Types.Group, {
        bucket: Fields.select({ label: m.bucket() }),
        sort: Fields.select({
            label: m.order(),
            labels: {
                natural: m.orderName({ sort: "natural", date }), high: m.orderName({ sort: "high", date }),
                low: m.orderName({ sort: "low", date }), label: m.orderName({ sort: "label", date }),
            },
        }),
        top: Fields.number({ label: m.keepFirst(), help: m.keepFirstHelp(), min: 1n }),
    }, date ? ["field"] : ["field", "bucket"]), GROUP_ORDER).map((spec) => {
        // A date's buckets, in the words its chip says them in: an hour's and the automatic one only while it holds them.
        if (!stringEqual(spec.path[0] ?? "", "bucket") || spec.editor.type !== "select") return spec;
        const offered = spec.editor.value.flatMap((option) => {
            const unit = UNITS.find((u) => stringEqual(u, option.case));
            const shown = unit !== undefined && (BUCKETS.some((u) => stringEqual(u, unit)) || (held !== undefined && stringEqual(held, unit)));
            return shown ? [{ ...option, label: m.bucketName({ unit }) }] : [];
        });
        return { ...spec, editor: variant("select", offered) };
    }), [m, date, held]);
    const onForm = useCallback((path: readonly string[], next: unknown) => {
        const edited = { ...group, [path[0] ?? ""]: next };
        if (!isValueOf(edited, Studio.Types.Group)) return m.cannotSet({ label: path[0] ?? "" });
        onChange(edited);
        return undefined;
    }, [group, onChange, m]);
    return (
        <Box css={styles.menu} data-pill-menu="group">
            <Box css={styles.menuForm}>
                <FieldForm specs={specs} value={group} renderControl={segControls(group, SHORT_NAMED)} onChange={onForm} />
            </Box>
        </Box>
    );
}

/**
 * What a value pill's chip says (EDT-6): its aggregate — `Sum` — or what a
 * ratio is per — `Per unit`.
 *
 * @param value - The value
 * @param source - The source its fields are of; `undefined` for one the surface does not list
 * @param m - The Studio's words
 * @returns The chip's words
 */
export function aggregateWords(value: PillValue, source: VisualSource | undefined, m: ReturnType<typeof useStudioMessages>): string {
    const measure = value.measure;
    if (measure.type !== "ratio") return m.aggregate({ measure: measure.type, per: "" });
    return m.aggregate({ measure: "ratio", per: source === undefined ? measure.value.per : fieldLabel(source, measure.value.per) });
}

/**
 * What a group pill's chip says (EDT-7): its bucket — `Month` — else its
 * order — `High first`.
 *
 * @param group - The group
 * @param field - Its field, as its source lists it
 * @param m - The Studio's words
 * @returns The chip's words
 */
export function groupWords(group: PillGroup, field: Field | undefined, m: ReturnType<typeof useStudioMessages>): string {
    if (group.bucket.type === "some") return m.bucketName({ unit: group.bucket.value.type });
    return m.orderName({ sort: group.sort.type, date: field !== undefined && field.kind.type === "date" });
}
