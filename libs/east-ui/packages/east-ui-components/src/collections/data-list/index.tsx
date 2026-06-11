/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import {
    DataList as ChakraDataList,
    type DataListRootProps,
} from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { DataList } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const dataListRootEqual = equalFor(DataList.Types.Root);

/** East DataList Root value type. */
export type DataListRootValue = ValueTypeOf<typeof DataList.Types.Root>;

/** East DataList Item value type. */
export type DataListItemValue = ValueTypeOf<typeof DataList.Types.Item>;

/**
 * Converts an East UI DataList value into Chakra `DataListRootProps`.
 *
 * @remarks
 * Per the main/style type-shape convention, the main struct carries
 * only `items` (content). Every visual field lives in `value.style`.
 */
export function toChakraDataListRoot(value: DataListRootValue): DataListRootProps {
    const style = getSomeorUndefined(value.style);
    if (style === undefined) {
        return {};
    }
    return {
        orientation: getSomeorUndefined(style.orientation)?.type,
        size: getSomeorUndefined(style.size)?.type,
        variant: getSomeorUndefined(style.variant)?.type,
        background: getSomeorUndefined(style.background),
        borderColor: getSomeorUndefined(style.borderColor),
    };
}

export interface EastChakraDataListProps {
    value: DataListRootValue;
    storageKey: string;
}

/**
 * Renders an East UI DataList value using Chakra v3's `DataList`
 * compound.
 *
 * @remarks
 * `style.labelColor` and `style.valueColor` apply per-item (as a
 * `color` prop on `DataList.ItemLabel` / `DataList.ItemValue`). Every
 * other visual field is applied at the root.
 */
export const EastChakraDataList = memo(function EastChakraDataList({ value, storageKey }: EastChakraDataListProps) {
    const props = useMemo(() => toChakraDataListRoot(value), [value]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;
    const valueColor = style ? getSomeorUndefined(style.valueColor) : undefined;

    return (
        <ChakraDataList.Root {...props}>
            {value.items.map((item, index) => (
                <ChakraDataList.Item key={index}>
                    <ChakraDataList.ItemLabel color={labelColor}>{item.label}</ChakraDataList.ItemLabel>
                    <ChakraDataList.ItemValue color={valueColor}>
                        <EastChakraComponent value={item.value} storageKey={`${storageKey}.${index}`} />
                    </ChakraDataList.ItemValue>
                </ChakraDataList.Item>
            ))}
        </ChakraDataList.Root>
    );
}, (prev, next) => dataListRootEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
