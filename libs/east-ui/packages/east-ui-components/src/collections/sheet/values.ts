/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The decoded Sheet value types — one place the renderer names them, so
 * every module reads the same shapes off `Sheet.Types.*`.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import type { Sheet } from "@elaraai/east-ui/internal";

/** The decoded Sheet root. */
export type SheetRootValue = ValueTypeOf<typeof Sheet.Types.Root>;
/** One decoded wire row — `{ id, owned, cells }`. */
export type SheetRowValue = ValueTypeOf<typeof Sheet.Types.Row>;
/** One decoded cell — a `LiteralValue`-style variant, or a `Link`. */
export type SheetCellValue = ValueTypeOf<typeof Sheet.Types.Cell>;
/** The typed link value. */
export type SheetLinkValue = ValueTypeOf<typeof Sheet.Types.Link>;
/** One link member. */
export type SheetMemberValue = ValueTypeOf<typeof Sheet.Types.Member>;
/** One decoded column. */
export type SheetColumnValue = ValueTypeOf<typeof Sheet.Types.Column>;
/** The decoded column kind — the arms narrow on `type`. */
export type SheetColumnKindValue = SheetColumnValue["kind"];
/** A custom kind's payload — the compiled parse / print pair. */
export type SheetCustomKindValue = Extract<SheetColumnKindValue, { type: "custom" }>["value"];
/** A link column's applied sides declaration. */
export type SheetSidesDeclValue = ValueTypeOf<typeof Sheet.Types.SidesDeclaration>;
/** A link column's arity rule on the wire. */
export type SheetArityValue = ValueTypeOf<typeof Sheet.Types.Arity>;
/** One member check on the wire. */
export type SheetCheckValue = ValueTypeOf<typeof Sheet.Types.Check>;
/** The wire check context. */
export type SheetCheckContextValue = ValueTypeOf<typeof Sheet.Types.WireCheckContext>;
/** The wire fill — a proposed cell with its provenance. */
export type SheetFillValue = ValueTypeOf<typeof Sheet.Types.WireFill>;
/** The wire proposal — the cells a patch set, with its provenance. */
export type SheetProposalValue = ValueTypeOf<typeof Sheet.Types.WireProposal>;
/** One register member. */
export type SheetRegisterMemberValue = ValueTypeOf<typeof Sheet.Types.RegisterMember>;
/** The decoded driver. */
export type SheetDriverValue = ValueTypeOf<typeof Sheet.Types.Driver>;
/** The wire edit event. */
export type SheetEditValue = ValueTypeOf<typeof Sheet.Types.WireEdit>;
/** The selection value. */
export type SheetSelectionValue = ValueTypeOf<typeof Sheet.Types.Selection>;
/** The wire copilot context. */
export type SheetContextValue = ValueTypeOf<typeof Sheet.Types.WireContext>;
/** The copilot's row-proposal declaration. */
export type SheetSuggestValue = ValueTypeOf<typeof Sheet.Types.Suggest>;
/** One fill provider on the wire — `{ type: "sync" | "async", value }`. */
export type SheetProviderValue = ValueTypeOf<typeof Sheet.Types.Provider>;
/** One row proposer on the wire. */
export type SheetProposerValue = ValueTypeOf<typeof Sheet.Types.Proposer>;
/** The decoded `paged` arm — the source at the sheet's own row collection. */
export type SheetPagedSourceValue = Extract<SheetRootValue["rows"], { type: "paged" }>["value"];
/** One saved view — a slice-state snapshot plus the lens's context and reveals (B§8). */
export type SheetViewValue = ValueTypeOf<typeof Sheet.Types.View>;
