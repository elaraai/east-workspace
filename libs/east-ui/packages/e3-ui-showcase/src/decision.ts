/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Decision showcase — `ArrayType(DecisionType)`-bound queue scenes wrapped as
 * UI tasks and bundled into `east-ui-showcase-decision@<pkg.version>`.
 *
 * Each example binds an `e3.input(..., ArrayType(DecisionType), ...)` and
 * renders a `<DecisionQueue value={view} />`. The inputs are forwarded as
 * `extras` so the deployed workspace has them available at render time.
 *
 * Run via `make start-decision` or `make decision`.
 */

import * as queueExamples from '@elaraai/e3-ui/examples/decision/queue';
import * as loopExamples from '@elaraai/e3-ui/examples/decision/loop';
import * as journalExamples from '@elaraai/e3-ui/examples/decision/journal';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const examples = {
    ...queueExamples,
    ...loopExamples,
    ...journalExamples,
};

export default await buildShowcasePackage('decision', pkgInfo.version, examples, {
    extras: [
        queueExamples.queueDecisions,
        queueExamples.queueJudgements,
        loopExamples.loopRosterDecisions,
        loopExamples.loopOrderDecisions,
        loopExamples.loopJudgements,
        journalExamples.journalDecisions,
        journalExamples.journalJudgements,
    ],
});
