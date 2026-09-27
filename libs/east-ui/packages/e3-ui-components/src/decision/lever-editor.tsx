/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal — the judgement facet's typed constraint editor for one lever.
 *
 * The lever names a case of the solution's constraint contract (a by-name
 * `VariantType`); this editor derives its controls from that case's payload
 * East type, read off the judgements binding's registered type
 * ({@link constraintContractOf}):
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
import { NullType, defaultValue, none, some, toEastTypeValue, variant, type EastTypeValue } from '@elaraai/east';
import {
    EastChakraSelect,
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
} from '@elaraai/east-ui-components';

import type { ConstraintValue } from './handle-runtime.js';
import { OP_WORDS } from './constraint-format.js';

/** A struct's fields or a variant's cases, as East types. */
type Members = ReadonlyArray<{ name: string; type: EastTypeValue }>;

const PRIMITIVES = new Set(['String', 'Integer', 'Float', 'DateTime', 'Boolean']);

/** What an op the payload does not have edits — nothing. */
const NULL_TYPE = toEastTypeValue(NullType);

/** The value an input of `type` starts from: East's default for it
 *  ({@link defaultValue}), except a DateTime, which opens on now rather than
 *  East's epoch — per field, for a struct. */
function emptyFor(type: EastTypeValue): unknown {
    if (type.type === 'DateTime') return new Date();
    if (type.type === 'Struct') return Object.fromEntries((type.value as Members).map(f => [f.name, emptyFor(f.type)]));
    return defaultValue(type);
}

/**
 * Whether the editor can edit a lever's payload: a bare primitive, a struct
 * of primitives, or an op variant whose case payloads are primitives or
 * structs of primitives.
 *
 * @param payload - The contract case's payload type; `undefined` when the
 *   contract is not known yet
 * @returns Whether the lever gets an editor
 */
export function leverPayloadEditable(payload: EastTypeValue | undefined): boolean {
    if (payload === undefined) return false;
    const primitive = (t: EastTypeValue) => PRIMITIVES.has(t.type);
    const structOfPrimitives = (t: EastTypeValue) => t.type === 'Struct' && (t.value as Members).every(f => primitive(f.type));
    if (primitive(payload) || structOfPrimitives(payload)) return true;
    if (payload.type === 'Variant') return (payload.value as Members).every(c => primitive(c.type) || structOfPrimitives(c.type));
    return false;
}

export interface LeverEditorProps {
    /** The contract case name this lever injects. */
    leverCase: string;
    /** The case's payload type, from the solution's contract. */
    payload: EastTypeValue;
    onInject: (constraint: ConstraintValue) => void;
}

const inputStyle = some({ size: some(variant('sm', null)) });

export function LeverEditor({ leverCase, payload, onInject }: LeverEditorProps) {
    const button = useRecipe({ key: 'button' });

    const isOpVariant = payload.type === 'Variant';
    const ops = useMemo(() => (payload.type === 'Variant' ? (payload.value as Members).map(c => c.name) : []), [payload]);
    const [opTag, setOpTag] = useState(ops[0] ?? '');
    const active: EastTypeValue = payload.type === 'Variant'
        ? ((payload.value as Members).find(c => c.name === opTag)?.type ?? NULL_TYPE)
        : payload;

    // Typed controls own their in-progress state; commits land in a ref so
    // typing never re-renders this component (the Ark NumberInput resets if
    // its payload identity changes mid-edit).
    const valRef = useRef<unknown>(emptyFor(active));
    const keyRef = useRef(`${leverCase}:${opTag}`);
    if (keyRef.current !== `${leverCase}:${opTag}`) {
        keyRef.current = `${leverCase}:${opTag}`;
        valRef.current = emptyFor(active);
    }

    const primitiveInput = (type: EastTypeValue, key: string, get: () => unknown, set: (v: unknown) => void): ReactNode => {
        switch (type.type) {
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
                            value: some(get() === true ? 'true' : 'false'),
                            items: [{ value: 'true', label: 'true', disabled: none }, { value: 'false', label: 'false', disabled: none }],
                            placeholder: none, multiple: none, disabled: none,
                            onChange: some((v: string) => set(v === 'true')), onChangeMultiple: none, onOpenChange: none,
                            style: inputStyle,
                        } as never}
                    />
                );
            case 'String':
                return <EastChakraStringInput key={key} value={{ value: get() as string, onChange: some(set), style: inputStyle } as never} />;
            default:
                // A type the editor does not edit (an op whose case carries
                // no value) has no input.
                return null;
        }
    };

    const valueControls = useMemo<ReactNode>(() => {
        const k = keyRef.current;
        if (active.type === 'Struct') {
            return (active.value as Members).map(({ name: field, type }) => (
                <Box key={`${k}.${field}`} display="flex" alignItems="center" gap="6px" minW={0}>
                    <Box as="span" textStyle="caption.eyebrow" color="fg.subtle" flexShrink={0}>{field}</Box>
                    {primitiveInput(type, `${k}.${field}.in`,
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
