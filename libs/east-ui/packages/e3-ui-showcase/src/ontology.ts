/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Ontology showcase — `OntologyType`-bound graph-editor scenes wrapped as UI
 * tasks and bundled into `east-ui-showcase-ontology@<pkg.version>`.
 *
 * Each example binds an `e3.input(..., OntologyType, ...)` and renders an
 * `Ontology.Root({ binding })` editor (some paired with a Diff panel). The
 * inputs are forwarded as `extras` so the deployed workspace has them
 * available at render time.
 *
 * Run via `make start-ontology` or `make ontology`.
 */

import * as examples from '@elaraai/e3-ui/examples/ontology';
import pkgInfo from '../package.json' with { type: 'json' };
import { buildShowcasePackage } from './utils.js';

const {
    simpleOntologyInput,
    supplyChainOntologyInput,
    governanceOntologyInput,
    readonlyOntologyInput,
    compactOntologyInput,
    ontologyWithDiffInput,
    dashboardLeftInput,
    dashboardRightInput,
} = examples;

export default await buildShowcasePackage('ontology', pkgInfo.version, examples, {
    extras: [
        simpleOntologyInput,
        supplyChainOntologyInput,
        governanceOntologyInput,
        readonlyOntologyInput,
        compactOntologyInput,
        ontologyWithDiffInput,
        dashboardLeftInput,
        dashboardRightInput,
    ],
});
