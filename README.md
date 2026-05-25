# East Workspace

East turns a business's data and logic into **decisions** — and the evidence behind them. It is the computational layer of [Elara](https://elaraai.com/): a typed, declarative model of how a business creates value and what drives it, from which the rest of the platform reads, reasons, and recommends.

The point isn't to automate judgment away. It's to put defensible evidence in front of the people who hold it — the model as a colleague, not an oracle.

<p align="center">
  <img src="docs/east-architecture.png" width="640" alt="Elara — a decision platform. Business users observe, decide, configure, and trust on top; underneath, the platform's surfaces (render a UI, or ask an agent) sit over a shared economic ontology (objectives, processes, resources, decisions, KPIs, policies, and data), an integrate / reason / compute engine, and East — typed TypeScript that compiles to one portable IR running unchanged on TypeScript, Python, and native C — built and evolved by engineers and coding agents with the e3 CLI, east-diagnostics, and the east Claude Code plugin.">
</p>

You write it as typed TypeScript — no new language or syntax — and the same code runs across runtimes:

- **One portable IR.** East compiles to a single IR that runs on TypeScript, Python, and C. Data *and* functions serialize across all three, so logic isn't tied to one runtime.
- **Typed platform modules.** Databases, files and object storage, optimization, machine learning, Bayesian inference, simulation, and UI — typed, and composed rather than wired together with glue scripts.
- **Durable execution.** e3 runs dataflow content-addressed and memoized: it reruns only what changed and keeps a replayable audit trail.
- **Works for agents and people.** Indexed examples and DSL-level linting catch errors at the language level, whether the code is written by a person or an agent.

## Grounded in how the business actually works

Everything starts from an **economic ontology** — a typed graph of the business itself: its objectives, processes, resources and decisions, the KPIs that measure them and the policies that constrain them, wired together by what *drives*, *produces*, *constrains*, and *measures* what. That shared model is what lets integrations, forecasts, optimizations, and simulations reason about the *same* world instead of each guessing at it.

You write it once, as typed TypeScript — no new language, no new syntax. East compiles to a portable IR that runs anywhere — TypeScript, Python, or native C — so a single model spans the whole decision pipeline:

- **Integrate** — pull from SQL / NoSQL databases, object storage, files, and APIs.
- **Reason** — optimization, gradient boosting, neural nets, Bayesian inference, and discrete-event simulation over the ontology.
- **Execute** — durable, reproducible, content-addressed dataflow that re-runs only what changed.
- **Decide** — typed decision surfaces where every number carries its run, inputs, sources, assumptions, and freshness.

## Declarative end to end

Every layer — integrations, models, pipelines, interfaces — is declarative, type-safe East code, which keeps a lot of the usual glue out of the picture.

