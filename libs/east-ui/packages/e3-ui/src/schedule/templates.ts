/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, DictType, East, Expr, OptionType, StringType, StructType, isTypeEqual, none, printType, variant,
    type BlobType, type BlockBuilder, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { ScheduleClockType, ScheduleDurationType, ScheduleTemplateType } from "./types.js";
import { keyTextOf } from "./window.js";

/** Identifies a declaration of templates read from keyed data. */
export const SCHEDULE_TEMPLATES: unique symbol = Symbol("Schedule.templates");

/** Templates over live keyed data, with their initial event values typed. */
export interface ScheduleTemplates<V extends StructType> {
    /** Identifies the declaration. */
    readonly [SCHEDULE_TEMPLATES]: true;
    /** The type of the initial values, excluding the fields a drop places. */
    readonly valuesType: V;
    /** The templates, with each initial value encoded at its own type. */
    readonly items: ExprType<ArrayType<ScheduleTemplateType>>;
    /** The builder's Slice source whose shown keys filter these templates, by their record keys; `undefined`, every one shows (#1343). */
    readonly source: string | undefined;
    /** Whether each gives how long its event runs (`duration`): a span kind's templates do, an instant kind's do not (#1344). */
    readonly timed: boolean;
    /** Whether each gives when its event starts on a whole day (`at`): a link kind's, whose links have no time, give none (#1541, U10). */
    readonly startsAt: boolean;
}

/** Accessors describing one template record row. Each receives the row and its key. */
export interface ScheduleTemplatesConfig<K extends EastType, R extends EastType, V extends StructType> {
    /** The template's name in the library. */
    name: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** Its optional library group. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Its optional start time for a drop onto a whole day. */
    at?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<ScheduleClockType>>;
    /**
     * The length of an event made from this template: a span kind's templates give it, and an instant kind's
     * (`at`), whose events are one time, give none (#1344).
     */
    duration?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<ScheduleDurationType>;
    /** Every initial event field except its start, end and resource. */
    values: (row: ExprType<R>, key: ExprType<K>) => ExprType<V>;
    /**
     * The builder's `Slice.bindRecords` source over these templates' record (`jobTemplates`): its shown keys filter
     * the Templates tab's cards, each template's key its record key. Omitted, every template shows (#1343).
     */
    source?: string;
}

/**
 * Reads templates from keyed data, usually a bound record's read(). Each
 * accessor is reified once; the source's key identifies the template. Plan
 * and Calendar share this declaration and observe changes to its source.
 *
 * @typeParam K - The template record's key type
 * @typeParam R - Its row type
 * @typeParam V - The initial event values' struct type
 * @param rows - The keyed template rows
 * @param config - The row accessors
 * @returns Templates whose values are checked against their event kind
 * @throws {Error} When the source is not a Dict or the values are not a struct
 */
