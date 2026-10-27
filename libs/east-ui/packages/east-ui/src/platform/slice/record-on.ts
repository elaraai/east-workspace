/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A generated index's `on` (#1432): the row fields it is led by, nested in its
 * key beside e3's own parts — `{ on, node, at }`, `{ on, area }`,
 * `{ on, tile, key }`. A range bounds the key flattened, so a planner's ranges
 * name the leading values one by one; a search of the key's own fields names
 * `on` as one literal, which this prints.
 */
import { parseFor, printFor, type EastType, type StructType } from "@elaraai/east";

/**
 * A generated index's leading values as one `.east` literal of its `on`: each
 * value — a field's `.east` literal, in the index's order — parsed at its
 * field's type, and the struct printed at `on`'s type, never text joined by
 * hand.
 */
export type RecordOnPrinter = (values: readonly string[]) => string;

/** Each generated index's `on` printer, by its name: what a planner names its leading values with. */
export type RecordOnPrinters = (index: string) => RecordOnPrinter;

/**
 * The `on` printer of a generated index, from its key's `on` type.
 *
 * @param on - The index key's `on`: a struct of the leading fields at their key types
 * @returns The printer
 */
export function recordOnPrinter(on: StructType): RecordOnPrinter {
    const names = Object.keys(on.fields);
    const parsers = names.map((name) => parseFor(on.fields[name] as EastType));
    const print = printFor(on);
    return (values) => {
        if (values.length !== names.length) {
            throw new Error(`A generated index led by ${names.length} field${names.length === 1 ? "" : "s"} names ${values.length} leading value${values.length === 1 ? "" : "s"}`);
        }
        const parsed: Record<string, unknown> = {};
        names.forEach((name, i) => {
            const result = parsers[i]!(values[i]!);
            if (!result.success) throw new Error(`'${name}' is not a value of its field: ${result.error}`);
            parsed[name] = result.value;
        });
        return print(parsed);
    };
}

/**
 * A generated index's `on` type, read off its key type: the struct its key
 * names `on`, or `undefined` for a plain index's key.
 *
 * @param keyType - The index's key type
 * @returns Its `on`, or `undefined`
 */
export function recordOnTypeOf(keyType: EastType | undefined): StructType | undefined {
    if (keyType?.type !== "Struct") return undefined;
    const on = (keyType as StructType).fields.on as EastType | undefined;
    return on?.type === "Struct" ? on as StructType : undefined;
}

/**
 * The `on` printers of a binding's generated indexes, from its index key types
 * (`IndexedSourceType`'s `IK`, a variant over the indexes), each made once.
 *
 * @param indexKeys - The binding's index key types, by index name
 * @returns The printers; refusing an index whose key holds no `on`
 */
export function recordOnPrinters(indexKeys: Readonly<Record<string, EastType>>): RecordOnPrinters {
    const made = new Map<string, RecordOnPrinter>();
    return (index) => {
        let printer = made.get(index);
        if (printer === undefined) {
            const on = recordOnTypeOf(indexKeys[index]);
            if (on === undefined) throw new Error(`'${index}' is no generated index: its key holds no on`);
            printer = recordOnPrinter(on);
            made.set(index, printer);
        }
        return printer;
    };
}
