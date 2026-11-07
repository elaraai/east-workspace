/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kind's keys as the Flowchart and the Schematic speak them (#1549): a
 * kind's record may be keyed by any type a Dict takes, and every key travels
 * as its text — a String key as itself, any other as East prints it — which a
 * reference, a row's id, the drawing and a kind's `rowsOf` name a row by. A
 * text is read back at the record's key type where the record is read by key,
 * asked of its narrowing or sought; and where a builder orders keys, it orders
 * them by their type, each text parsed once — never inside a comparison — and
 * never by their text.
 *
 * A new row's key is typed in the inspector where its kind makes none (#1549):
 * its field is the form's own editor for the key type — a struct key's fields,
 * a date's input, a number's — and a type the form can't type, a Blob or a
 * recursive type among them, keys no row the viewer adds. Until it is typed the
 * row is held under a placeholder — a text no key prints as — and read as keyed
 * by the type's default, as a kind's `read`, which reads its key back, takes it.
 *
 * @packageDocumentation
 */

import {
    StringType, StructType, compareFor, defaultValue, fromEastTypeValue, none, parseFor, printFor, some, toEastTypeValue, variant,
    type EastType, type EastTypeValue,
} from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui/internal";

const compareString = compareFor(StringType);

/** A key's text, beside the key it reads back as: `undefined` for a text no key prints as. */
export interface KeyText {
    /** The text. */
    readonly text: string;
    /** The key, at the record's key type; `undefined` for a text no key prints as. */
    readonly key: unknown;
}

/** A kind's keys (see the module docs). */
export interface KindKeys {
    /** The record's key type. */
    readonly keyType: EastTypeValue;
    /** Whether the record is keyed by String: a key's text is the key itself. */
    readonly text: boolean;
    /** A key's text: a String key as itself, any other as East prints it. */
    readonly textOf: (key: unknown) => string;
    /** A text read back at the record's key type; `undefined` for a text no key prints as. */
    readonly keyOf: (text: string) => unknown;
    /**
     * Some keys' texts in their keys' order at the record's key type, each beside its key: each read back once, and a
     * text no key prints as after every key, in its text's order.
     */
    readonly order: (texts: Iterable<string>) => KeyText[];
    /** Each of some keys' texts' place in their keys' order ({@link KindKeys.order}): what a sort by something and then by key compares. */
    readonly ranks: (texts: Iterable<string>) => ReadonlyMap<string, number>;
    /** Whether a text is a key's: any text, keyed by String; one that reads back at the record's key type, by any other — never a placeholder. */
    readonly isKey: (text: string) => boolean;
    /**
     * The key's field as the form edits it, under `key`: the form's own editor for the key type (`Fields.specs`) — a
     * struct key's fields, a date's input, a number's. Each spec's words are the form's; {@link keyFieldSpecs} gives
     * them a host's.
     */
    readonly specs: readonly FieldSpecValue[];
    /** Whether the form types a key of the type: an editor for each of its fields, which a Blob or a recursive type has not. */
    readonly typed: boolean;
    /**
     * The text a kind's `read` takes for a row's key, which it reads back at the record's key type: the row's own, or —
     * for a placeholder, which no key prints as — the key type's default, printed, until its key is typed.
     */
    readonly readKey: (text: string) => string;
}

/** Each text's place in an order. */
function ranksOf(order: KindKeys["order"]): KindKeys["ranks"] {
    return (texts) => new Map(order(texts).map(({ text }, i) => [text, i]));
}

/** Each key type's keys, made once a key type. */
const keysOf = new WeakMap<EastTypeValue, KindKeys>();

/** A key's field: the key type under `key`, which the form edits as a struct's field. */
function keySpecsOf(keyType: EastTypeValue): FieldSpecValue[] {
    return Fields.specs(StructType({ key: fromEastTypeValue(keyType) as EastType }));
}

/**
 * A kind's keys (see the module docs), made once for its key type.
 *
 * @param keyType - The kind's record's key type, as its wire carries it: its details' too, which are keyed as it is
 * @returns Its keys' text, a text read back, and their order
 */
