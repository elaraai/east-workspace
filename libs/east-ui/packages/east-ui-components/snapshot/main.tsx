/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Snapshot entry for pure east-ui components. Discovers every
 * `east-ui/test/**\/*.examples.ts` via `import.meta.glob` and hands
 * rendering to the shared {@link mountSnapshot} harness. No `prepare` step
 * — these examples render from their IR alone (no e3 dataset binding).
 *
 * @packageDocumentation
 */

import '@elaraai/east-ui-components/fonts';
import { mountSnapshot } from '../../../scripts/snapshot-app.tsx';

/** Keep the category path in the key (e.g. `buttons/button`). */
function keyOf(filePath: string): string {
    return filePath.replace(/^.*\/east-ui\/test\//, '').replace(/\.examples\.ts$/, '');
}

mountSnapshot({
    modules: import.meta.glob<Record<string, unknown>>('../../east-ui/test/**/*.examples.ts'),
    keyOf,
});
