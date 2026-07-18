/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Canonical Elara Chakra v3 system.
 *
 * Consumers (east-ui-showcase, east-ui-patterns-showcase, future apps) wrap
 * their root in `<ChakraProvider value={system}>` and inherit:
 *  - tokens (raw colour scales + fonts + spacing + radii + shadows)
 *  - semantic tokens (`bg.canvas`/`bg.surface`/`fg`/`fg.muted`/`border.subtle`/`ink.success`/...)
 *  - text styles (`display.{xl,lg,md,sm,xs}`, `body.{lg,md,sm}`, `eyebrow`, `caption`, `mono.*`)
 *  - layer styles (`card`, `card.flat`, `card.elevated`, `surface.muted`, `pill`)
 *  - button + input recipe overrides (visual: solid|ink|outline|ghost · size: sm|md|lg)
 *  - global CSS (font @import, focus-visible ring, prefers-reduced-motion)
 *
 * @example
 * ```tsx
 * import { ChakraProvider } from "@chakra-ui/react";
 * import { system } from "@elaraai/east-ui-components";
 *
 * <ChakraProvider value={system}>
 *     <App />
 * </ChakraProvider>
 * ```
 *
 * @packageDocumentation
 */

import { createSystem, defaultConfig, defineConfig, defineRecipe } from "@chakra-ui/react";

import { tokens } from "./tokens.js";
import { semanticTokens } from "./semantic-tokens.js";
import { textStyles } from "./text-styles.js";
import { layerStyles } from "./layer-styles.js";
import { globalCss } from "./global-css.js";
import { keyframes } from "./keyframes.js";
import { buttonRecipe } from "./recipes/button.js";
import { dropHintRecipe } from "./recipes/dropHint.js";
import { inputRecipe } from "./recipes/input.js";
import { badgeRecipe } from "./recipes/badge.js";
import { kbdRecipe } from "./recipes/kbd.js";
import { codeRecipe } from "./recipes/code.js";
import { linkRecipe } from "./recipes/link.js";
import { markRecipe } from "./recipes/mark.js";
import { headingRecipe } from "./recipes/heading.js";
import { noteRecipe } from "./recipes/note.js";
import { iconButtonRecipe } from "./recipes/icon-button.js";
import { separatorRecipe } from "./recipes/separator.js";
import { skeletonRecipe } from "./recipes/skeleton.js";
import { chipRecipe } from "./recipes/chip.js";

