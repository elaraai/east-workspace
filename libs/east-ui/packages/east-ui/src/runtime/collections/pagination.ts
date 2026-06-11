/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Pagination>` tag — see the export's JSDoc.
 */

import { Pagination as PaginationFactory, type PaginationOptions } from "../../collections/pagination/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Page-navigation control — previous / next arrows and a windowed run of page
 * triggers driven by the `count` total and `pageSize`. The current `page` and
 * the `onPageChange` callback make it a controlled component: bind `page` to
 * state and write the next page back in the callback. The window shape
 * (`siblings`, `boundaries`) and the visual props (`variant`, `size`, active
 * colour overrides) are flat ({@link PaginationOptions}). Pair it with a sliced
 * `<Table>` or list, or let `<Table pagination={…} />` embed it.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Pagination, Reactive, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const pager = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const pageBind = $.let(State.bind([IntegerType], "page", 0n));
 *         const page = $.let(pageBind.read());
 *         const onPageChange = $.const(East.function([IntegerType], NullType, ($, next) => {
 *             $(pageBind.write(next));
 *         }));
 *         return <Pagination page={page} pageSize={20n} count={500n} onPageChange={onPageChange} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Pagination.Types` for the style IR types. Desugars to
 * `Pagination.Root(options)`.
 */
export const Pagination: JsxTag<PaginationOptions> & { Types: typeof PaginationFactory.Types } =
    Object.assign(optionsTag(PaginationFactory.Root), { Types: PaginationFactory.Types });
