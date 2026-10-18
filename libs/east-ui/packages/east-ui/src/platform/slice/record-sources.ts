/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Several records narrowed together: the product of one record Slice per
 * source. Each part is an ordinary `Slice.bindRecord`, under its own store
 * key; no index relates two records, so no choice in one part reaches another.
 * The product adds Clear all and presets over several sources, both East
 * functions over its parts, and keeps no state of its own.
 */
import {
    ArrayType, East, Expr, NullType, OptionType, StringType, StructType, isValueOf, none, some,
    type EastType, type ExprType, type SubtypeExprOrValue, type TypeOf, type VariantType,
} from "@elaraai/east";
import type { IndexedSource } from "../../contracts/indexed-source.js";
import { refuseNonSolid, type IconName, type SolidIconPrefix } from "../../display/icon/types.js";
import { bindRecord, type RecordSliceOptions, type RecordSliceWhere } from "./record.js";
import { RecordSliceBindType, RecordSlicePartType, RecordSlicesHandleType } from "./record-types.js";

/** An indexed binding's type parameters, recovered from its expression. */
type Parameters_<S> = S extends IndexedSource<infer K extends EastType, infer R extends StructType, infer P extends EastType, infer M extends StructType, infer IK extends VariantType>
    ? { K: K; R: R; P: P; M: M; IK: IK } : never;
type RowOf<S> = Parameters_<S> extends { R: infer R extends StructType } ? R : never;
type MetaOf<S> = Parameters_<S> extends { M: infer M extends StructType } ? M : never;

/**
 * One source of `Slice.bindRecords`: an indexed binding, how the rail names it,
 * and its controls, typed against its own row and indexes. Presets belong to
 * the product.
 * @typeParam S - The indexed binding's expression type.
 */
export type RecordSlicesPart<S> = {
    /** The indexed binding: `Data.bindPaged(record, { indexes })`. */
    source: S;
    /** How the rail names the source (`Bays`): the heading over its fields in the folded rail. With none, the host's noun for it. */
    label?: string;
    /** Its icon on the rail, a Font Awesome solid icon (`{ prefix: "fas", name: "warehouse" }`): on its heading and its fields' chips. With none, the rail's own. */
    icon?: { prefix: SolidIconPrefix; name: IconName };
} & Omit<RecordSliceOptions<RowOf<S>, MetaOf<S>>, "presets">;

/**
 * Each source's narrowing in a preset: a source it does not name is cleared.
 * @typeParam S - Each source's indexed binding expression type, by name.
 */
export type RecordSlicesWhere<S> = { [N in keyof S]?: RecordSliceWhere<RowOf<S[N]>, MetaOf<S[N]>> };

/**
 * Options of `Slice.bindRecords` beyond its sources.
 * @typeParam S - Each source's indexed binding expression type, by name.
 */
export interface RecordSlicesOptions<S> {
    /** Named narrowings over any sources, selected one at a time. */
    presets?: readonly { id: string; name: string; where: RecordSlicesWhere<S> }[];
}

/** The typed handle of one part, as `Slice.bindRecord` returns it. */
type PartHandle<S> = Parameters_<S> extends { K: infer K extends EastType; R: infer R extends StructType; P: infer P extends EastType; M: infer M extends StructType; IK: infer IK extends VariantType }
    ? TypeOf<ReturnType<typeof bindRecord<K, R, P, M, IK>>> : never;

/**
 * The typed handle `Slice.bindRecords` returns.
 * @typeParam S - Each source's indexed binding expression type, by name.
 */
export type RecordSlicesHandle<S> = ExprType<ReturnType<typeof RecordSlicesHandleType<{ [N in keyof S & string]: PartHandle<S[N]> }>>>;

/**
 * Narrow several records together from one set of controls: one record Slice
 * per source, under `${key}.${source}`, read with `Slice.rows(slice, source)`.
 * A choice in one source never changes another's rows or counts. A preset is
 * every source's narrowing at once; a source it does not name is cleared.
 *
 * @param key - Stable UI state key.
 * @param parts - Each source by name: an indexed binding (`Data.bindPaged(record, { indexes })`), how the rail names it (`label`, `icon`), and its fields, range, search and initial narrowing.
 * @param options - Presets over the sources.
 * @returns A serializable handle with each source's typed narrowed data.
 * @throws {Error} When there is no source, a preset repeats, a preset names a source the Slice lacks, a part declares its own presets, a label is empty or an icon is not a Font Awesome solid one; and as `Slice.bindRecord` refuses each part
 */