The same explicitness helps agents author it: the [Claude Code plugin](#claude-code-plugin) ships East skills, indexed examples, and DSL-level linting that catches mistakes at the language level before they run. People and agents build the same way, against the same checks.

## Decisions, not dashboards

A surface exists to commit one kind of decision. The platform is built around the loop an operator actually runs:

- **Observe** — narrow into the situation and see the evidence, not a wall of charts.
- **Decide** — commit the decision with its alternatives, reasoning, and stakes recorded, and an override always available. The model recommends; it doesn't decide for you.
- **Configure** — adjust the objectives, policies, and assumptions behind the recommendation.
- **Trust** — every output carries its provenance (run, inputs, sources, assumptions, freshness), and every decision lands in an audit trail you can revisit.

Numbers beat adjectives; operator-grade density over decoration.

## Libraries

The pieces above, with links to the code — one row per lib, packages inside:

| Library | What's inside |
|---|---|
| [`east`](libs/east) | The language + portable IR |
| [`east-node`](libs/east-node) | Node.js runtime — [`std`](libs/east-node/packages/east-node-std), [`io`](libs/east-node/packages/east-node-io), [`cli`](libs/east-node/packages/east-node-cli) |
| [`east-c`](libs/east-c) | Native C runtime — `std`, `cli` |
| [`east-py`](libs/east-py) | Python runtime — [`std`](libs/east-py/packages/east-py-std), [`io`](libs/east-py/packages/east-py-io), [`cli`](libs/east-py/packages/east-py-cli), [`data-science`](libs/east-py/packages/east-py-datascience) |
| [`e3`](libs/e3) | Durable execution engine — [`cli`](libs/e3/packages/e3-cli), [`api-server`](libs/e3/packages/e3-api-server), [`api-client`](libs/e3/packages/e3-api-client) |
| [`east-ui`](libs/east-ui) | Typed UI — [`east-ui`](libs/east-ui/packages/east-ui), [`e3-ui`](libs/east-ui/packages/e3-ui), [`extension`](libs/east-ui/packages/east-ui-extension) |
| [`create`](libs/create) | Project scaffolding — `npm create @elaraai/east`, `npm create @elaraai/e3` |
| [`east-claude-plugin`](libs/east-claude-plugin) | Claude Code plugin — skills, examples, diagnostics |
| [`east-diagnostics`](libs/east-diagnostics) | East-aware linting — editor, agent, CI (+ [`eslint-plugin-east`](libs/eslint-plugin-east)) |

Each library has its own `README.md` with installation, a quick start, and reference.

## Create a project

One command, cross-platform (Node 22+; e3 also uses Python via [uv](https://docs.astral.sh/uv/)):

```bash
npm create @elaraai/e3 my-solution     # BSL-1.1 · Node + Python · durable execution
npm create @elaraai/east my-lib        # AGPL-3.0 · Node-only
```

Generated projects drive everything through npm scripts — `npm run setup`, `build`, `test`, and (e3) `start` / `watch`. Pass `.` to scaffold in place, or `-- --install` to install while scaffolding. See [`libs/create`](libs/create).

## Develop

```bash
make install   # one-shot setup (pnpm + uv + cmake)
make build     # build all TypeScript packages
make test      # run all tests
make lint      # lint everything
```

See [`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md) for the full target list. The monorepo ships under one unified version via the manual `Release` workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml)) — npm, PyPI, the VS Code extension, and native C binaries in a single run.

## Claude Code plugin

East ships a [Claude Code](https://claude.com/claude-code) plugin — language skills, search across thousands of indexed examples, and preemptive East diagnostics:

```text
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

## License

Multiple licenses — see the root [`LICENSE.md`](LICENSE.md) for the summary and precedence, and each lib's `LICENSE.md` for full terms. In short: user-facing surfaces (`east`, `east-node`, `east-ui`, the e3 SDK) are dual **AGPL-3.0 / Commercial**; runtime and server components (`east-c`, `east-py`, the e3 server stack) are **BSL 1.1**. Commercial licensing: support@elara.ai.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md). Contributors sign the CLA so we can offer commercial licenses while keeping the project open source.

<!-- Ecosystem — keep in sync with docs/snippets/ECOSYSTEM.md -->

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Tarballed for `linux-x64` and `linux-arm64`, attached to each GitHub Release.
  - `east-c`: Core runtime — type system, IR interpreter, 200+ builtins, serialization (Beast2, JSON, CSV, East text)
  - `east-c-std`: Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - `east-c-cli`: CLI for running East IR programs natively

- **[East Python](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)**: Python runtime, standard platform, I/O, and data-science platform functions. Published to PyPI.
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, IR compiler, 212+ builtins, Cython-accelerated hot paths
  - [east-py-std](https://pypi.org/project/east-py-std/): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [east-py-io](https://pypi.org/project/east-py-io/): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [east-py-cli](https://pypi.org/project/east-py-cli/): CLI for running East IR programs in Python
  - [east-py-datascience](https://pypi.org/project/east-py-datascience/) (PyPI) + [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience) (npm): Optimization (MADS, Optuna, ALNS, GoogleOR), ML (XGBoost, LightGBM, NGBoost, PyTorch, Lightning, GP), Bayesian inference (PyMC), explainability (SHAP), conformal prediction (MAPIE)

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- **Website**: https://elaraai.com/
- **Repository**: https://github.com/elaraai/east-workspace
- **Issues**: https://github.com/elaraai/east-workspace/issues
- **Email**: support@elara.ai

<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
