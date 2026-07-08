/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - In-place takeover (`position: static ↔ fixed`): `expandable` slot recipe
 *   - Topmost-only Esc + overlay arbitration: this renderer (module expand stack)
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box as ChakraBox, IconButton, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExpand, faCompress } from "@fortawesome/free-solid-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Expandable } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const expandableEqual = equalFor(Expandable.Types.Expandable);

/** East Expandable value type. */
export type ExpandableValue = ValueTypeOf<typeof Expandable.Types.Expandable>;

export interface EastChakraExpandableProps {
    value: ExpandableValue;
    storageKey: string;
}

/**
 * Currently-expanded instances, innermost last. Esc collapses only the top
 * entry, so nested expanded regions unwind one keypress at a time.
 */
const expandStack: symbol[] = [];

/**
 * Find the nearest ancestor whose styles make it the CSS containing block
 * for `position: fixed` descendants — which would trap the takeover inside
 * that ancestor instead of filling the app container. Truthy-guards handle
 * jsdom, where unset properties compute to `""` rather than `"none"`.
 */
function findFixedContainingBlockAncestor(el: HTMLElement): { node: HTMLElement; prop: string } | null {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.transform && cs.transform !== "none") return { node, prop: `transform: ${cs.transform}` };
        if (cs.filter && cs.filter !== "none") return { node, prop: `filter: ${cs.filter}` };
        if (cs.backdropFilter && cs.backdropFilter !== "none") return { node, prop: `backdrop-filter: ${cs.backdropFilter}` };
        if (cs.perspective && cs.perspective !== "none") return { node, prop: `perspective: ${cs.perspective}` };
        if (cs.contain && /layout|paint|strict|content/.test(cs.contain)) return { node, prop: `contain: ${cs.contain}` };
        if (cs.willChange && /transform|filter|perspective/.test(cs.willChange)) return { node, prop: `will-change: ${cs.willChange}` };
    }
    return null;
}

/**
 * Renders an East UI Expandable — a region that expands in place to fill the
 * app container.
 *
 * The takeover is pure CSS (the `expanded` recipe variant switches the SAME
 * root element to `position: fixed; inset: 0`), so the content subtree keeps
 * its React/DOM identity across the toggle: no portal, no remount, no state
 * loss. Esc collapses the topmost expanded region only when no inner
 * dismissable layer consumed the keypress (`event.defaultPrevented`), and
 * returns focus to the toggle control.
 */
export const EastChakraExpandable = memo(function EastChakraExpandable({ value, storageKey }: EastChakraExpandableProps) {
    const expandedProp = getSomeorUndefined(value.expanded);
    const label = getSomeorUndefined(value.label);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const zIndexOverride = style ? getSomeorUndefined(style.zIndex) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const onExpandedChangeFn = useMemo(() => getSomeorUndefined(value.onExpandedChange), [value.onExpandedChange]);

    // Interactive-state pattern: local state seeded from the East value,
    // synced when the prop changes (a State-driven `expanded` controls the
    // region; omitted → purely local toggling).
    const [expanded, setExpanded] = useState<boolean>(expandedProp ?? false);
    useEffect(() => { setExpanded(expandedProp ?? false); }, [expandedProp]);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const controlRef = useRef<HTMLButtonElement | null>(null);
    const idRef = useRef<symbol | null>(null);
    if (idRef.current === null) idRef.current = Symbol("expandable");

    const handleToggle = useCallback(() => {
        const next = !expanded;
        setExpanded(next);
        if (onExpandedChangeFn) queueMicrotask(() => onExpandedChangeFn(next));
    }, [expanded, onExpandedChangeFn]);

    // While expanded: join the module expand stack and listen for Esc. Only
    // the topmost instance collapses, and only when no inner overlay consumed
    // the keypress (Ark dismissable layers preventDefault the Esc they
    // handle). Cleanup runs on collapse and unmount (e.g. a <Pages> route
    // change remounting the active page).
    useEffect(() => {
        if (!expanded) return;
        // Host-contract check: a transform/filter/contain ancestor silently
        // re-scopes `position: fixed` to itself, so the takeover fills that
        // ancestor instead of the window. Warn with the offending node so the
        // host can fix its wrapper (e.g. virtualizers should offset rows with
        // `top`, not `transform: translateY`).
        if (rootRef.current !== null) {
            const trap = findFixedContainingBlockAncestor(rootRef.current);
            if (trap !== null) {
                console.warn(
                    `[east-ui] <Expandable>${label !== undefined ? ` ("${label}")` : ""} expanded inside an ancestor with ${trap.prop} — ` +
                    "that ancestor is the containing block for position: fixed, so the region fills it instead of the app container. " +
                    "Remove the property from the host wrapper (virtualized rows: offset with `top` instead of `transform`).",
                    trap.node,
                );
            }
        }
        const id = idRef.current as symbol;
        expandStack.push(id);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (event.defaultPrevented) return;
            if (expandStack[expandStack.length - 1] !== id) return;
            setExpanded(false);
            if (onExpandedChangeFn) queueMicrotask(() => onExpandedChangeFn(false));
            controlRef.current?.focus();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            const i = expandStack.indexOf(id);
            if (i !== -1) expandStack.splice(i, 1);
        };
    }, [expanded, onExpandedChangeFn]);

    const styles = useSlotRecipe({ key: "expandable" })({ expanded });

    const regionName = label ?? "region";
    const ariaLabel = expanded ? `Collapse ${regionName}` : `Expand ${regionName}`;

    return (
        <ChakraBox
            ref={rootRef}
            css={styles.root}
            {...(expanded && zIndexOverride !== undefined ? { zIndex: Number(zIndexOverride) } : {})}
            {...(expanded && background !== undefined ? { background } : {})}
        >
            <IconButton
                ref={controlRef}
                css={styles.control}
                aria-label={ariaLabel}
                aria-expanded={expanded}
                onClick={handleToggle}
                variant="ghost"
                size="xs"
            >
                <FontAwesomeIcon icon={expanded ? faCompress : faExpand} />
            </IconButton>
            <ChakraBox css={styles.body}>
                <EastChakraComponent value={value.content} storageKey={`${storageKey}.content`} />
            </ChakraBox>
        </ChakraBox>
    );
}, (prev, next) => expandableEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