export function bindRecords<S extends Record<string, unknown>>(
    key: SubtypeExprOrValue<StringType>,
    parts: { [N in keyof S]: RecordSlicesPart<S[N]> },
    options: RecordSlicesOptions<NoInfer<S>> = {},
): RecordSlicesHandle<S> {
    const names = Object.keys(parts);
    if (names.length === 0) throw new Error("Slice.bindRecords needs at least one source: Slice.bindRecords(key, { name: { source, fields } })");
    const presets = options.presets ?? [];
    const ids = new Set<string>();
    for (const preset of presets) {
        if (ids.has(preset.id)) throw new Error(`Slice.bindRecords: repeated preset '${preset.id}'`);
        ids.add(preset.id);
        for (const source of Object.keys(preset.where)) {
            if (!names.includes(source)) throw new Error(`Slice.bindRecords: preset '${preset.id}' narrows '${source}', which is not one of its sources (${names.join(", ")})`);
        }
    }
    // How the rail names each source: its label and its icon, as the Icon definition holds one.
    const named = names.map(name => {
        const { label, icon } = parts[name] as RecordSlicesPart<unknown>;
        if (label !== undefined && label.trim() === "") throw new Error(`Slice.bindRecords: '${name}' has an empty label; give it a name or leave it out`);
        refuseNonSolid(`Slice.bindRecords: '${name}'`, icon);
        return {
            label: label === undefined ? none : some(label),
            icon: icon === undefined ? none : some({ prefix: icon.prefix, name: icon.name, label: none, style: none }),
        };
    });
    const handles = names.map(name => {
        const { source, label: _label, icon: _icon, ...controls } = parts[name] as RecordSlicesPart<IndexedSource<EastType, StructType, EastType, StructType, VariantType>> & { presets?: unknown };
        if (controls.presets !== undefined) throw new Error(`Slice.bindRecords: '${name}' declares presets; declare them once, in the options, over any sources`);
        const where = (preset: (typeof presets)[number]) => (preset.where as Record<string, unknown>)[name] ?? {};
        const partKey = isValueOf(key, StringType) ? `${key}.${name}` : East.value(key, StringType).concat(`.${name}`);
        return bindRecord(partKey, source, { ...controls,
            presets: presets.map(preset => ({ id: preset.id, name: preset.name, where: where(preset) as never })) } as never);
    });
    const sources = Object.fromEntries(names.map((name, i) => [name, Expr.type(handles[i]!)]));
    const type = RecordSlicesHandleType(sources);
    return East.function([], type, $ => {
        // Each part is bound once; the product's functions loop over their controls.
        const bound = handles.map(handle => $.const(handle));
        const controls = (handle: ExprType<StructType>) => Object.fromEntries(Object.keys(RecordSliceBindType.fields)
            .map(field => [field, (handle as unknown as Record<string, unknown>)[field]]));
        const all = $.const(names.map((name, i) => ({ source: name, ...named[i]!, slice: controls(bound[i] as never) })) as never, ArrayType(RecordSlicePartType));
        return {
            key, parts: all, presets: presets.map(preset => ({ id: preset.id, name: preset.name })),
            clearAll: East.function([], NullType, $2 => {
                $2.for(all, ($3, part) => { $3(part.slice.clearAll()); });
            }),
            togglePreset: East.function([StringType], NullType, ($2, id) => {
                const chosen = $2.const(some(id), OptionType(StringType));
                const everywhere = $2.let(true);
                $2.for(all, ($3, part) => {
                    $3.if(East.notEqual(part.slice.read().preset, chosen), $4 => { $4.assign(everywhere, false); });
                });
                $2.if(everywhere, $3 => {
                    $3.for(all, ($4, part) => { $4(part.slice.clearAll()); });
                }).else($3 => {
                    $3.for(all, ($4, part) => {
                        $4.if(East.notEqual(part.slice.read().preset, chosen), $5 => { $5(part.slice.togglePreset(id)); });
                    });
                });
            }),
            sources: Object.fromEntries(names.map((name, i) => [name, bound[i]])),
        } as never;
    })() as never;
}
