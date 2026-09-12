/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.link` — the link value's helpers: the grammar's parse / print pair
 * as exported East functions (B§4.1, `Sheet Spec.md` §3.4), and the
 * `arity` / `check` declarations a link column takes.
 *
 * The grammar here is the SYNTACTIC half the renderer and a task share —
 * splitting halves on `>`, members on `,`, the counted form, ranges, the
 * placeholder — resolved against a register's members so a code is
 * `identified` and anything else is kept as `text`. Candidate scoring,
 * prefix completion and the countable-by-attribute forms are the renderer's
 * (`link/grammar.ts`, P3): they need the editor, not a value.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    SetType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    SheetMemberType,
    SheetLinkType,
    SheetRegisterMemberType,
    SheetCountedType,
    type SheetHalfLiteral,
    type SheetAnyContextOf,
    type SheetAnyCheckContextOf,
} from "./types.js";

/** A list of link members. */
export const SheetMembersType = ArrayType(SheetMemberType);
/** A list of register members — what `parse` resolves against. */
export const SheetRegisterMembersType = ArrayType(SheetRegisterMemberType);

// ============================================================================
// Print — the grammar's display form
// ============================================================================

/**
 * Print one member in the grammar's display form.
 *
 * @remarks
 * A module-scope East function (the `LAST_WINS` precedent): built once,
 * called by `print` and by the factory's `String`-field projection.
 */
export const printMember = East.function([SheetMemberType], StringType, (_$, m) =>
    m.match({
        identified:  (_$2, v) => v.key,
        range:       (_$2, v) => East.str`${v.from}-${v.to}`,
        counted:     (_$2, v) => East.str`${v.n} x ${v.key}`,
        placeholder: (_$2) => East.value("TBC", StringType),
        text:        (_$2, t) => t,
    }));

/**
 * `Sheet.link.print` — a link value as the planner would type it (B§4.2):
 * `a > b`, `b` for a destination-only link, `a >` for a source-only one.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Sheet } from "@elaraai/east-ui/internal";
 *
 * const example = East.function([], StringType, ($) => {
 *     const link = $.const({ from: [variant("identified", { key: "M2140" })], to: [variant("counted", { n: 4n, key: "CNC lathe" })] }, Sheet.Types.Link);
 *     return Sheet.link.print(link);   // "M2140 > 4 x CNC lathe"
 * });
 * ```
 */
export const printLink = East.function([SheetLinkType], StringType, ($, link) => {
    const pm = $.const(printMember);
    const from = $.let(link.from.map((_$, m) => pm(m)).stringJoin(", "), StringType);
    const to   = $.let(link.to.map((_$, m) => pm(m)).stringJoin(", "), StringType);
    return link.from.length().equal(0n).ifElse(
        (_$) => to,
        (_$) => link.to.length().equal(0n).ifElse(
            (_$2) => East.str`${from} >`,
            (_$2) => East.str`${from} > ${to}`,
        ),
    );
});

/**
 * Print one member with the register's LABELS — the `store: "canonical"`
 * form (B§4.2): an identified member prints its member's label when the
 * register has it, its key otherwise; every other member prints as
 * {@link printMember}.
 */
export const printMemberWith = East.function([SheetMemberType, SheetRegisterMembersType], StringType, ($, m, members) => {
    const pm = $.const(printMember);
    return m.match({
        identified: (_$2, v) => members.firstMap((_$3, r) => r.key.equal(v.key).ifElse(
            (_$4) => East.value(some(r.label), OptionType(StringType)),
            (_$4) => East.value(none, OptionType(StringType)),
        )).match({
            some: (_$3, label) => label,
            none: (_$3) => v.key,
        }),
    }, (_$2) => pm(m));
});

/**
 * `Sheet.link.print` with the register's labels — what a `String` field
 * stores under `store: "canonical"` (B§4.2).
 */
export const printLinkWith = East.function([SheetLinkType, SheetRegisterMembersType], StringType, ($, link, members) => {
    const pm = $.const(printMemberWith);
    const from = $.let(link.from.map((_$, m) => pm(m, members)).stringJoin(", "), StringType);
    const to   = $.let(link.to.map((_$, m) => pm(m, members)).stringJoin(", "), StringType);
    return link.from.length().equal(0n).ifElse(
        (_$) => to,
        (_$) => link.to.length().equal(0n).ifElse(
            (_$2) => East.str`${from} >`,
            (_$2) => East.str`${from} > ${to}`,
        ),
    );
});

// ============================================================================
// Parse — text to a link value, against a register
// ============================================================================

/** The key of the register member a token names (by key or alias, case-insensitive). */
const resolveKey = East.function([StringType, SheetRegisterMembersType], OptionType(StringType), ($, token, members) => {
    const t = $.let(token.trim().lowerCase(), StringType);
    return members.firstMap((_$, m) =>
        m.key.lowerCase().equal(t)
            .or(() => m.aliases.map((_$2, a) => a.lowerCase()).toSet().has(t))
            .ifElse(
                (_$2) => East.value(some(m.key), OptionType(StringType)),
                (_$2) => East.value(none, OptionType(StringType)),
            ));
});

