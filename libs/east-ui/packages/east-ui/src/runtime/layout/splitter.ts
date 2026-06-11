/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Splitter>` tag — see the export's JSDoc.
 */

import { Splitter as SplitterFactory, type SplitterOptions } from "../../layout/splitter/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** Panel builder + types surfaced on the `<Splitter>` tag (mirrors the `Splitter` factory namespace). */
type SplitterBuilders = {
    Panel: typeof SplitterFactory.Panel;
    Types: typeof SplitterFactory.Types;
};

/**
 * A resizable split layout — two or more panels divided by draggable handles.
 * Reach for it for editor/terminal, sidebar/main, or master/detail surfaces
 * where the user controls the proportions; for a fixed proportion that the
 * user cannot drag, use {@link Grid} or {@link Flex}. Panels are passed as
 * `panels` (each built with `Splitter.Panel(content, style?)` for `id`,
 * `minSize`, `maxSize`), with `orientation`, `defaultSize` percentages, and
 * `onResize`/`onResizeStart`/`onResizeEnd` callbacks as flat props
 * ({@link SplitterOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Splitter, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const workbench = East.function([], UIComponentType, _$ => (
 *     <Box height="200px">
 *         <Splitter
 *             panels={[
 *                 Splitter.Panel(<Box padding="4" background="gray.800" color="white"><Text>Code Editor</Text></Box>, { id: "editor", minSize: 30 }),
 *                 Splitter.Panel(<Box padding="4" background="gray.900" color="green.400"><Text>Terminal</Text></Box>, { id: "terminal", minSize: 10 }),
 *             ]}
 *             defaultSize={[70, 30]}
 *             orientation="vertical"
 *         />
 *     </Box>
 * ));
 * ```
 *
 * @remarks
 * Carries the `Splitter.Panel(content, style?)` panel builder
 * ({@link SplitterPanelStyle}) and `Splitter.Types` — the East data type, the
 * panel/style structs, and `Types.ResizeDetails` (the struct passed to the
 * resize callbacks). Desugars to `Splitter.Root(panels, options)`.
 */
export const Splitter: JsxTag<SplitterOptions> & SplitterBuilders =
    Object.assign(optionsTag(SplitterFactory.Root), {
        Panel: SplitterFactory.Panel,
        Types: SplitterFactory.Types,
    });
