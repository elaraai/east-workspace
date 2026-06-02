# Change request: one-shot task execution

> Status: **superseded** · 2026-06-02 → folded into
> [`e3-functions.md`](./e3-functions.md)

One-shot execution is no longer specced on its own. It is one of two front-ends
onto a single graph-free execution core — the other being **`e3.function`**, a
named callable stored in a package and invoked by value. The two differ only in
where the IR and inputs come from:

| | inputs = values | inputs = live datasets |
|---|---|---|
| IR by name (in package) | `e3.function` | named fn over current data |
| IR inline (in request) | ad-hoc lambda | **one-shot** |

See [`e3-functions.md`](./e3-functions.md) for the full design. It carries over
this document's substance — the shared compute-core extraction (`marshalInputs` /
`runProcess` / `buildRunnerArgv` / `runDetached`, now on `TaskRunner`), the
inline/memory-bounded/fail-closed result semantics, the 1 MB result-size budget
and the rejection of streaming, the in-memory launch/poll/cancel registry, and
the snapshot-by-content-hash consistency model — and revises the request's
`runner` from a resolved `Array<String>` to the `RunnerType` variant (§4 there)
so an arbitrary-argv `custom` runner is an explicit, gateable tag rather than the
shape of every request.
