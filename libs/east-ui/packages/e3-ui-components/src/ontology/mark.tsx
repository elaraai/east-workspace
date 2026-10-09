/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<OntologyMark>` — one of the Ontology editor's icons: Font Awesome's solid
 * icon (#1263), in the square the Feather icon it replaced took.
 *
 * @packageDocumentation
 */

import { chakra, useRecipe } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

/** The squares the editor's icons take, in px — east-ui-components' `ontologyMark` recipe's sizes. */
export type OntologyMarkSize = '11' | '12' | '13' | '14' | '18';

/** Props for {@link OntologyMark}. */
export interface OntologyMarkProps {
    /** The icon: a Font Awesome solid icon. */
    readonly icon: IconDefinition;
    /** The square it takes, in px — what the Feather icon's `size` was. */
    readonly size: OntologyMarkSize;
}

/**
 * One of the Ontology editor's icons: a Font Awesome solid icon in an N × N
 * square (the `ontologyMark` recipe), never a Feather icon (#1263).
 *
 * @param props - The icon and its square ({@link OntologyMarkProps})
 * @returns The mark, named by its icon (`data-ontology-mark`)
 */
export function OntologyMark({ icon, size }: OntologyMarkProps) {
    const mark = useRecipe({ key: 'ontologyMark' })({ size });
    return (
        <chakra.span css={mark} data-ontology-mark={icon.iconName}>
            <FontAwesomeIcon icon={icon} />
        </chakra.span>
    );
}