export function scheduleTemplates<K extends EastType, R extends EastType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: ScheduleTemplatesConfig<K, R, V>,
): ScheduleTemplates<V> {
    const source = East.value(rows) as ExprType<DictType<K, R>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") throw new Error("Schedule.templates: rows must be a Dict, usually a bound record's read()");
    const keyType = type.key as K;
    const rowType = type.value as R;
    const values = East.function([rowType, keyType], undefined, (_$, row, key) => config.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as V;
    if (valuesType.type !== "Struct") throw new Error("Schedule.templates: values must return a struct of initial event fields");
    const describe = templateOf(rowType, keyType, config, values as unknown as TemplateValues<K, R>, keyTextOf(keyType) as unknown as KeyText<K>);
    const items = source.toArray(($, row, key) => {
        const describeRow = $.const(describe);
        return describeRow(row as never, key as never);
    });
    return { [SCHEDULE_TEMPLATES]: true, valuesType, items, source: config.source, timed: config.duration !== undefined, startsAt: config.at !== undefined };
}

/** A row's initial values, reified once: a function of the row and its key. */
type TemplateValues<K extends EastType, R extends EastType> = ExprType<FunctionType<[R, K], EastType>>;

/** A key as text, reified once ({@link keyTextOf}): a String key its own text, any other as East prints it. */
type KeyText<K extends EastType> = ExprType<FunctionType<[K], StringType>>;

/**
 * One template of a keyed row, reified once: its accessors over the row and
 * its key, its values encoded at their own type, and its key by `keyOf`.
 */
function templateOf<K extends EastType, R extends EastType>(
    rowType: R, keyType: K, config: Pick<ScheduleTemplatesConfig<K, R, StructType>, "name" | "group" | "at" | "duration">,
    values: TemplateValues<K, R>, keyOf: KeyText<K>,
) {
    const duration = config.duration;
    return East.function([rowType, keyType], ScheduleTemplateType, ($, row, key) => {
        const text = $.const(keyOf);
        const initial = $.const(values);
        return {
            key: text(key as never), name: config.name(row, key),
            group: config.group === undefined ? none : config.group(row, key),
            at: config.at === undefined ? none : config.at(row, key),
            // An instant kind's template is one time: it lasts no time, as one written in the code does.
            duration: duration === undefined ? variant("minutes", 0) : duration(row, key),
            values: East.Blob.encodeBeast(initial(row as never, key as never), "v2"),
        };
    });
}

/**
 * One card of a library tab and the template it makes an event from (#1541, U1).
 *
 * @property card - The card's key: its row's key as text
 * @property template - The template the card's kind knows it by, its key the kind's own for it
 */
export const ScheduleCardTemplateType = StructType({ card: StringType, template: ScheduleTemplateType });

/** Type representing {@link ScheduleCardTemplateType}. */
export type ScheduleCardTemplateType = typeof ScheduleCardTemplateType;

/** What a drop reads of a template: every part of it but its values, which stay with its kind, whose `write` makes the event. */
const { values: _values, ...TEMPLATE_HEAD } = ScheduleTemplateType.fields;

/**
 * A template as a drop reads it: its key, its name, its group, when it starts
 * on a whole day and how long its event runs — a template less its values.
 */
export const ScheduleTemplateHeadType = StructType(TEMPLATE_HEAD);

/** Type representing {@link ScheduleTemplateHeadType}. */
export type ScheduleTemplateHeadType = typeof ScheduleTemplateHeadType;

/**
 * One card of a library tab and what a drop reads of the template it makes an
 * event from (#1541, U1), as the tab carries them: the template's values stay
 * with its kind.
 *
 * @property card - The card's key: its row's key as text
 * @property template - What a drop reads of the card's template
 */
export const ScheduleCardMadeType = StructType({ card: StringType, template: ScheduleTemplateHeadType });

/** Type representing {@link ScheduleCardMadeType}. */
export type ScheduleCardMadeType = typeof ScheduleCardMadeType;

/**
 * Some cards' templates as their tab carries them ({@link ScheduleCardMadeType}): each without its values.
 *
 * @param cards - The cards with their templates, bound once
 * @returns Each card with what a drop reads of its template
 */
export function scheduleCardsMade(cards: ExprType<ArrayType<ScheduleCardTemplateType>>): ExprType<ArrayType<ScheduleCardMadeType>> {
    const names = Object.keys(TEMPLATE_HEAD);
    return cards.map((_$, one) => East.value({
        card: one.card, template: East.struct(ScheduleTemplateHeadType, East.fields(one.template, names)),
    }, ScheduleCardMadeType)) as ExprType<ArrayType<ScheduleCardMadeType>>;
}

/**
 * The key a card's template stands under: its tab's name and its card's key,
 * as East prints the two together, `(tab="Orders", card="O-1")` — so no two
 * tabs' cards share one, however their names and their keys read run
 * together.
 */
const CardTemplateKeyType = StructType({ tab: StringType, card: StringType });

/** The accessors a library tab's `create` gives over one of its rows: what a card makes an event from. */
export interface ScheduleCardTemplatesConfig<K extends EastType, R extends EastType> extends Pick<ScheduleTemplatesConfig<K, R, StructType>, "name" | "group" | "at" | "duration"> {
    /** The new event's own fields: every field of its kind's row but its start, its end and its resource. */
    values: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<EastType>;
}

/**
 * The templates a library tab's cards make events of a kind from (#1541, U1):
 * one per row, as `Schedule.templates` makes them, each under a key of the
 * tab's own — its tab and its row's key, as East prints the pair — so no
 * other tab's card stands under it, its values held to the kind's.
 *
 * @typeParam K - The rows' key type
 * @typeParam R - Their row type
 * @param rows - The tab's rows: a `Dict<K, R>` expression
 * @param keyType - Their key type
 * @param rowType - Their row type
 * @param config - The accessors over a row
 * @param valuesType - What the kind's templates give: its row less the fields a drop places
 * @param tab - The tab's name, which is its own among the library's
 * @param where - What a refusal names: the builder and the tab
 * @returns Each card's key with its template
 * @throws {Error} When `values` gives other than the kind's values
 */
export function scheduleCardTemplates<K extends EastType, R extends EastType>(
    rows: ExprType<DictType<K, R>>, keyType: K, rowType: R, config: ScheduleCardTemplatesConfig<K, R>, valuesType: StructType, tab: string, where: string,
): ExprType<ArrayType<ScheduleCardTemplateType>> {
    let values: TemplateValues<K, R>;
    try {
        values = East.function([rowType, keyType], valuesType, (_$, row, key) =>
            East.value(config.values(row, key) as SubtypeExprOrValue<StructType>, valuesType)) as unknown as TemplateValues<K, R>;
    } catch (err) {
        throw new Error(`${where}'s \`create.values\` gives the new event's own fields — every field of its kind's row but its start, its end and ` +
            `its resource, ${printType(valuesType)} — and these are not: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = keyTextOf(keyType) as unknown as KeyText<K>;
    const keyOf = East.function([keyType], StringType, ($, key) => {
        const own = $.const(text);
        return East.print(East.value({ tab, card: own(key as never) }, CardTemplateKeyType));
    }) as unknown as KeyText<K>;
    const describe = templateOf(rowType, keyType, config, values, keyOf);
    return rows.toArray(($, row, key) => {
        const describeRow = $.const(describe);
        const own = $.const(text);
        return East.value({ card: own(key as never), template: describeRow(row as never, key as never) }, ScheduleCardTemplateType);
    }) as ExprType<ArrayType<ScheduleCardTemplateType>>;
}

/**
 * A new row's values, where a template may give them: what every kind's `create` starts its row from, whichever
 * builder the kind is of. The template's values are decoded at the values' type; a row made from no template takes
 * what `otherwise` builds.
 *
 * @param values - The template's values as bytes; none for a row made from no template
 * @param valuesType - The values' type: the row's fields less what the gesture places
 * @param otherwise - What a row made from no template takes, built in the block it is given
 * @returns The values
 */
export function templateValues(
    values: ExprType<OptionType<BlobType>>, valuesType: StructType, otherwise: ($: BlockBuilder<EastType>) => ExprType<EastType>,
): ExprType<EastType> {
    return values.match({
        some: (_$, bytes) => bytes.decodeBeast(valuesType, "v2") as ExprType<EastType>,
        none: ($) => otherwise($ as never),
    }) as ExprType<EastType>;
}

/** Checks a bound template's initial values against the fields its kind requires. */
export function checkedTemplates(templates: ScheduleTemplates<StructType>, expected: StructType, where: string): ExprType<ArrayType<ScheduleTemplateType>> {
    if (!isTypeEqual(templates.valuesType, expected)) {
        throw new Error(where + ": templates.values must supply the event's fields except start, end and resource; expected "
            + printType(expected) + ", received " + printType(templates.valuesType));
    }
    return templates.items;
}
