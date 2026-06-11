#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Discrete Event Simulation (DES) platform functions for East.

Uses a C-level DES engine (min-heap + east_call) for high-performance
event processing without Python overhead per event.

``simulation_run`` is a generic platform function parameterised over two
East type variables:

- ``R`` - the resource (state) type: a user-defined ``StructType``
  representing the economic resource ontology.
- ``E`` - the event type: a user-defined ``VariantType`` where each case is
  an economic activity.

Because it is generic, it is not decorated with ``@platform_function`` and
has no Python-callable wrapper. It is registered via ``GenericPlatformFunction``
backed by a pure-C factory (``simulation_run_capsule``). The entire event loop
runs in C without the GIL.

**Platform function signature** (East types)::

    simulation_run[R, E](
        initial_state:   R,
        initial_events:  Array<{date: DateTime, event: E}>,
        process:         Function([R, DateTime, E], {state: R, events: Array<{date: DateTime, event: E}>}),
        config:          {max_events: Option<Integer>, end_date: Option<DateTime>},
    ) -> {final_state: R, events_processed: Integer, final_date: DateTime}

**Process handler contract**:

The handler function ``process`` is called once per dequeued event in
C (via ``east_call``). It receives:

- ``state`` (``R``): the current resource state.
- ``date`` (``DateTime``): the timestamp of the dequeued event.
- ``event`` (``E``): the event variant to dispatch on.

It must return a struct with two fields:

- ``state`` (``R``): the updated resource state after processing the event.
- ``events`` (``Array<{date: DateTime, event: E}>``): zero or more
  follow-on events to schedule; each is pushed onto the min-heap
  immediately.

Match dispatch on ``event`` is the canonical way to implement per-case
economic processes. Returning new events from within a match branch is
how process-from-process triggering works (directed cyclic economic graph).

**Config fields**:

- ``max_events`` (``Option<Integer>``): safety cap on total events processed
  (default 100 000); prevents infinite loops.
- ``end_date`` (``Option<DateTime>``): stop dequeuing events whose timestamp
  is strictly later than this date.

**Result fields**:

- ``final_state`` (``R``): resource state after the last processed event.
- ``events_processed`` (``Integer``): count of events dequeued and handled.
- ``final_date`` (``DateTime``): timestamp of the last processed event
  (millisecond precision).
"""

from east.runtime.platform import GenericPlatformFunction

from east_py_datascience.simulation._simulation_eastc import (
    simulation_run_capsule,
)

simulation_impl = [
    GenericPlatformFunction(
        name="simulation_run",
        type_parameters=["R", "E"],
        type="sync",
        fn=None,
        c_factory=simulation_run_capsule,
    ),
]

__all__ = [
    "simulation_impl",
]
