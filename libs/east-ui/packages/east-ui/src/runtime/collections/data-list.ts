/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<DataList>` tag — see the export's JSDoc.
 */

import { DataList as DataListFactory } from "../../collections/data-list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Key/value detail list — a column of label → value pairs for entity detail
 * panels, summaries, and metadata blocks. Each item is a `{ label, value }`
 * record whose `value` is any UI component (plain text, a `<Badge>`, a
 * `<HoverCard>`, …), so the list doubles as a structured definition list. The
 * display props (`orientation`, `variant`, `size`, colour overrides) are flat
 * ({@link DataListStyle}). Reach for it instead of a `<Table>` when there is one
 * subject, not a collection of rows.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Badge, DataList, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const details = East.function([], UIComponentType, _$ => (
 *     <DataList items={[
 *         { label: "Status", value: <Badge variant="solid" colorPalette="green">Active</Badge> },
 *         { label: "User", value: <Text>jane.smith@company.com</Text> },
 *         { label: "Created", value: <Text>2024-01-15</Text> },
 *     ]} />
 * ));
 * ```
 *
 * @remarks
 * Carries `DataList.Types` for the item / style IR types. Desugars to
 * `DataList.Root(items, options)`.
 */
export const DataList: JsxTag<ValueProps<typeof DataListFactory.Root, "items">> & { Types: typeof DataListFactory.Types } =
    Object.assign(leaf(DataListFactory.Root, "items"), { Types: DataListFactory.Types });
