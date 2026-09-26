# How runs work

This guide follows one run of a package whose tasks read and write very large
collections. It covers how the data is stored and moved, how a task's work is
split and put back together, how e3 decides what runs and when, and where
records and functions fit. [`design/e3-execution.md`](../design/e3-execution.md)
has the details behind each step.

## The example

```
            sales            a 200 GB Dict keyed by account, delivered as a file
              │
            clean            e3.partition(sales)
           ╱     ╲
     enrich       score      each e3.partition(clean.output)
           ╲     ╱
          reconcile          e3.partition(enrich.output), e3.partition(score.output)
```

Each task is an `e3.streamTask` whose input is marked with `e3.partition`, which
lets e3 split the task's work over that input. An `e3.task` runs as one unit
(see [Memory](#memory)).

## How a collection is stored

A collection is stored as segments: runs of its rows, each an object named by
the SHA-256 of its bytes, of roughly a megabyte for rows of a kilobyte. Where a
segment ends is decided by the rows' content, so an edit changes only the
segments around it. A manifest object lists each segment's hash, first key,
row count and size, and the dataset refers to its manifest.

Every collection enters the store through one door, which writes this form a
segment at a time. Nothing reads a collection whole to store it.

## A run, step by step

1. **Taking the data in.** `e3 workspace deploy` reads the delivery a segment
   at a time and cuts it into the store's segments. `e3 dataset set
   --from-file` and uploads through the API do the same. A delivery taken in
   before costs only its hash.

2. **Planning `clean`.** `e3 dataflow run . ws -j 16` runs under a budget of 16
   cores.
   - `clean` is ready, since its input is set, and not cached, so e3 plans it. It
     walks the manifest and cuts it into pieces of mostly 64 to 100 MiB, at
     points the segments' hashes choose. A 200 GB input becomes a few thousand
     pieces.
   - A piece is a manifest naming segments that already exist, so planning
     copies and decodes nothing. The one exception is a `by` group that ends
     inside a segment: that segment is split.
   - The list of pieces is stored as one plan object.

3. **Running the pieces.** Each piece is a unit: one runner process running the
   task's program over that piece.
   - e3 links the piece's manifest and segments into a scratch directory inside
     the repository. It starts the runner (`east-c`, `east-node` or `east-py`,
     each with `exec`) once the budget gives it a core.
   - An input larger than 64 MiB opens lazily. A `$.for` loop reads it a
     segment at a time, and a key lookup reads only the segment the key is in.
   - What the body emits into a dict or set is sorted in a buffer of at most
     64 MiB (or 131,072 entries). Each time the buffer fills it is written to
     disk as a sorted run, and the runs are merged into one output. An array's
     elements are written as they come.
   - Up to four threads compress the output's segments.
   - The output is written in the scratch directory, on the store's own
     filesystem, so its segments are linked into the store rather than copied.
     The unit is recorded under its own identity, the task and its piece's
     inputs, so a later run finds it in the cache.

4. **Putting `clean`'s output together.** The pieces were cut by key and
   `clean` keeps each row's key, so their outputs do not overlap. e3 joins
   their manifests end to end and re-cuts only where they meet.
   - When outputs overlap, as they do for a task that re-keys its rows, e3 adds
     merge units. They run the task's own `merge` over key ranges of about
     64 MiB, up to 32 inputs at a time.
   - e3 never runs the program or `merge` itself, and never decodes a piece
     whole.

5. **`enrich` and `score` together.** Both are ready once `clean`'s output is
   written to the workspace. Each is planned over `clean`'s manifest, and their
   pieces run side by side, all drawing on the same 16 cores. `clean`'s output
   is stored once, and both read the same segments.

6. **`reconcile`, a join.** It is ready once `enrich` and `score` have both
   finished.
   - Its pieces are cut over its first partitioned input, and the second is
     cut at the same keys. So each piece gets `enrich`'s rows and `score`'s rows
     for the same key range.
   - An input a task does not partition reaches every piece whole, opened
     lazily when it is large, and a change to it re-runs every piece.

7. **Reading the results.** The API and the TUI read a collection a page at a
   time through its manifest, and downloads stream it a segment at a time.

## Re-runs and resumes

A new delivery that differs in a few rows changes only the segments around
them. The pieces over unchanged segments keep their hashes, so their units are
cache hits. Only the changed pieces run, with the merges they feed. `clean`'s
new output shares most of its segments with the old one, so the same holds for
every task downstream.

A run stopped by Ctrl-C, or whose process died, resumes a unit at a time. Each
task's plan says what stage it was in, and the units that finished are in the
cache.

The pieces and merges come from the data and from sizes fixed by the platform,
never from `-j` or from timing. So a task writes the same bytes at any `-j`, on
any runner.

## What runs when

The run's loop decides what is **ready**; the budget decides what **runs**.

- **Ready.** A task is ready when all its inputs are current.
  - A task that splits is planned once it is ready, and its units become ready
    a stage at a time: its pieces, then each level of its merges.
  - A stage waits only for its own task's previous stage.
- **In flight.** The loop keeps up to `-j` things in flight: a task, a task
  being planned, or one unit. When there is room, units of the tasks already
  running go first, in the order those tasks started.
- **Cores.** Every runner process takes a core from the budget before it starts
  and gives it back when it exits: a task, a piece, a merge, a function call, a
  mutation or an index build. Requests are served first come, first served.

Work runs in parallel at three levels:

- **Independent tasks:** `enrich` beside `score`.
- **The units of one stage:** every piece at once, as cores allow.
- **Threads inside one unit:** up to four, for the runner's thread pools,
  chiefly for compressing its output. The program itself runs on one thread.

Some things never overlap. Nothing starts before its inputs are complete. No
merge level starts before the one before it has finished. Nothing starts after
the run is aborted.

`-j` (or `E3_JOBS`) sets the cores, and defaults to the CPUs e3 may use. An
`e3-api-server` has one budget for every run and call it serves. Each CLI
command has its own, so two commands running at once on one machine each take
the full count.

## Records

A task reads a record as it reads any collection. It gets the record's rows,
staged as their manifest and read lazily, and `e3.partition` can split the work
over them.

A record changes through its mutations, which the API or `e3 mutate` runs, not
the dataflow. A mutation is one unit, never split, and takes a core like
anything else. The exception is a `patch` on a record with no index, whose
changes are applied without running anything.

- **`e3.mutation.edit`** reads the state lazily and writes changes by key. Its
  commit rewrites only the segments the changed rows are in, one at a time, so
  touching ten rows of a two-million-row record decodes ten segments.
- **`e3.mutation.patch`** applies changes by key that the caller sends, in the
  same way.
- **`e3.mutation.reduce`** takes the whole state and returns the new one, so the
  state must fit in the runner's memory. For a Dict or Set record only the write
  is limited to what changed. It is the form for a record that is neither.

Commits are compare-and-swap: a mutation whose state changed underneath it runs
again against the new state. An index is built at deploy, or by `e3 reindex`,
as a task split over the record's rows. After that, each commit updates the
record's indexes as part of the same commit.

A commit made during a run behaves like `e3 dataset set` during a run:
- Once its current task finishes, the run sees the change and runs again the
  tasks downstream of the record.
- It never gives a task a mix of old and new inputs.
- An `edit` changes few segments, so the tasks downstream re-run only the pieces
  that hold them.

## Functions

A call of an `e3.function` is one unit, never split, and is not part of the
dataflow. e3 stages the program and its arguments in a scratch directory
inside the repository, starts the runner once it has a core, and returns the
value inline. Nothing is stored (no output, no execution record, no cache), so
every call runs.

Calls are sized for a request and its response:

- **Arguments.** They come in the request.
- **Results.** A result is measured before it is read, and one over the limit is
  refused as `too_large` without being loaded.
  - Through the API the limit is 1 MiB, which leaves room under a cloud
    function's response limit. A call can lower the limit, but not raise it.
  - `e3 call` on a local repository allows 64 MiB.
- **Timeouts.** A call times out after 60 seconds unless it asks for more, up to
  10 minutes, and a call the server answers synchronously is held to the
  server's own deadline.
- **One-shot calls.** A one-shot call runs code the caller sends, and can name a
  dataset as an argument. The server never reads that dataset: the runner gets
  it as a task gets an input, its manifest with the segments linked, and reads
  only what it touches.

Anything larger belongs in a task, whose output is a dataset.

Calls take cores from the same budget as the dataflow, first come first served,
so on a busy server a call waits its turn.

## Memory

- **e3 itself** holds manifests and plans, never a whole collection.
- **A runner** holds one segment at a time of what it streams, the sort buffer
  and its compression threads, plus whatever the program builds.
- **Two things bring a whole collection into a runner's memory:**
  - an `e3.task` that returns one (an `e3.streamTask` emits it instead);
  - using a lazily opened input in any way but a loop or a key lookup, which
    reads it whole once.
- **Admission is by cores alone.** `--memory` (or `E3_MEMORY`) sets the memory
  side of the budget, but no unit reserves memory yet. Choose `-j` so that that
  many units fit in memory at once.
