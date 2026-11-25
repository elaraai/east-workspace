/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Each column's kind on the wire ({@link SheetColumnKindType}) — what pass 2
 * of the root (`root.ts`) builds for every column, each of a column from
 * data's columns and every band cell: its kind's settings as the wire holds
 * them, its rule cells by their keys, and the author's functions in their
 * wire twins (`wrap-bridge.ts`).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DateTimeType,
    DictType,
    East,
    IntegerType,
    OptionType,
    StringType,
    none,
    some,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue, isVariant,
} from "@elaraai/east";

import { TickFormatType, resolveTag, type NumberDomainInput, NumberDomainType, numberDomainOf } from "@elaraai/east-ui/internal";
import {
    SheetAuditModeType,
    SheetCheckType,
    SheetColumnKindType,
    SheetLookType,
    SheetMemberKindType,
    SheetMultipleType,
    SheetOptionsRuleType,
    SheetSideLockType,
    SheetSidesType,
    SheetSidesValueType,
    SheetStoreType,
    sheetRuleCell,
    type SheetAgeUnitLiteral,
    type SheetHalfLiteral,
    type SheetSidesLiteral,
} from "./types.js";
import { buildPatchCells, type SheetBridge } from "./bridge.js";
import type { SheetColumnMeta } from "./column-meta.js";
import { wrapArity, wrapCheck, wrapCustomParse, wrapCustomPrint, wrapOptions } from "./wrap-bridge.js";
import { buildActionKind } from "./actions.js";
import type { SheetMemberKindInput, SheetMultipleInput } from "./columns.js";
import type { SheetDriverValue, SheetRegisterValue } from "./registers.js";
import { isExistsCheck, type SheetLocksInput } from "./link.js";
import { Trace, Sparkline } from "@elaraai/east-ui";

/** The wire member-kind list of a `set` / `link` column. */
function memberKinds(input: SheetMemberKindInput[] | undefined): ExprType<ArrayType<SheetMemberKindType>> {
    return East.value((input ?? []).map((k) => ({
        kind:       k.kind,
        identified: k.identified ?? false,
        countable:  k.countable ?? false,
        resolvesTo: k.resolvesTo !== undefined ? some(k.resolvesTo) : none,
        ranged:     k.ranged ?? false,
    })), ArrayType(SheetMemberKindType));
}

/** The wire counted-member grammar, with the B§4.1 defaults. */
function multipleOpt(input: SheetMultipleInput | undefined): ExprType<OptionType<SheetMultipleType>> {
    if (input === undefined) return East.value(none, OptionType(SheetMultipleType));
    return East.value(some({
        forms:     input.forms ?? ["N x kind", "kind x N"],
        ops:       input.ops ?? ["x", "X", "*", "×"],
        appliesTo: input.appliesTo ?? "countable",
    }), OptionType(SheetMultipleType));
}

/** The wire lock rules of a link column's sides declaration. */
function lockRules(locks: SheetLocksInput | undefined): ExprType<ArrayType<SheetSideLockType>> {
    const rules: { half: unknown; when: unknown; label: string }[] = [];
    for (const [half, byWhen] of Object.entries(locks ?? {}) as [SheetHalfLiteral, Partial<Record<SheetSidesLiteral, string>>][]) {
        for (const [when, label] of Object.entries(byWhen ?? {}) as [SheetSidesLiteral, string][]) {
            rules.push({ half: variant(half, null), when: variant(when, null), label });
        }
    }
    return East.value(rules as unknown as SubtypeExprOrValue<ArrayType<SheetSideLockType>>, ArrayType(SheetSideLockType));
}

/** `some(x)` at an East type, or `none`. @internal */
export function optionOf<T extends EastType>(v: SubtypeExprOrValue<T> | undefined, type: T): ExprType<OptionType<T>> {
    return v !== undefined
        ? East.value(some(v), OptionType(type))
        : East.value(none, OptionType(type));
}

/** The wire key of a column's rule cell, when the column declares that rule (#844). @internal */
export function ruleCellKey(meta: SheetColumnMeta, rule: "level" | "actual" | "detail"): ExprType<OptionType<StringType>> {
    const key = sheetRuleCell(rule, meta.key);
    return optionOf((meta.ruleCells ?? []).some((c) => c.key === key) ? key : undefined, StringType);
}

/** What an action column's kind needs beside the column and the bridge (#1474). @internal */
export interface SheetActionKindContext {
    /** Every declared column. */
    metas: readonly SheetColumnMeta[];
    /** The registers, by name. */
    registers: Record<string, SheetRegisterValue>;
    /** A grouped sheet's band cells, described against the group. */
    groupCells?: SheetColumnMeta[] | undefined;
}

/**
 * A display column's one scale for every row, `[min, max]` (east-workspace#1728), as the wire holds it: `none` without one.
 *
 * @param key - The column, as a refusal names it
 * @param domain - The column's `domain`, each bound a Float or an expression of one
 * @returns The domain, or `none`
 * @throws {Error} When both bounds are written and draw no scale: one is no finite number, or the min is not below the max
 */
