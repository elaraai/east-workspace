/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio list (#1671, LST-1, LST-2): its answer read into its rows — one a
 * group of its item, in its order: the item's name, a caption under it (the
 * caption field's value in the group's first row), up to two values in
 * short, each with its unit (`612k AUD`), and, with the ranking bar on, the
 * first value's share of the largest. Its item's first N; a list cut says
 * what it holds of how many.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import type { QueryWords } from "../../query/model/words.js";
import { valueText } from "../../query/results-table.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import type { ClickedGroup } from "../../query/visual/clicks.js";
import { visualValues, type VisualAsk } from "../../query/visual/print.js";
import { partsAt, readGroups } from "../../query/visual/read.js";
import type { StudioMessages } from "../messages.js";
import { groupLabel, shortValue, unitLabel, visualWords, type VisualShown, type VisualSource, type VisualView } from "./values.js";

/** A list's view: its item, its caption, its values, and whether it ranks them with a bar. */
export type ListView = Extract<VisualView, { type: "list" }>["value"];

/**
 * One value of a list's row, as it prints.
 *
 * @property text - The value, in short as every tile's number is — `612k`; `no data` where it has none
 * @property unit - Its unit after it — a currency's code, a count's source; `undefined` for none, and beside no value
 */
export interface ListValue {
    /** The value, in short as every tile's number is — `612k`; `no data` where it has none. */
    readonly text: string;
    /** Its unit after it — a currency's code, a count's source; `undefined` for none, and beside no value. */
    readonly unit: string | undefined;
}

/**
 * One row of a list.
 *
 * @property name - Its item's name
 * @property caption - What it says under its name; `undefined` with no caption
 * @property values - Its values, two at most
 * @property share - Its first value as a share of the largest, from 0 to 1 — its bar; `undefined` with none
 * @property clicked - The group it stands for: what a click on it is made on (LST-3)
 */
export interface ListRow {
    /** Its item's name. */
    readonly name: string;
    /** What it says under its name; `undefined` with no caption. */
    readonly caption: string | undefined;
    /** Its values, two at most. */
    readonly values: readonly ListValue[];
    /** Its first value as a share of the largest, from 0 to 1 — its bar; `undefined` with none. */
    readonly share: number | undefined;
    /** The group it stands for: what a click on it is made on (LST-3). */
    readonly clicked: readonly ClickedGroup[];
}

/**
 * A list, read from its answer.
 *
 * @property rows - Its rows, in its item's order
 * @property bar - Whether its rows carry the ranking bar
 * @property shown - What it holds of how many items, when it holds fewer; `undefined` when it holds them all
 */
export interface ListModel {
    /** Its rows, in its item's order. */
    readonly rows: readonly ListRow[];
    /** Whether its rows carry the ranking bar. */
    readonly bar: boolean;
    /** What it holds of how many items, when it holds fewer; `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/**
 * A list's model, from its answer (LST-1, LST-2).
 *
 * @param list - The list
 * @param asks - Its asks, as the printer gave them
 * @param answers - Their answers
 * @param source - Its source
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The model; `undefined` when its program did not answer
 *
 * @remarks
 * - **The rows** are its program's groups, in its item's order — by key, or
 *   by the first value high or low — its first N where its item keeps N.
 * - **A bar** is the row's first value over the largest first value among
 *   the rows drawn; a value under 0, or a largest of 0, draws none.
 */
export function listModel(list: ListView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages): ListModel | undefined {
    const values = visualValues(variant("list", list));
    const read = readGroups(asks, answers, values, "groups");
    const keyType = read?.keyTypes[0];
    if (read === undefined || keyType === undefined) return undefined;
    const said = visualWords(words, m);
    const f = said.formatters;
    const kept = list.item.top.type === "none" ? read.groups : read.groups.slice(0, Number(list.item.top.value));
    const captionType = read.extraTypes.get("c");
    const firsts = kept.map((group) => partsAt(group.parts, 0));
    const largest = Math.max(0, ...firsts.filter((first): first is number => first !== undefined));
    const units = values.map((value) => unitLabel(value, source, m));
    const rows = kept.map((group, i): ListRow => ({
        name: groupLabel(group.keys[0], keyType, list.item, said, m),
        caption: captionType === undefined || list.caption.type === "none" ? undefined : valueText(captionType, group.extras.get("c"), said, list.caption.value),
        values: values.map((_value, v): ListValue => {
            const at = partsAt(group.parts, v);
            return at === undefined ? { text: m.noValue(), unit: undefined } : { text: shortValue(at, values[v]!, source, f), unit: units[v] };
        }),
        share: largest <= 0 || firsts[i] === undefined ? undefined : Math.max(0, firsts[i]!) / largest,
        clicked: [{ group: list.item, key: group.keys[0], type: keyType }],
    }));
    const of = Math.max(read.of, read.groups.length);
    return { rows, bar: list.bar, shown: kept.length < of ? { shown: kept.length, of } : undefined };
}
