/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Bound data sources (#935) — the datasets a component may read, as the page
 * that holds it binds them: each a name, the binding's descriptor, and the
 * value's East type, read off the handle.
 *
 * A component handed `datasets={{ orders, customers, bom }}` reads exactly
 * those, by those names. The bindings are already in the `ui()` task's
 * manifest — `Data.bind` under `paths`, `Data.bindPaged` under `pages`,
 * `Record.bind` under `records` — so scope needs nothing new, and each name's
 * type is known before any request.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    East,
    EastTypeType,
    Expr,
    StringType,
    StructType,
    VariantType,
    toEastTypeValue,
    variant,
    type BooleanType,
    type EastType,
    type ExprType,
    type FunctionType,
    type OptionType,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import type { BoundValue, PagedValue } from "./data.js";
import type { RecordBindingType } from "./record.js";

/**
 * A data source a component may read: the name it reads it by, the binding it
 * is, and its value's type.
 *
 * @property name - The name it is read by — a query's root field: `orders` for `.orders`
 * @property source - The binding:
 *   - `paged` — a `Data.bindPaged` handle's `id`: its dataset's path, printed;
 *   - `record` — a `Record.bind` handle's record name;
 *   - `value` — a `Data.bind` handle's dataset path
 * @property type - The value's East type, from the handle's own type
 */
export const DataSourceType = StructType({
    name: StringType,
    source: VariantType({
        paged: StringType,
        record: StringType,
        value: TreePathType,
    }),
    type: EastTypeType,
});

/** Type representing a data source a component may read. */
export type DataSourceType = typeof DataSourceType;

/**
 * A binding a component may read as a data source: a `Data.bind`,
 * `Data.bindPaged` or `Record.bind` handle, over any value type.
 *
 * @remarks
 * The value type is `any` because a handle's East type is invariant in it: a
 * `PagedValue<ArrayType<Order>>` is not a `PagedValue<EastType>`. Each
 * source's type is read off its handle at build time ({@link dataSources}).
 */
export type BoundSource = BoundValue<any> | PagedValue<any> | BoundRecordSource;

/**
 * A `Record.bind` handle as a data source reads it, whatever mutations it is
 * bound with: its `read`, its `mutate` — which tells it from a `Data.bind`
 * handle — and its `binding`, which names the record.
 */
type BoundRecordSource = ExprType<StructType<{
    read: FunctionType<[], any>;
    mutate: StructType<{ pending: FunctionType<[], BooleanType> }>;
    binding: RecordBindingType;
}>>;

/** A name a jq program can read as a root field: `.orders`. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Refuses a data source's name that a jq program can't read as a root field.
 *
 * @param component - The component or function, for the message (`"Query.Builder"`)
 * @param name - The data source's name
 * @throws {Error} When the name is not letters, digits and `_`, not starting
 *   with a digit, naming it
 */
export function assertRootField(component: string, name: string): void {
    if (!IDENTIFIER.test(name)) {
        throw new Error(`${component}: the data source "${name}" can't be read as a root field — name it with letters, digits and _, not starting with a digit`);
    }
}

/** The fields of a handle's East struct. */
function handleFields(handle: BoundSource): Record<string, EastType> {
    const type = Expr.type(handle as unknown as Expr) as EastType;
    if (type.type !== "Struct") throw new Error("Not a Data.bind, Data.bindPaged or Record.bind handle");
    return type.fields as Record<string, EastType>;
}

/**
 * The data sources a component reads, from the bindings it is handed, in the
 * order they are given.
 *
 * @remarks
 * Each binding's kind is told by its handle's East struct: a `page` field is a
 * `Data.bindPaged` handle, a `mutate` field a `Record.bind` handle, and any
 * other a `Data.bind` handle. The descriptor is read off the handle as an East
 * expression — `id`, `binding.name` or `binding.source` — and the value type
 * is written as a literal from the handle's type: `read`'s output, or the
 * element of `page`'s `Option`.
 *
 * @param component - The component, for the messages (`"Query.Builder"`)
 * @param sources - Each data source's name and binding
 * @returns An East expression of the data sources
 * @throws {Error} When a name is not a jq identifier — letters, digits and
 *   `_`, not starting with a digit — naming it; when no source is given; and
 *   when a binding is not a `Data.bind`, `Data.bindPaged` or `Record.bind`
 *   handle
 *
 * @example
 * ```ts
 * const orders = $.let(Data.bindPaged(d.orders));
 * const customers = $.let(Data.bind(d.customers));
 * const sources = dataSources("Query.Builder", { orders, customers });
 * // [{ name: "orders", source: paged(".inputs.orders"), type: … },
 * //  { name: "customers", source: value([inputs, customers]), type: … }]
 * ```
 */
export function dataSources(component: string, sources: Readonly<Record<string, BoundSource>>): ExprType<ArrayType<DataSourceType>> {
    const entries = Object.entries(sources);
    if (entries.length === 0) {
        throw new Error(`${component}: datasets is empty — bind at least one data source for it to read`);
    }
    return East.value(entries.map(([name, handle]) => {
        assertRootField(component, name);
        const fields = handleFields(handle);
        if (fields["page"] !== undefined) {
            // `page(offset, limit)` returns `Option<T>`: the source's type is `T`.
            const page = fields["page"] as FunctionType<[], OptionType<EastType>>;
            const paged = handle as PagedValue<EastType>;
            return { name, source: variant("paged", paged.id), type: toEastTypeValue(page.output.cases.some) };
        }
        const read = fields["read"] as FunctionType<[], EastType> | undefined;
        if (read === undefined) throw new Error(`${component}: the data source "${name}" is not a Data.bind, Data.bindPaged or Record.bind handle`);
        if (fields["mutate"] !== undefined) {
            const record = handle as BoundRecordSource;
            return { name, source: variant("record", record.binding.name), type: toEastTypeValue(read.output) };
        }
        const value = handle as BoundValue<EastType>;
        return { name, source: variant("value", value.binding.source), type: toEastTypeValue(read.output) };
    }), ArrayType(DataSourceType));
}
