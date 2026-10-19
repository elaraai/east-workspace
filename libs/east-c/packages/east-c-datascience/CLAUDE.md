# east-c-datascience

east-py-datascience's platform functions on the C runtime (OR-Tools, XGBoost),
one family at a time and whole, under east-py-datascience's own compliance
suites. C++17 over east-c's C API; built with `-DEAST_C_DATASCIENCE=ON`.

## Commands

```bash
make fetch-ortools                            # once: the pinned OR-Tools release
make build EAST_C_DATASCIENCE=ON              # from libs/east-c
make test-east-c-datascience                  # the GoogleOr and XGBoost suites (export them first)
```

## Rules

- **A family moves whole.** Every function of east-py-datascience's family,
  with its names, types and semantics — `google_or_linear_solve` picks the
  backend by the same ids, `xgboost_train_classifier` hands the library the
  parameters the sklearn wrapper hands it. A new family lands with its suite
  in `DATASCIENCE_SUITES` (`../../Makefile`) and nothing of it left behind.
- **The python runner is the reference.** Mirror its order of checks and its
  messages where a spec pins them (`expect_case`, the shape and categorical
  errors), and its quirks where a result depends on them (hints collapsed to
  the last value, a quantile trained twice kept once).
- **Results are built in the declared type.** A body gets the call's
  `output_type`; `StructBuilder`, `variant`, `some`/`none`, `dict` and `array`
  in `src/value_util.h` take their types from it. Never hand-build an East
  type here.
- **A blob both runners read.** The XGBoost blob is the library's UBJSON
  model (classes in the `east_classes` attribute; quantiles in the
  `E3XGBQ01` container). Its python twin is
  `east_py_datascience/xgboost/_blob.py`; change both together, and regenerate
  `test/fixtures/xgboost_interchange.json` (its script says how).
- **Nothing downloads at build time.** XGBoost's archive is checked in under
  `third_party/` with its SHA-256; OR-Tools comes from an install the fetch
  script pins. Match `libs/east-py/uv.lock`'s versions, so a blob written at
  one is read at the other.

## See also

- [`README.md`](README.md) — build, tests, layout.
- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview and `make` targets.
- [`../east-c-std/CLAUDE.md`](../east-c-std/CLAUDE.md) — the C platform
  package this one follows.
