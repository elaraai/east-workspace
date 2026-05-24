# e3-fuzz (Virtual Idiot)

Internal — not published.

Fuzz harness that generates pseudo-random e3 operations and exercises the
system end-to-end. Used to surface concurrency bugs, version-vector edge
cases, and orchestrator state-machine issues.

## Run

From `libs/e3/`:

```bash
make fuzz          # 100 iterations
make fuzz-quick    # smaller run for CI
make fuzz-stress   # extended stress run
```

## See also

- [Parent lib README](../../README.md)
- [Parent lib CLAUDE.md](../../CLAUDE.md)
- [`design/e3-fuzz.md`](../../design/e3-fuzz.md) — fuzz design spec
