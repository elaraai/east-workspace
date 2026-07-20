/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal — the judgement facet's typed constraint editor for one lever.
 *
 * The lever names a case of the solution's constraint contract (a by-name
 * `VariantType`); this editor derives its controls from that case's payload
 * type, read off the judgements binding's registered type:
 *
 * - variant of ops over primitives (`atMost` / `between {min,max}` / …) —
 *   an op select plus typed input(s);
 * - struct of primitives (a blackout `{person, from, to}`) — one typed
 *   input per field;
 * - bare primitive — a single typed input.
 *
 * Submission builds the contract-variant value and hands it to the handle's
 * `inject` (which upserts by case name).
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, chakra, useRecipe } from '@chakra-ui/react';
import { none, some, variant } from '@elaraai/east';
import {
    EastChakraSelect,
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
} from '@elaraai/east-ui-components';

import type { ConstraintValue } from './handle-runtime.js';
import { OP_WORDS } from './constraint-format.js';

/** Minimal structural view of an East runtime type object. */
export interface TypeNode {
    type: string;
    cases?: Record<string, TypeNode>;
    fields?: Record<string, TypeNode>;
    key?: TypeNode;
    value?: TypeNode;
}

const PRIMITIVES = new Set(['String', 'Integer', 'Float', 'DateTime', 'Boolean']);

/**
 * Normalize a registered binding type to {@link TypeNode}. Platform type
 * arguments arrive as decoded `EastTypeValue` variants
 * (`{type:'Struct', value:[{name,type}…]}`); runtime `EastType` objects use
 * the flattened shape (`{type:'Struct', fields:{…}}`). Accept both.
 */
export function normalizeTypeValue(tv: unknown): TypeNode {
    const n = tv as { type: string; value?: unknown; cases?: unknown; fields?: unknown; key?: unknown };
    if (n.cases !== undefined || n.fields !== undefined) {
        // Runtime-object form — already TypeNode-shaped; normalize children.
        const out: TypeNode = { type: n.type };
        if (n.cases) out.cases = Object.fromEntries(Object.entries(n.cases as Record<string, unknown>).map(([k, v]) => [k, normalizeTypeValue(v)]));
        if (n.fields) out.fields = Object.fromEntries(Object.entries(n.fields as Record<string, unknown>).map(([k, v]) => [k, normalizeTypeValue(v)]));
        if (n.key) out.key = normalizeTypeValue(n.key);
        if (n.value !== undefined && (n.type === 'Array' || n.type === 'Dict')) out.value = normalizeTypeValue(n.value);
        return out;
    }
    switch (n.type) {
        case 'Struct':
            return { type: 'Struct', fields: Object.fromEntries((n.value as { name: string; type: unknown }[]).map(f => [f.name, normalizeTypeValue(f.type)])) };
        case 'Variant':
            return { type: 'Variant', cases: Object.fromEntries((n.value as { name: string; type: unknown }[]).map(f => [f.name, normalizeTypeValue(f.type)])) };
        case 'Array':
            return { type: 'Array', value: normalizeTypeValue(n.value) };
        case 'Dict': {
            const d = n.value as { key: unknown; value: unknown };
            return { type: 'Dict', key: normalizeTypeValue(d.key), value: normalizeTypeValue(d.value) };
        }
        case 'Recursive': {
            // Unwrap one level when the wrapper carries an inner type.
            const w = n.value as { type?: string; value?: { inner?: unknown } };
            if (w?.type === 'wrapper' && w.value?.inner) return normalizeTypeValue(w.value.inner);
            return { type: n.type };
        }
        default:
            return { type: n.type };
    }
}

function emptyFor(node: TypeNode): unknown {
    switch (node.type) {
        case 'Integer': return 0n;
        case 'Float': return 0;
        case 'DateTime': return new Date();
        case 'Boolean': return false;
        case 'String': return '';
        case 'Struct': return Object.fromEntries(Object.entries(node.fields ?? {}).map(([k, f]) => [k, emptyFor(f)]));
        default: return null;
    }
}

/** Editable shapes: bare primitive, struct of primitives, or an op variant
 *  whose case payloads are primitives / structs of primitives. */
export function leverPayloadEditable(node: TypeNode | undefined): boolean {
    if (!node) return false;
    if (PRIMITIVES.has(node.type)) return true;
    if (node.type === 'Struct') return Object.values(node.fields ?? {}).every(f => PRIMITIVES.has(f.type));
    if (node.type === 'Variant') return Object.values(node.cases ?? {}).every(c => PRIMITIVES.has(c.type) || (c.type === 'Struct' && Object.values(c.fields ?? {}).every(f => PRIMITIVES.has(f.type))));
    return false;
}