import { tagSlotRecipe } from "./slot-recipes/tag.js";
import { tabsSlotRecipe } from "./slot-recipes/tabs.js";
import { dialogSlotRecipe } from "./slot-recipes/dialog.js";
import { popoverSlotRecipe } from "./slot-recipes/popover.js";
import { tooltipSlotRecipe } from "./slot-recipes/tooltip.js";
import { menuSlotRecipe } from "./slot-recipes/menu.js";
import { librarySlotRecipe } from "./slot-recipes/library.js";
import { deckSlotRecipe } from "./slot-recipes/deck.js";
import { valueTreeSlotRecipe } from "./slot-recipes/valueTree.js";
import { rosterSlotRecipe } from "./slot-recipes/roster.js";
import { boardSlotRecipe } from "./slot-recipes/board.js";
import { calendarSlotRecipe } from "./slot-recipes/calendar.js";
import { schematicSlotRecipe } from "./slot-recipes/schematic.js";
import { mapSlotRecipe } from "./slot-recipes/map.js";
import { blendSlotRecipe } from "./slot-recipes/blend.js";
import { emptyStateSlotRecipe } from "./slot-recipes/emptyState.js";
import { statSlotRecipe } from "./slot-recipes/stat.js";
import { avatarSlotRecipe } from "./slot-recipes/avatar.js";
import { checkboxSlotRecipe } from "./slot-recipes/checkbox.js";
import { switchSlotRecipe } from "./slot-recipes/switch.js";
import { radioGroupSlotRecipe } from "./slot-recipes/radioGroup.js";
import { accordionSlotRecipe } from "./slot-recipes/accordion.js";
import { selectSlotRecipe } from "./slot-recipes/select.js";
import { iconButtonSlotRecipe } from "./slot-recipes/iconButton.js";
import { sliderSlotRecipe } from "./slot-recipes/slider.js";
import { segmentGroupSlotRecipe } from "./slot-recipes/segmentGroup.js";
import { navListSlotRecipe } from "./slot-recipes/navList.js";
import { drawerSlotRecipe } from "./slot-recipes/drawer.js";
import { hoverCardSlotRecipe } from "./slot-recipes/hoverCard.js";
import { progressSlotRecipe } from "./slot-recipes/progress.js";
import { toastSlotRecipe } from "./slot-recipes/toast.js";
import { breadcrumbSlotRecipe } from "./slot-recipes/breadcrumb.js";
import { fieldSlotRecipe } from "./slot-recipes/field.js";
import { comboboxSlotRecipe } from "./slot-recipes/combobox.js";
import { tagsInputSlotRecipe } from "./slot-recipes/tagsInput.js";
import { numberInputSlotRecipe } from "./slot-recipes/numberInput.js";
import { fileUploadSlotRecipe } from "./slot-recipes/fileUpload.js";
import { paginationSlotRecipe } from "./slot-recipes/pagination.js";
import { dataListSlotRecipe } from "./slot-recipes/dataList.js";
import { treeViewSlotRecipe } from "./slot-recipes/treeView.js";
import { tableSlotRecipe } from "./slot-recipes/table.js";
import { carouselSlotRecipe } from "./slot-recipes/carousel.js";
import { collapsibleSlotRecipe } from "./slot-recipes/collapsible.js";
import { expandableSlotRecipe } from "./slot-recipes/expandable.js";
import { dockSlotRecipe } from "./slot-recipes/dock.js";
import { drawerStackRailSlotRecipe } from "./slot-recipes/drawerStack.js";
import { optionListSlotRecipe } from "./slot-recipes/optionList.js";
import { codeBlockSlotRecipe } from "./slot-recipes/codeBlock.js";
import { commandPaletteSlotRecipe } from "./slot-recipes/commandPalette.js";
import { actionBarSlotRecipe } from "./slot-recipes/actionBar.js";
import { segmentedMeterSlotRecipe } from "./slot-recipes/segmentedMeter.js";
import { barStripSlotRecipe } from "./slot-recipes/barStrip.js";
import { meterSlotRecipe } from "./slot-recipes/meter.js";
import { metricChipSlotRecipe } from "./slot-recipes/metricChip.js";
import { chipRailSlotRecipe } from "./slot-recipes/chipRail.js";
import { traceSlotRecipe } from "./slot-recipes/trace.js";
import { sliceFrameSlotRecipe } from "./slot-recipes/sliceFrame.js";
import { sliceEditSlotRecipe } from "./slot-recipes/sliceEdit.js";
import { clauseBuilderSlotRecipe } from "./slot-recipes/clauseBuilder.js";
import { facetTabsSlotRecipe } from "./slot-recipes/facetTabs.js";
import { editableChipSlotRecipe } from "./slot-recipes/editableChip.js";
import { ganttSlotRecipe } from "./slot-recipes/gantt.js";
import { plannerSlotRecipe } from "./slot-recipes/planner.js";
import { splitterSlotRecipe } from "./slot-recipes/splitter.js";
import { matrixSlotRecipe } from "./slot-recipes/matrix.js";
import { showMoreSlotRecipe } from "./slot-recipes/showMore.js";
import { statusSlotRecipe } from "./slot-recipes/status.js";
import { eyebrowRowSlotRecipe } from "./slot-recipes/eyebrowRow.js";
import { commitBarSlotRecipe } from "./slot-recipes/commitBar.js";
import { reviewChromeSlotRecipe } from "./slot-recipes/reviewChrome.js";
import { decisionQueueSlotRecipe } from "./slot-recipes/decisionQueue.js";