/** The counted form `N x key` / `key x N` (B§4.1) — `none` when the token is not one. */
const parseCounted = East.function([StringType, SheetRegisterMembersType], OptionType(SheetCountedType), ($, token, members) => {
    // `×` folds into the ASCII operator so one regex covers every declared op.
    const tok = $.let(token.replace("×", " x "), StringType);
    const noCount = $.const(none, OptionType(SheetCountedType));
    const resolve = $.const(resolveKey);
    const keyOf = $.const(East.function([StringType], StringType, ($2, rest) =>
        resolve(rest, members).match({
            some: (_$3, k) => k,
            none: (_$3) => rest.trim(),
        })));
    return tok.contains(new RegExp("^\\d+\\s*[xX*]\\s*\\S")).ifElse(
        ($2) => {
            // Leading count: `4 x lathe`.
            const at = $2.let(tok.indexOf(new RegExp("[xX*]")), IntegerType);
            const digits = $2.let(tok.substring(0n, at).trim(), StringType);
            const n = $2.let(digits.parse(IntegerType), IntegerType);
            const rest = $2.let(tok.substring(at.add(1n), tok.length()).trim(), StringType);
            return East.value(some({ n, key: keyOf(rest) }), OptionType(SheetCountedType));
        },
        (_$2) => tok.contains(new RegExp("\\S\\s+[xX*]\\s*\\d+$")).ifElse(
            ($3) => {
                // Trailing count: `lathe x 4`.
                const at = $3.let(tok.indexOf(new RegExp("\\s+[xX*]\\s*\\d+$")), IntegerType);
                const rest = $3.let(tok.substring(0n, at).trim(), StringType);
                const tail = $3.let(tok.substring(at, tok.length()), StringType);
                const digits = $3.let(tail.substring(tail.indexOf(new RegExp("\\d")), tail.length()).trim(), StringType);
                const n = $3.let(digits.parse(IntegerType), IntegerType);
                return East.value(some({ n, key: keyOf(rest) }), OptionType(SheetCountedType));
            },
            (_$3) => noCount,
        ),
    );
});

/**
 * One token to a member (B§4.1): the placeholder, a register code, the
 * counted form, a range, else text — never blocked.
 */
const parseMember = East.function([StringType, SheetRegisterMembersType], SheetMemberType, ($, raw, members) => {
    const tok = $.let(raw.trim(), StringType);
    const resolve = $.const(resolveKey);
    const counted = $.const(parseCounted);
    return tok.upperCase().equal("TBC").ifElse(
        (_$) => East.value(variant("placeholder", null), SheetMemberType),
        (_$2) => resolve(tok, members).match({
            some: (_$3, key) => East.value(variant("identified", { key }), SheetMemberType),
            none: (_$3) => counted(tok, members).match({
                some: (_$4, c) => East.value(variant("counted", { n: c.n, key: c.key }), SheetMemberType),
                none: (_$4) => tok.contains(new RegExp("^[A-Za-z]*\\d+-\\d+$")).ifElse(
                    ($5) => {
                        // A range; a short upper bound completes from the lower (`M2140-45` ⇒ `M2145`).
                        const parts = $5.let(tok.split("-"), ArrayType(StringType));
                        const from = $5.let(parts.get(0n), StringType);
                        const upper = $5.let(parts.get(1n), StringType);
                        const to = $5.let(upper.length().less(from.length()).ifElse(
                            (_$6) => from.substring(0n, from.length().subtract(upper.length())).concat(upper),
                            (_$6) => upper,
                        ), StringType);
                        return East.value(variant("range", { from, to }), SheetMemberType);
                    },
                    (_$5) => East.value(variant("text", tok), SheetMemberType),
                ),
            }),
        }),
    );
});

/** The members of one half — comma-separated tokens, blanks dropped. */
const parseHalf = East.function([StringType, SheetRegisterMembersType], SheetMembersType, ($, text, members) => {
    const member = $.const(parseMember);
    return text.split(",").filterMap((_$2, tok) =>
        tok.trim().length().equal(0n).ifElse(
            (_$3) => East.value(none, OptionType(SheetMemberType)),
            (_$3) => East.value(some(member(tok, members)), OptionType(SheetMemberType)),
        ));
});

/**
 * `Sheet.link.parse` — the planner's text to a typed link, resolved against
 * a register's members (B§4.1 / B§4.2): `a > b` fills both halves, `b`
 * alone is a destination-only link, `a >` a source-only one.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Sheet } from "@elaraai/east-ui/internal";
 *
 * const example = East.function([], Sheet.Types.Link, ($) => {
 *     const members = $.const([{ key: "M2140", label: "M2140", kind: "machine", aliases: [], meta: none, parent: none, tone: none }], Sheet.Types.RegisterMembers);
 *     return Sheet.link.parse("M2140 > 4 x lathe, TBC", members);
 * });
 * ```
 */
