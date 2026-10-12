/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box, useSlotRecipe } from "@chakra-ui/react";
import { RecordSliceRailComponent } from "@elaraai/east-ui/internal";
import { implementUIComponent, type ExtensionRendererProps } from "../../extension/registry.js";
import { Toolbar } from "../../toolbar/index.js";
import { useRecordSliceToolbarItems } from "./index.js";
import { RecordSliceBrush } from "./brush.js";

/** Standalone record narrowing, using the same toolbar items as every builder. */
export function EastChakraRecordSliceRail({ value }: ExtensionRendererProps<typeof RecordSliceRailComponent.schema>) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const items = useRecordSliceToolbarItems(value.slice, {
        affordances: value.affordances.map(item => item.type),
        ...(value.persist.type === "some" ? { persist: value.persist.value.type } : {}),
    });
    return <Box css={styles.railStack}>
        <Box css={styles.railRow}><Toolbar items={items} /></Box>
        {value.affordances.some(item => item.type === "brush") && <RecordSliceBrush slice={value.slice} />}
    </Box>;
}
implementUIComponent(RecordSliceRailComponent, EastChakraRecordSliceRail);
