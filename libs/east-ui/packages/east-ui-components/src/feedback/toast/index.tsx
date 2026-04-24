/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Toast runtime + Toaster singleton.
 *
 * Hosts must mount `<Toaster />` at the top of their React tree for
 * `Toast.emit(...)` calls to be visible. The platform implementation is
 * registered at module load.
 */

import { memo } from "react";
import {
    Toaster as ChakraToaster,
    createToaster,
    Toast as ChakraToast,
    Stack as ChakraStack,
    Button as ChakraButton,
} from "@chakra-ui/react";
import type { PlatformFunction } from "@elaraai/east/internal";
import type { ValueTypeOf } from "@elaraai/east";
import { Toast } from "@elaraai/east-ui";
import { registerPlatformImplementation } from "../../platform/registry.js";
import { getSomeorUndefined } from "../../utils";

export type ToastValue = ValueTypeOf<typeof Toast.Types.Toast>;
type ToastActionValue = ValueTypeOf<typeof Toast.Types.Action>;

// =============================================================================
// Singleton Toaster store
// =============================================================================

/**
 * The Chakra toaster store. Shared across all `Toast.emit(...)` calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toaster: any = createToaster({
    placement: "top-end",
    pauseOnPageIdle: true,
    max: 5,
});

/**
 * Host-side component that renders the Chakra Toaster singleton. Hosts mount
 * this once near the top of their tree.
 */
export const Toaster = memo(function Toaster() {
    return (
        <ChakraToaster toaster={toaster}>
            {(t) => (
                <ChakraToast.Root width={{ md: "sm" }}>
                    {t.type === "loading" ? (
                        <ChakraToast.Indicator />
                    ) : (
                        <ChakraToast.Indicator />
                    )}
                    <ChakraStack gap="1" flex="1" maxWidth="100%">
                        {t.title ? <ChakraToast.Title>{t.title}</ChakraToast.Title> : null}
                        {t.description ? (
                            <ChakraToast.Description>{t.description}</ChakraToast.Description>
                        ) : null}
                    </ChakraStack>
                    {t.action ? (
                        <ChakraToast.ActionTrigger>{t.action.label}</ChakraToast.ActionTrigger>
                    ) : null}
                    {t.meta && (t.meta as { actions?: ToastActionValue[] }).actions ? (
                        <ChakraStack direction="row" gap="2">
                            {(t.meta as { actions: ToastActionValue[] }).actions.map((a, i) => (
                                <ChakraButton
                                    key={i}
                                    size="xs"
                                    variant="subtle"
                                    onClick={() => {
                                        try {
                                            (a.onClick as unknown as () => void)();
                                        } catch {
                                            // Best-effort — East callbacks may not be directly invokable.
                                        }
                                    }}
                                >
                                    {a.label}
                                </ChakraButton>
                            ))}
                        </ChakraStack>
                    ) : null}
                    <ChakraToast.CloseTrigger />
                </ChakraToast.Root>
            )}
        </ChakraToaster>
    );
});

// =============================================================================
// Platform implementation — Toast.emit
// =============================================================================

function statusToChakraType(status: ToastValue["status"]["type"]): "info" | "success" | "warning" | "error" {
    if (status === "neutral") return "info";
    if (status === "info" || status === "success" || status === "warning" || status === "error") {
        return status;
    }
    return "info";
}

/**
 * Platform implementation for `Toast.emit` — pushes into the singleton toaster.
 */
export const ToastImpl: PlatformFunction[] = [
    Toast.emit.implement((value: ToastValue) => {
        const description = getSomeorUndefined(value.description);
        const duration = getSomeorUndefined(value.duration);
        const actions = getSomeorUndefined(value.actions);

        toaster.create({
            title: value.title,
            description,
            type: statusToChakraType(value.status.type),
            ...(duration !== undefined ? { duration: Number(duration) } : {}),
            ...(actions !== undefined && actions.length > 0
                ? { meta: { actions } }
                : {}),
        });
        return null;
    }),
];

registerPlatformImplementation(ToastImpl);