export const parseLink = East.function([StringType, SheetRegisterMembersType], SheetLinkType, ($, text, members) => {
    const emptyMembers = $.const([], SheetMembersType);
    const half = $.const(parseHalf);
    return text.contains(">").ifElse(
        ($2) => {
            const at = $2.let(text.indexOf(">"), IntegerType);
            const from = $2.let(half(text.substring(0n, at), members), SheetMembersType);
            const to = $2.let(half(text.substring(at.add(1n), text.length()), members), SheetMembersType);
            return $2.let({ from, to }, SheetLinkType);
        },
        ($2) => {
            const to = $2.let(half(text, members), SheetMembersType);
            return $2.let({ from: emptyMembers, to }, SheetLinkType);
        },
    );
});

/** The register keys a link's identified and counted members name — the `exists` check's vocabulary. */
export const linkKeys = East.function([SheetLinkType], SetType(StringType), (_$, link) =>
    link.from.concat(link.to).filterMap((_$2, m) => m.match({
        identified: (_$3, v) => East.value(some(v.key), OptionType(StringType)),
        counted:    (_$3, v) => East.value(some(v.key), OptionType(StringType)),
        range:      (_$3, v) => East.value(some(v.from), OptionType(StringType)),
    }, (_$3) => East.value(none, OptionType(StringType)))).toSet());

// ============================================================================
// Arity and checks — the declarations a link column takes
// ============================================================================

/**
 * A link column's arity declaration — `Sheet.link.arity(half, implied)`:
 * an author rule over the typed context saying how many members the half
 * should hold and which countable member to propose (B§4.6).
 *
 * @typeParam R - The host's row type
 * @typeParam D - The driver's row type
 * @property half - The half the rule counts (`"from"` / `"to"`)
 * @property implied - `(ctx) => Option<Counted>` — an `East.function` over `Sheet.Types.Context(R, D)`
 */
export interface SheetArityInput<R extends StructType = StructType, D extends EastType = EastType> {
    /** The half the rule counts. */
    readonly half: SheetHalfLiteral;
    /** The rule — how many, and which countable member, given the row as it would be. */
    readonly implied: SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R, D>], OptionType<SheetCountedType>>>;
}

/**
 * Declares a link column's arity rule.
 *
 * @typeParam R - The host's row type (inferred from `implied`)
 * @typeParam D - The driver's row type (inferred from `implied`)
 * @param half - The half the rule counts
 * @param implied - The rule — an `East.function` over `Sheet.Types.Context(R, D)` returning `Option<Sheet.Types.Counted>`
 * @returns The declaration a `Sheet.column.link` config takes as `arity`
 */
export function createArity<R extends StructType, D extends EastType>(
    half: SheetHalfLiteral,
    implied: SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R, D>], OptionType<SheetCountedType>>>,
): SheetArityInput<R, D> {
    return { half, implied };
}

/** The grammar's own check — the member must resolve in the register. */
export interface SheetExistsCheck {
    /** Discriminant. */
    readonly exists: true;
}

/**
 * One member check on a link column: the grammar's `exists`, or an author
 * rule over `Sheet.Types.CheckContext(R)` returning `some(message)` to flag
 * the member (B§2 `check`). Flags are shown, never enforced.
 *
 * @typeParam R - The host's row type
 */
export type SheetCheckInput<R extends StructType = StructType> =
    | SheetExistsCheck
    | SubtypeExprOrValue<FunctionType<[SheetAnyCheckContextOf<R>], OptionType<StringType>>>;

/** `Sheet.link.check` — the built-in checks. */
export const check = {
    /**
     * The grammar's own check: an identified, counted or range member must
     * name a register key; a placeholder or text passes.
     *
     * @returns The `exists` check
     */
    exists: (): SheetExistsCheck => ({ exists: true }),
} as const;

/** Whether a check input is the `exists` marker. */
export function isExistsCheck(c: unknown): c is SheetExistsCheck {
    return typeof c === "object" && c !== null && (c as { exists?: unknown }).exists === true;
}

/** The lock-table input of a link column's `sides` — half → sides value → tag text. */
export type SheetLocksInput = Partial<Record<SheetHalfLiteral, Partial<Record<"both" | "from" | "to" | "in", string>>>>;

/** A `none` of the given type, as an expression — the shared fallback spelling. */
export function noneOf<T extends EastType>(type: T): ExprType<OptionType<T>> {
    return East.value(none, OptionType(type));
}

/** The empty link value. */
export const EMPTY_LINK = East.value({ from: [], to: [] }, SheetLinkType);

/** Re-exported so the builders type their `NullType` driver default without a second import. */
export { NullType };