export function kindKeys(keyType: EastTypeValue): KindKeys {
    let keys = keysOf.get(keyType);
    if (keys !== undefined) return keys;
    if (keyType.type === "String") {
        const order: KindKeys["order"] = (texts) => [...texts].sort(compareString).map((text) => ({ text, key: text }));
        const specs = keySpecsOf(keyType);
        keys = {
            keyType, text: true, textOf: (key) => key as string, keyOf: (text) => text, order, ranks: ranksOf(order), isKey: () => true,
            specs, typed: true, readKey: (text) => text,
        };
    } else {
        const print = printFor(keyType);
        const parse = parseFor(keyType);
        const compare = compareFor(fromEastTypeValue(keyType)) as (a: unknown, b: unknown) => number;
        const keyOf = (text: string): unknown => {
            const read = parse(text);
            return read.success ? read.value : undefined;
        };
        const order: KindKeys["order"] = (texts) => [...texts].map((text) => ({ text, key: keyOf(text) })).sort((a, b) => {
            if (a.key !== undefined && b.key !== undefined) return compare(a.key, b.key);
            // A text no key prints as — a placeholder — after every key, in its text's order.
            if (a.key !== undefined) return -1;
            if (b.key !== undefined) return 1;
            return compareString(a.text, b.text);
        });
        const specs = keySpecsOf(keyType);
        const standIn = print(defaultValue(fromEastTypeValue(keyType) as EastType));
        keys = {
            keyType, text: false, textOf: (key) => print(key), keyOf, order, ranks: ranksOf(order), isKey: (text) => keyOf(text) !== undefined,
            specs, typed: specs.length > 0 && specs.every((spec) => spec.editor.type !== "readonly"),
            readKey: (text) => (keyOf(text) === undefined ? standIn : text),
        };
    }
    keysOf.set(keyType, keys);
    return keys;
}

/** A record keyed by String's keys: every builder's but the Flowchart's and the Schematic's. */
export const STRING_KEYS: KindKeys = kindKeys(toEastTypeValue(StringType));

/**
 * A row's key field as an inspector shows it, under `key` (#1549): the form's
 * own editor for its kind's key type, labelled as the host names a key, with
 * its help line under it while it takes an edit — printed, while it takes none.
 * A struct key's fields sit under the key's label, each its own name's.
 *
 * @param keys - The kind's keys
 * @param label - What the host calls a key: the field's label, or a struct key's fields' heading
 * @param help - The line under it while it takes an edit
 * @param edits - Whether it takes an edit: a new row's key, the viewer's until Save
 * @returns The specs, at paths under `key`
 */
export function keyFieldSpecs(keys: KindKeys, label: string, help: string | undefined, edits: boolean): FieldSpecValue[] {
    const heading = keys.specs[0]?.group.type === "some" ? keys.specs[0].group.value.split(" · ")[0] : undefined;
    return keys.specs.map((spec, i) => ({
        ...spec,
        label: spec.path.length === 1 ? label : spec.label,
        // A struct key's fields under the host's word for a key, as deep as the key's structs go.
        group: spec.group.type === "some" && heading !== undefined ? some(`${label}${spec.group.value.slice(heading.length)}`) : spec.group,
        help: edits && i === 0 && help !== undefined ? some(help) : none,
        editor: edits ? spec.editor : variant("readonly", null),
    }));
}

/**
 * A key with one of its field's parts edited in the form (#1549): the key as
 * the form's spec at `path` — under `key` — sets it, the rest as the key held
 * them; a key not typed yet starts from its type's default.
 *
 * @param keys - The kind's keys
 * @param held - The key as it stands: `undefined` for a placeholder, typed no key yet
 * @param path - The edited spec's path, from `key` down
 * @param next - Its new value
 * @returns The key
 */
export function keyEdited(keys: KindKeys, held: unknown, path: readonly string[], next: unknown): unknown {
    const within = (at: unknown, rest: readonly string[]): unknown => {
        if (rest.length === 0) return next;
        const [name, ...more] = rest;
        const fields = at as Record<string, unknown>;
        return { ...fields, [name!]: within(fields[name!], more) };
    };
    return within(held ?? defaultValue(fromEastTypeValue(keys.keyType) as EastType), path.slice(1));
}

