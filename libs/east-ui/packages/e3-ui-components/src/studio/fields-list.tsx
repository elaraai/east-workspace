/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioFieldsList` — a visual's source's fields, last in its Configure tab
 * (#1672, EDT-1, EDT-3), as the spec's editor draws them: under the source's
 * name and how many it has, a search box, then what a visual groups by and its
 * numbers, each field a 32px row — its grip, its kind's icon, its label, a
 * currency's code, and a check once a well holds it. A row drags onto a well:
 * it is an item of the list's library, which the wells take fields from, and
 * the keyboard picks it up as it does a Library's card.
 *
 * @packageDocumentation
 */

import { useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faCheck, faGripVertical, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import { Pill, useDragSourceItem, useFormatters } from "@elaraai/east-ui-components";

import { useStudioMessages } from "./messages.js";
import type { VisualSource } from "./visual/values.js";

type Styles = Record<string, SystemStyleObject>;

/** A source's field. */
type Field = VisualSource["fields"][number];

/**
 * Each kind of field's icon: a date's calendar, a text's letter, a yes or
 * no's switch, a number's hash.
 *
 * @param field - The field
 * @returns A Font Awesome solid icon name
 */
export function kindIcon(field: Field): string {
    switch (field.kind.type) {
        case "date": return "calendar";
        case "text": return "font";
        case "boolean": return "toggle-on";
        case "number": return "hashtag";
        case "other": return "cube";
    }
}

/** A field's unit, where its format says one: a currency's code. */
function unitOf(field: Field): string | undefined {
    return field.format.type === "some" && field.format.value.type === "currency" ? field.format.value.value.code : undefined;
}

/** Props of {@link StudioFieldsList}. */
export interface StudioFieldsListProps {
    /** The source. */
    source: VisualSource;
    /** The fields its wells hold (`placedFields`). */
    placed: readonly string[];
    /** The list's library: what the wells take fields from. */
    library: string;
}

/**
 * The source's fields — see the module docs.
 *
 * @param props - The source, the fields its wells hold, and its library
 * @returns The list
 */
export function StudioFieldsList({ source, placed, library }: StudioFieldsListProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const words = useFormatters();
    const [query, setQuery] = useState("");
    // What the search leaves, by a field's label or its id.
    const shown = useMemo(() => {
        const asked = query.trim().toLowerCase();
        return asked === "" ? source.fields : source.fields.filter((field) => `${field.label} ${field.id}`.toLowerCase().includes(asked));
    }, [source.fields, query]);
    // What a visual groups by first, then numbers.
    const groups = [false, true].map((numbers) => ({ numbers, fields: shown.filter((field) => (field.kind.type === "number") === numbers) }))
        .filter((group) => group.fields.length > 0);
    const label = m.fieldsOf({ source: source.name });
    return (
        <Box css={styles.fields} data-configure="fields" role="group" aria-label={label}>
            <Box css={styles.fieldsHead}>
                <Box as="span" css={styles.lbl}>{label}</Box>
                <Box as="span" css={styles.count} data-fields-count="">{words.number(source.fields.length)}</Box>
            </Box>
            <Box css={styles.fieldSearch}>
                <Box as="span" css={styles.fieldSearchIcon} aria-hidden><FontAwesomeIcon icon={faMagnifyingGlass} /></Box>
                <chakra.input css={styles.fieldSearchInput} type="search" value={query} placeholder={m.findField()} aria-label={m.findField()}
                    autoComplete="off" data-fields-search="" onChange={(event) => setQuery(event.target.value)} />
            </Box>
            {groups.map((group) => (
                <FieldGroup key={String(group.numbers)} label={m.fieldGroup({ numbers: group.numbers })}>
                    {group.fields.map((field) => <FieldRow key={field.id} field={field} library={library} placed={placed.includes(field.id)} />)}
                </FieldGroup>
            ))}
            {groups.length === 0 && <Box as="span" css={styles.fieldNone}>{m.noFieldFound()}</Box>}
            <Box as="span" css={styles.fldHint}>{m.dragFields()}</Box>
        </Box>
    );
}

/** One group of the fields: its label over its rows. */
function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    return (
        <>
            <Box as="span" css={styles.lbl} data-fields-group="">{label}</Box>
            <Box as="ul" css={styles.fieldRows} aria-label={label}>{children}</Box>
        </>
    );
}

/** One field: its grip, its kind, its label, its unit and a check once a well holds it — and its drag onto a well. */
function FieldRow({ field, library, placed }: { field: Field; library: string; placed: boolean }) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const m = useStudioMessages();
    const from = useMemo(() => ({ library, key: field.id, label: field.label }), [library, field.id, field.label]);
    const ghost = useMemo(() => <Pill size="sm">{field.label}</Pill>, [field.label]);
    const drag = useDragSourceItem(from, ghost);
    const unit = unitOf(field);
    return (
        <Box as="li" css={styles.fieldRow} data-field-row={field.id} data-placed={placed ? "" : undefined} data-draggable={drag === undefined ? undefined : ""} {...drag}>
            <Box as="span" css={styles.fieldGrip} aria-hidden><FontAwesomeIcon icon={faGripVertical} /></Box>
            <Box as="span" css={styles.fieldKind} aria-hidden><FontAwesomeIcon icon={["fas", kindIcon(field) as IconName]} /></Box>
            <Box as="span" css={styles.fieldName}>{field.label}</Box>
            {unit !== undefined && <Box as="span" css={styles.fieldUnit}>{unit}</Box>}
            {placed && <Box as="span" css={styles.fieldCheck} role="img" aria-label={m.fieldInUse()}><FontAwesomeIcon icon={faCheck} /></Box>}
        </Box>
    );
}
