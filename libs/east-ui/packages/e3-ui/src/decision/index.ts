/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Decision platform namespace — constructors for the decision envelope
 * (`make` / `option` / `reference` / `judgement`), the per-surface handle
 * (`bind`), and the East `Types`.
 *
 * @packageDocumentation
 */

import { Decision as constructors } from './types.js';
import { decisionBind, decisionHandleType, judgementsType, DecisionHandleType, CommitStateType } from './bind.js';

export const Decision = {
    ...constructors,
    /**
     * Build the per-surface decision handle from bound decision views + the
     * bound judgements view — see {@link decisionBind}.
     */
    bind: decisionBind,
    Types: {
        ...constructors.Types,
        /** The default handle struct returned by {@link decisionBind};
         *  `HandleFor(Contract)` builds the contract-specific one. */
        Handle: DecisionHandleType,
        /** Build the handle type for a constraint contract. */
        HandleFor: decisionHandleType,
        /** The derived per-case commit gate. */
        CommitState: CommitStateType,
        /** Build the judgements dataset type for a constraint contract —
         *  `Decision.Types.Judgements(Contract)`; call with no argument for
         *  the default primitive op-variant. */
        Judgements: judgementsType,
    },
} as const;