const config = defineConfig({
    globalCss,
    /* Adaptive conditions (#346) — pointer capability as first-class recipe
     * conditions. `_coarse` gates the touch hit-area inflation
     * (`style/hit-area.ts`) and touch-size bumps; `_hoverNone` gates
     * hover-parity fallbacks (always-visible affordances where desktop
     * reveals on hover). Mirrored in JS by `contracts/adaptive.ts`. */
    conditions: {
        coarse: "@media (pointer: coarse)",
        hoverNone: "@media (hover: none)",
    },
    theme: {
        tokens,
        semanticTokens,
        textStyles,
        layerStyles,
        keyframes,
        recipes: {
            button:     buttonRecipe,
            dropHint:   dropHintRecipe,
            input:      inputRecipe,
            badge:      badgeRecipe,
            kbd:        kbdRecipe,
            code:       codeRecipe,
            link:       linkRecipe,
            mark:       markRecipe,
            heading:    headingRecipe,
            note:       noteRecipe,
            iconButton: iconButtonRecipe,
            separator:  separatorRecipe,
            skeleton:   skeletonRecipe,
            chip:       chipRecipe,
            /* Touch floor (#348) merged onto Chakra's default textarea
             * recipe — sub-16px focused fields make iOS Safari zoom. */
            textarea:   defineRecipe({
                base: { _coarse: { fontSize: "{fontSizes.md}", minHeight: "44px" } },
            }),
        },
        slotRecipes: {
            tag:             tagSlotRecipe,
            tabs:            tabsSlotRecipe,
            dialog:          dialogSlotRecipe,
            popover:         popoverSlotRecipe,
            tooltip:         tooltipSlotRecipe,
            menu:            menuSlotRecipe,
            library:         librarySlotRecipe,
            deck:            deckSlotRecipe,
            valueTree:       valueTreeSlotRecipe,
            roster:          rosterSlotRecipe,
            board:           boardSlotRecipe,
            calendar:        calendarSlotRecipe,
            schematic:       schematicSlotRecipe,
            map:             mapSlotRecipe,
            blend:           blendSlotRecipe,
            emptyState:      emptyStateSlotRecipe,
            stat:            statSlotRecipe,
            avatar:          avatarSlotRecipe,
            checkbox:        checkboxSlotRecipe,
            switch:          switchSlotRecipe,
            radioGroup:      radioGroupSlotRecipe,
            accordion:       accordionSlotRecipe,
            select:          selectSlotRecipe,
            iconButton:      iconButtonSlotRecipe,
            slider:          sliderSlotRecipe,
            segmentGroup:    segmentGroupSlotRecipe,
            navList:         navListSlotRecipe,
            drawer:          drawerSlotRecipe,
            hoverCard:       hoverCardSlotRecipe,
            progress:        progressSlotRecipe,
            toast:           toastSlotRecipe,
            breadcrumb:      breadcrumbSlotRecipe,
            field:           fieldSlotRecipe,
            combobox:        comboboxSlotRecipe,
            tagsInput:       tagsInputSlotRecipe,
            numberInput:     numberInputSlotRecipe,
            fileUpload:      fileUploadSlotRecipe,
            pagination:      paginationSlotRecipe,
            dataList:        dataListSlotRecipe,
            treeView:        treeViewSlotRecipe,
            table:           tableSlotRecipe,
            carousel:        carouselSlotRecipe,
            collapsible:     collapsibleSlotRecipe,
            expandable:      expandableSlotRecipe,
            dock:            dockSlotRecipe,
            drawerStackRail: drawerStackRailSlotRecipe,
            optionList:      optionListSlotRecipe,
            codeBlock:       codeBlockSlotRecipe,
            commandPalette:  commandPaletteSlotRecipe,
            actionBar:       actionBarSlotRecipe,
            segmentedMeter: segmentedMeterSlotRecipe,
            barStrip:        barStripSlotRecipe,
            meter:           meterSlotRecipe,
            metricChip:      metricChipSlotRecipe,
            chipRail:        chipRailSlotRecipe,
            trace:           traceSlotRecipe,
            sliceFrame:      sliceFrameSlotRecipe,
            sliceEdit:       sliceEditSlotRecipe,
            clauseBuilder:   clauseBuilderSlotRecipe,
            facetTabs:       facetTabsSlotRecipe,
            editableChip:    editableChipSlotRecipe,
            gantt:           ganttSlotRecipe,
            splitter:        splitterSlotRecipe,
            planner:         plannerSlotRecipe,
            matrix:          matrixSlotRecipe,
            showMore:        showMoreSlotRecipe,
            status:          statusSlotRecipe,
            eyebrowRow:      eyebrowRowSlotRecipe,
            commitBar:       commitBarSlotRecipe,
            reviewChrome:    reviewChromeSlotRecipe,
            decisionQueue:   decisionQueueSlotRecipe,
        },
    },
});

/**
 * The canonical Elara Chakra v3 system. Wrap your root in
 * `<ChakraProvider value={system}>` to consume.
 */
export const system = createSystem(defaultConfig, config);

/* Re-export the building blocks so apps can compose / extend them. */
export { tokens } from "./tokens.js";
export { semanticTokens } from "./semantic-tokens.js";
export { textStyles } from "./text-styles.js";
export { layerStyles } from "./layer-styles.js";
export { globalCss } from "./global-css.js";
export { buttonRecipe }  from "./recipes/button.js";
export { inputRecipe }   from "./recipes/input.js";
export { badgeRecipe }   from "./recipes/badge.js";
export { kbdRecipe }     from "./recipes/kbd.js";
export { codeRecipe }    from "./recipes/code.js";
export { linkRecipe }    from "./recipes/link.js";
export { markRecipe }    from "./recipes/mark.js";
export { headingRecipe } from "./recipes/heading.js";
export { noteRecipe }    from "./recipes/note.js";
