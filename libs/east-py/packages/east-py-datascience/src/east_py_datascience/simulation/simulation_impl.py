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

Because the whole event loop runs in C without the GIL, there is no Python
implementation to decorate: the registration is a ``GenericPlatformFunction``
backed by a pure-C factory (``simulation_run_capsule``). What the package
exports under the name ``simulation_run`` is the DECLARATION —
``East.genericPlatform`` — so an East body calls it as any other platform
function, ``simulation_run(Resources, Events, state, events, process,
config)``, and the printer spells it that way (#667). There is no eager
python call: the function IS the C event loop.

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

from east.expression.platform import generic_platform
from east.runtime.platform import GenericPlatformFunction
from east.types.types import (
    ArrayType,
    DateTimeType,
    FunctionType,
    IntegerType,
    OptionType,
    StructType,
)

from east_py_datascience.simulation._simulation_eastc import (
    simulation_run_capsule,
)

ScheduledEventType = StructType([("date", DateTimeType), ("event", "E")])
"""One queued event: when it happens, and the activity variant ``E`` it is."""

ProcessResultType = StructType([("state", "R"), ("events", ArrayType(ScheduledEventType))])
"""What the handler returns: the updated resource state, and events to schedule."""

ProcessFnType = FunctionType(["R", DateTimeType, "E"], ProcessResultType)
"""The handler the loop calls once per dequeued event."""

SimulationConfigType = StructType(
    [("max_events", OptionType(IntegerType)), ("end_date", OptionType(DateTimeType))]
)
"""Run limits: the safety cap on events processed, and the date to stop at."""

SimulationResultType = StructType(
    [("final_state", "R"), ("events_processed", IntegerType), ("final_date", DateTimeType)]
)
"""The state after the last event, how many were processed, and when."""

simulation_run = generic_platform(
    "simulation_run",
    ["R", "E"],
    ["R", ArrayType(ScheduledEventType), ProcessFnType, SimulationConfigType],
    SimulationResultType,
)
"""``simulation_run<R, E>`` — the declaration an East body calls; the C
factory below implements it."""

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
    "simulation_run",
    "simulation_impl",
    "ScheduledEventType",
    "ProcessResultType",
    "ProcessFnType",
    "SimulationConfigType",
    "SimulationResultType",
]
