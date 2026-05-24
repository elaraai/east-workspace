# e3 fuzz tests (Virtual Idiot)

Fuzz harness that generates pseudo-random e3 operations and exercises
the system end-to-end. Used to surface concurrency bugs, version-vector
edge cases, and orchestrator state-machine issues.

Run from the lib root:

```bash
make fuzz          # 100 iterations
make fuzz-quick    # smaller run for CI
make fuzz-stress   # extended stress run
```

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview.
- [`../../design/e3-fuzz.md`](../../design/e3-fuzz.md) — fuzz design
  spec.