function domainOf(key: string, domain: NumberDomainInput | undefined): ExprType<OptionType<typeof NumberDomainType>> {
    return numberDomainOf(domain, `Sheet: column "${key}"`, "one scale for every row");
}

/**
 * Build one column's wire kind value — a column from data's for one of its
 * columns, `cellKey` that column's key, which the cells an audit's change
 * projects beside its own are keyed by.
 */
export function buildKind(meta: SheetColumnMeta, bridge: SheetBridge, driver: SheetDriverValue | undefined, actions?: SheetActionKindContext, cellKey?: ExprType<StringType>): ExprType<SheetColumnKindType> {
    const cfg = meta.config;
    const options = cfg.options !== undefined
        ? East.value(some(wrapOptions(bridge, meta, cfg.options)), OptionType(SheetOptionsRuleType))
        : East.value(none, OptionType(SheetOptionsRuleType));
    const kindOf = (tag: string, payload: unknown): ExprType<SheetColumnKindType> =>
        East.value(variant(tag, payload) as unknown as SubtypeExprOrValue<SheetColumnKindType>, SheetColumnKindType);
    switch (meta.kind) {
        case "text":    return kindOf("text", null);
        case "integer": return kindOf("integer", null);
        case "date":    return kindOf("date", {
            base:   optionOf(cfg.base as string | undefined, StringType),
            format: optionOf(cfg.format as SubtypeExprOrValue<StringType> | undefined, StringType),
            level:  ruleCellKey(meta, "level"),
            actual: ruleCellKey(meta, "actual"),
        });
        case "quantity": {
            let uom: ExprType<OptionType<DictType<StringType, StringType>>> = East.value(none, OptionType(DictType(StringType, StringType)));
            if (cfg.uom !== undefined) {
                if (driver === undefined) {
                    throw new Error(`Sheet: column "${meta.key}" reads \`uom\` off the driver's row, but the sheet declares no driver — pass \`driver={Sheet.driver(…)}\``);
                }
                const uomFn = East.function([driver.rowType], StringType, (_$, d) => cfg.uom!(d));
                const byDriver = driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => uomFn(d));
                uom = East.value(some(byDriver), OptionType(DictType(StringType, StringType)));
            }
            return kindOf("quantity", {
                uom,
                unit: optionOf(cfg.unit, StringType),
                format: cfg.format !== undefined
                    ? East.value(some(East.value(cfg.format as SubtypeExprOrValue<TickFormatType>, TickFormatType)), OptionType(TickFormatType))
                    : East.value(none, OptionType(TickFormatType)),
            });
        }
        case "lookup":    return kindOf("lookup", { register: meta.register, options });
        case "reference": return kindOf("reference", { register: meta.register });
        case "enum":      return kindOf("enum", { register: meta.register, options });
        case "set": return kindOf("set", {
            register: meta.register,
            members:  memberKinds(cfg.members),
            multiple: multipleOpt(cfg.multiple),
            store:    resolveTag(cfg.store ?? "asTyped", SheetStoreType),
        });
        case "link": {
            let sides: ExprType<OptionType<SheetSidesType>> = East.value(none, OptionType(SheetSidesType));
            if (cfg.sides !== undefined) {
                if (driver === undefined) {
                    throw new Error(`Sheet: column "${meta.key}" reads \`sides\` off the driver's row, but the sheet declares no driver — pass \`driver={Sheet.driver(…)}\``);
                }
                const sidesCfg = cfg.sides;
                const sidesFn = East.function([driver.rowType], SheetSidesValueType, (_$, d) => resolveTag(sidesCfg.value(d), SheetSidesValueType));
                const byDriver = driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => sidesFn(d));
                sides = East.value(some({ byDriver, locks: lockRules(sidesCfg.locks) }), OptionType(SheetSidesType));
            }
            return kindOf("link", {
                register: meta.register,
                members:  memberKinds(cfg.members),
                multiple: multipleOpt(cfg.multiple),
                sides,
                arity: cfg.arity !== undefined
                    ? some({ half: variant(cfg.arity.half, null), implied: wrapArity(bridge, meta, cfg.arity.implied) })
                    : none,
                check: East.value((cfg.check ?? []).map((c, i) =>
                    isExistsCheck(c)
                        ? East.value(variant("exists", null), SheetCheckType)
                        : wrapCheck(bridge, meta, c, i)), ArrayType(SheetCheckType)),
                store: resolveTag(cfg.store ?? "asTyped", SheetStoreType),
                options,
            });
        }
        case "stamped": return kindOf("stamped", { owner: optionOf(cfg.owner as SubtypeExprOrValue<StringType> | undefined, StringType) });
        case "action": {
            if (actions === undefined) throw new Error(`Sheet: "${meta.key}" is an action column — a band draws no action cell`);
            // A group patch lands as the band's cells, read-only ones too: the action writes them.
            const groupType = bridge.group?.groupType;
            const encodeGroup = groupType !== undefined && actions.groupCells !== undefined
                ? buildPatchCells(groupType, actions.groupCells, actions.registers, false)
                : undefined;
            return kindOf("action", buildActionKind({
                meta, bridge, metas: actions.metas, registers: actions.registers,
                groupCells: actions.groupCells, encodeGroup,
            }));
        }
        case "custom":  return kindOf("custom", {
            accepts: cfg.accepts,
            parse:   wrapCustomParse(bridge, meta, cfg.parse),
            print:   wrapCustomPrint(meta, cfg.print),
        });
        case "title":   return kindOf("title", { avatar: cfg.avatar === true });
        case "person":  return kindOf("person", { register: meta.register, unassigned: optionOf(cfg.unassigned, StringType) });
        case "boolean": return kindOf("boolean", null);
        case "toggle":  return kindOf("toggle", { on: cfg.on, off: cfg.off, look: resolveTag(cfg.look ?? "chip", SheetLookType) });
        case "cycle":   return kindOf("cycle", { register: meta.register, scale: cfg.scale === true, look: resolveTag(cfg.look ?? "chip", SheetLookType) });
        case "age": {
            const unit = (cfg as { unit?: SheetAgeUnitLiteral }).unit ?? "days";
            const span = unit === "weeks" ? 604_800_000n : 86_400_000n;
            // The renderer's to call: hours from the moment to the browser's clock; days and weeks the calendar's, from the
            // moment's date — read in UTC, as every East DateTime is — to the Record's day: the day its page sets, as it gives
            // it, else the viewer's own, which the renderer gives at UTC midnight, so the count turns over at their midnight, as
            // the columns read at the day do. A moment ahead counts 0.
            const elapsed = unit === "hours"
                ? East.function([DateTimeType, DateTimeType], IntegerType, ($, since, now) => {
                    const ms = $.const(since.durationMilliseconds(now));
                    return ms.less(0n).ifElse(() => 0n, () => ms.divide(3_600_000n));
                })
                : East.function([DateTimeType, DateTimeType], IntegerType, ($, since, day) => {
                    const ms = $.const(East.DateTime.roundDownDay(since, 1n).durationMilliseconds(day));
                    return ms.less(0n).ifElse(() => 0n, () => ms.divide(span));
                });
            return kindOf("age", {
                unit:   variant(unit, null),
                stale:  optionOf(cfg.stale, IntegerType),
                absent: optionOf(cfg.absent, StringType),
                elapsed,
            });
        }
        case "audit":   return kindOf("audit", {
            mode:   resolveTag(cfg.mode ?? "date", SheetAuditModeType),
            absent: optionOf(cfg.absent, StringType),
            by:     cellKey !== undefined ? East.str`$by:${cellKey}` : sheetRuleCell("by", meta.key),
            verb:   cellKey !== undefined ? East.str`$verb:${cellKey}` : sheetRuleCell("verb", meta.key),
        });
        case "trace": {
            // A trace's `scale` is read by its own name: a cycle's is whether it steps up the heat ramp.
            const scale = (cfg as unknown as { scale?: "brand" | "diverge" | "categorical" | SubtypeExprOrValue<typeof Trace.Types.Scale> }).scale ?? "brand";
            // Its word, or its case given as a value: an expression's is drawn as the brand's, a cell's one track the first.
            const named = typeof scale === "string" ? scale : isVariant(scale) ? scale.type : undefined;
            if (named === "categorical") {
                throw new Error(`Sheet: trace column "${meta.key}" is drawn \`categorical\`, which colours a Trace's tracks apart — a cell has one: give it "brand" or "diverge"`);
            }
            return kindOf("trace", {
                now:    optionOf(cfg.now, IntegerType),
                axis:   optionOf(cfg.axis, ArrayType(StringType)),
                scale:  resolveTag(scale, Trace.Types.Scale),
                future: resolveTag(cfg.future ?? "ghost", Trace.Types.Future),
                domain: domainOf(meta.key, cfg.domain),
                absent: optionOf(cfg.absent, StringType),
            });
        }
        case "sparkline": return kindOf("sparkline", {
            type:   resolveTag(cfg.type ?? "line", Sparkline.Types.ChartType),
            domain: domainOf(meta.key, cfg.domain),
            absent: optionOf(cfg.absent, StringType),
        });
        // The cells a row's max and its tone's name are read into, at the day (east-workspace#1730).
        case "meter": return kindOf("meter", {
            max:    sheetRuleCell("max", meta.key),
            tone:   optionOf(meta.meter?.tone !== undefined ? sheetRuleCell("tone", meta.key) : undefined, StringType),
            absent: optionOf(cfg.absent, StringType),
        });
    }
}
