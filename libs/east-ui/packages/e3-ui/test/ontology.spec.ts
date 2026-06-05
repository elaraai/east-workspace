/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from '@elaraai/east-node-std';
import { East, none } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui/internal';
import { Data, OntologyType } from '@elaraai/e3-ui';
import { Ontology } from '@elaraai/e3-ui/internal';
import * as e3 from '@elaraai/e3';
import * as ex from './ontology.examples.js';

const ontologyInput = e3.input('ontology_spec', OntologyType, {
    nodes: [],
    links: [],
    metadata: none,
});

describeEast('Ontology', (test) => {
    Assert.examples(test, {
        simpleOntologyEditor:    ex.simpleOntologyEditor,
        supplyChainOntology:     ex.supplyChainOntology,
        governanceOntology:      ex.governanceOntology,
        readonlyOntologyViewer:  ex.readonlyOntologyViewer,
        compactDensityOntology:  ex.compactDensityOntology,
        ontologyWithDiff:        ex.ontologyWithDiff,
        multiBindingDashboard:   ex.multiBindingDashboard,
    });

    test('Ontology.Component is declared as an optional EastUI component', $ => {
        $(Assert.equal(East.value(Ontology.Component.name), 'Ontology'));
        $(Assert.equal(East.value(Ontology.Component.optional), true));
    });

    test('Ontology.Root produces a ReactiveComponent-tagged UIComponentType', $ => {
        const tree = $.let(
            Reactive.Root(East.function([], UIComponentType, $ => {
                const view = $.let(Data.bind([OntologyType], ontologyInput.path));
                return Ontology.Root({ binding: view.binding });
            })),
            UIComponentType,
        );
        $(Assert.equal(tree.unwrap().getTag(), 'ReactiveComponent'));
    });
}, { platformFns: TestImpl });