export interface LeverEditorProps {
    /** The contract case name this lever injects. */
    leverCase: string;
    /** The case's payload type, walked off the judgements binding type. */
    payload: TypeNode;
    onInject: (constraint: ConstraintValue) => void;
}

const inputStyle = some({ size: some(variant('sm', null)) });

export function LeverEditor({ leverCase, payload, onInject }: LeverEditorProps) {
    const button = useRecipe({ key: 'button' });

    const isOpVariant = payload.type === 'Variant';
    const ops = useMemo(() => (isOpVariant ? Object.keys(payload.cases ?? {}) : []), [isOpVariant, payload]);
    const [opTag, setOpTag] = useState(ops[0] ?? '');
    const active: TypeNode = isOpVariant ? (payload.cases?.[opTag] ?? { type: 'Null' }) : payload;

    // Typed controls own their in-progress state; commits land in a ref so
    // typing never re-renders this component (the Ark NumberInput resets if
    // its payload identity changes mid-edit).
    const valRef = useRef<unknown>(emptyFor(active));
    const keyRef = useRef(`${leverCase}:${opTag}`);
    if (keyRef.current !== `${leverCase}:${opTag}`) {
        keyRef.current = `${leverCase}:${opTag}`;
        valRef.current = emptyFor(active);
    }

    const primitiveInput = (node: TypeNode, key: string, get: () => unknown, set: (v: unknown) => void): ReactNode => {
        switch (node.type) {
            case 'Integer':
                return <EastChakraIntegerInput key={key} value={{ value: get() as bigint, onChange: some(set), style: inputStyle } as never} />;
            case 'Float':
                return <EastChakraFloatInput key={key} value={{ value: get() as number, onChange: some(set), style: inputStyle } as never} />;
            case 'DateTime':
                return <EastChakraDateTimeInput key={key} value={{ value: get() as Date, onChange: some(set), style: inputStyle } as never} />;
            case 'Boolean':
                return (
                    <EastChakraSelect
                        key={key}
                        ariaLabel={key}
                        value={{
                            value: some(String(get())),
                            items: [{ value: 'true', label: 'true', disabled: none }, { value: 'false', label: 'false', disabled: none }],
                            placeholder: none, multiple: none, disabled: none,
                            onChange: some((v: string) => set(v === 'true')), onChangeMultiple: none, onOpenChange: none,
                            style: inputStyle,
                        } as never}
                    />
                );
            default:
                return <EastChakraStringInput key={key} value={{ value: String(get() ?? ''), onChange: some(set), style: inputStyle } as never} />;
        }
    };

    const valueControls = useMemo<ReactNode>(() => {
        const k = keyRef.current;
        if (active.type === 'Struct') {
            return Object.entries(active.fields ?? {}).map(([field, node]) => (
                <Box key={`${k}.${field}`} display="flex" alignItems="center" gap="6px" minW={0}>
                    <Box as="span" textStyle="caption.eyebrow" color="fg.subtle" flexShrink={0}>{field}</Box>
                    {primitiveInput(node, `${k}.${field}.in`,
                        () => (valRef.current as Record<string, unknown>)[field],
                        v => { (valRef.current as Record<string, unknown>)[field] = v; })}
                </Box>
            ));
        }
        return (
            <Box key={`${k}.wrap`} width="min(180px, 100%)" flexShrink={0}>
                {primitiveInput(active, `${k}.value`, () => valRef.current, v => { valRef.current = v; })}
            </Box>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, opTag, leverCase]);

    const submit = () => {
        const value = valRef.current;
        const payloadValue = active.type === 'Struct' ? { ...(value as object) } : value;
        const constraint = (isOpVariant
            ? variant(leverCase, variant(opTag, payloadValue))
            : variant(leverCase, payloadValue)) as unknown as ConstraintValue;
        onInject(constraint);
        valRef.current = emptyFor(active);
    };

    return (
        <Box
            display="flex"
            alignItems="center"
            gap="8px"
            flexWrap="wrap"
            minW={0}
            css={{
                '& [data-scope=select][data-part=root]': { width: 'auto', minWidth: '110px', flexShrink: 0 },
                '& [data-scope=number-input][data-part=root]': { width: '150px', flexShrink: 0 },
            }}
        >
            {isOpVariant && (
                <EastChakraSelect
                    ariaLabel="Operator"
                    value={{
                        value: some(opTag),
                        items: ops.map(o => ({ value: o, label: OP_WORDS[o] ?? o, disabled: none })),
                        placeholder: none, multiple: none, disabled: none,
                        onChange: some((v: string) => setOpTag(v)), onChangeMultiple: none, onOpenChange: none,
                        style: inputStyle,
                    } as never}
                />
            )}
            {valueControls}
            <chakra.button type="button" css={button({ variant: 'solid', size: 'xs' })} onClick={submit}>
                Add
            </chakra.button>
        </Box>
    );
}
