/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library's Layers tab (#1389, `Schematic Builder Spec.md` §8, SC27): each
 * layer `Schematic.layers` reads from the app's record, in its order — its
 * swatch, in its colour token, else its tone; its name; how many entities it
 * holds — with Isolate, Lock and Show or Hide, each a toggle that says
 * whether it is on, and Show all under the rows while a layer is hidden. The
 * viewer's choices are view settings (`layers-view.ts`), kept under the
 * Schematic's `id`: a hidden layer's entities never draw, and a locked one's
 * never select.
 *
 * Each row is the design system's pick-panel row — 44 at least, a hairline
 * between — and a hidden layer's reads in the faint ink, never by opacity.
 * Every icon is Font Awesome's solid set, and every style the `schematic`
 * recipe's.
 *
 * @packageDocumentation
 */

import { Box, Button, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBullseye, faEye, faEyeSlash, faLock, faLockOpen } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { LibraryEmptyState } from "@elaraai/east-ui-components/internal";
import type { SchematicLayerValue } from "./canvas/layers.js";
import { layerTint, tintAttributes } from "./canvas/tints.js";
import {
    anyHidden, layerLocked, layerShown, showAll, toggleIsolated, toggleLocked, toggleShown, type SchematicLayerView,
} from "./layers-view.js";
import type { SchematicWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);

/** Props of {@link SchematicLayersTab}. */
export interface SchematicLayersTabProps {
    /** The layers, in their order, with their author defaults. */
    readonly layers: readonly SchematicLayerValue[];
    /** The viewer's choices. */
    readonly view: SchematicLayerView;
    /** Writes the viewer's choices. */
    readonly onView: (next: SchematicLayerView) => void;
    /** How many entities each layer holds, by its key. */
    readonly counts: ReadonlyMap<string, number>;
    /** The Schematic's words. */
    readonly words: SchematicWords;
}

/**
 * The Layers tab's body — see the module docs.
 *
 * @param props - The layers, the viewer's choices and their write, each layer's count, and the words
 * @returns The tab's body: its rows, and Show all while a layer is hidden
 */
export function SchematicLayersTab({ layers, view, onView, counts, words }: SchematicLayersTabProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as Styles;
    const m = words.m;
    if (layers.length === 0) {
        return <LibraryEmptyState said={{ title: m.libraryEmpty({ tab: "layers", name: "" }), description: m.libraryEmptyHint({ tab: "layers", name: "" }) }} onClear={undefined} />;
    }
    const isolated = getSomeorUndefined(view.isolated);
    return (
        <>
            <Box css={styles.layerList} role="list" aria-label={m.libraryTab({ tab: "layers" })} data-schematic-layers="">
                {layers.map((layer) => {
                    const shown = layerShown(layer, view);
                    const locked = layerLocked(layer, view);
                    const alone = isolated !== undefined && stringEqual(isolated, layer.key);
                    const n = counts.get(layer.key) ?? 0;
                    return (
                        <Box key={layer.key} css={styles.layerRow} role="listitem" data-schematic-layer={layer.key} {...(shown ? {} : { "data-hidden": "" })}>
                            <Box as="span" css={styles.layerSwatch} {...tintAttributes(layerTint(layer))} aria-hidden="true" />
                            <Box as="span" css={styles.layerName}>{layer.label}</Box>
                            <Box as="span" css={styles.layerCount} aria-label={m.layerCount({ n, count: words.number(n) })}>{words.number(n)}</Box>
                            <Box as="span" css={styles.layerToggles}>
                                <chakra.button type="button" css={styles.layerToggle} data-layer-toggle="isolate" aria-pressed={alone} {...(alone ? { "data-on": "" } : {})}
                                    aria-label={m.layerIsolate({ layer: layer.label, isolated: alone })} title={m.layerIsolate({ layer: layer.label, isolated: alone })}
                                    onClick={() => onView(toggleIsolated(view, layer.key))}>
                                    <FontAwesomeIcon icon={faBullseye} />
                                </chakra.button>
                                <chakra.button type="button" css={styles.layerToggle} data-layer-toggle="lock" aria-pressed={locked} {...(locked ? { "data-on": "" } : {})}
                                    aria-label={m.layerLock({ layer: layer.label, locked })} title={m.layerLock({ layer: layer.label, locked })}
                                    onClick={() => onView(toggleLocked(layers, view, layer.key))}>
                                    <FontAwesomeIcon icon={locked ? faLock : faLockOpen} />
                                </chakra.button>
                                <chakra.button type="button" css={styles.layerToggle} data-layer-toggle="show" aria-pressed={shown} {...(shown ? { "data-on": "" } : {})}
                                    aria-label={m.layerShow({ layer: layer.label, shown })} title={m.layerShow({ layer: layer.label, shown })}
                                    onClick={() => onView(toggleShown(layers, view, layer.key))}>
                                    <FontAwesomeIcon icon={shown ? faEye : faEyeSlash} />
                                </chakra.button>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            {anyHidden(layers, view) && (
                <Box css={styles.layerFoot}>
                    <Button size="xs" variant="outline" data-layers-show-all="" onClick={() => onView(showAll(layers, view))}>{m.layersShowAll()}</Button>
                </Box>
            )}
        </>
    );
}
