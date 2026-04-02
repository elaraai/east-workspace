# East Data Science

> Data science and ML platform functions for the East language

[![TypeScript: AGPL-3.0](https://img.shields.io/badge/TypeScript-AGPL--3.0-blue.svg)](LICENSE.md)
[![Python: BSL 1.1](https://img.shields.io/badge/Python-BSL%201.1-orange.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Data Science** provides machine learning and optimization platform functions for the [East language](https://github.com/elaraai/East).

## Installation

```bash
npm install @elaraai/east-py-datascience @elaraai/east
```

### Python Optional Dependencies

Each module has its own optional Python dependencies to avoid installing unnecessary packages. Install only the extras you need:

```bash
# Single extra
pip install "east-py-datascience[scipy]"

# Multiple extras
pip install "east-py-datascience[scipy,sklearn,xgboost]"

# All extras
pip install "east-py-datascience[all]"
```

When using a git dependency in `pyproject.toml`:
```toml
"east-py-datascience[scipy] @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-datascience"
```

| Module | Extra | Python Packages |
|--------|-------|-----------------|
| **MADS** | `mads` | PyNomadBBO |
| **Optuna** | `optuna` | optuna |
| **SimAnneal** | `simanneal` | simanneal |
| **Scipy** | `scipy` | scipy, cloudpickle |
| **Optimization** | *(none)* | *(core only — numpy)* |
| **GoogleOr** | `google-or` | ortools |
| **Sklearn** | `sklearn` | scikit-learn, skl2onnx, onnxruntime, cloudpickle |
| **XGBoost** | `xgboost` | xgboost, cloudpickle |
| **LightGBM** | `lightgbm` | lightgbm, cloudpickle |
| **NGBoost** | `ngboost` | ngboost, cloudpickle |
| **Torch** | `torch` | torch, cloudpickle |
| **GP** | `gp` | scikit-learn, cloudpickle |
| **Lightning** | `lightning` | torch, pytorch-lightning, cloudpickle |
| **Shap** | `shap` | shap, cloudpickle |
| **MAPIE** | `mapie` | mapie, cloudpickle |
| **ALNS** | `alns` | alns |
| **PyMC** | `pymc` | pymc, cloudpickle |
| **Simulation** | *(none)* | *(core only — numpy)* |

## Quick Start

```typescript
import { East, FloatType, variant } from "@elaraai/east";
import { MADS } from "@elaraai/east-py-datascience";

// Define objective function: minimize sum of squares
const objective = East.function([MADS.Types.VectorType], FloatType, ($, x) => {
    const x0 = $.let(x.get(0n));
    const x1 = $.let(x.get(1n));
    return $.return(x0.multiply(x0).add(x1.multiply(x1)));
});

// Optimize
const optimize = East.function([], MADS.Types.ResultType, $ => {
    const x0 = $.let([0.5, 0.5]);
    const bounds = $.let({
        lower: [-1.0, -1.0],
        upper: [1.0, 1.0],
    });
    const config = $.let({
        max_bb_eval: variant('some', 100n),
        display_degree: variant('some', 0n),
        direction_type: variant('none', null),
        initial_mesh_size: variant('none', null),
        min_mesh_size: variant('none', null),
        seed: variant('some', 42n),
    });

    return $.return(MADS.optimize(objective, x0, bounds, variant('none', null), config));
});
```

## Modules

### Optimization

| Module | Description | Use Cases |
|--------|-------------|-----------|
| **MADS** | Derivative-free blackbox optimization using NOMAD algorithm | Functions without derivatives, expensive evaluations, noisy/discontinuous objectives |
| **Optuna** | Bayesian optimization with TPE sampler | Hyperparameter tuning, mixed-type parameters, efficient search with few evaluations |
| **SimAnneal** | Simulated annealing for discrete optimization | TSP, scheduling, subset selection, knapsack, assignment problems |
| **Scipy** | Scientific optimization and curve fitting | Gradient-based minimization, curve fitting, interpolation, statistics |
| **Optimization** | Iterative coordinate descent optimization | Parameter tuning, sequential optimization across parameter groups |
| **GoogleOr** | Google OR-Tools constraint programming, routing, LP, and graph algorithms | CP-SAT, vehicle routing (TSP/VRP), linear/mixed-integer programming, min-cost flow, max flow, assignment |

### Machine Learning

| Module | Description | Use Cases |
|--------|-------------|-----------|
| **Sklearn** | Core ML utilities from scikit-learn | N-way splits, preprocessing (Standard/MinMax/RobustScaler), encoding (Label/Ordinal), metrics, GMM clustering, multi-target regression |
| **XGBoost** | Gradient boosting with XGBoost | Regression, classification, feature importance, fast training |
| **LightGBM** | Fast gradient boosting with leaf-wise growth | Large datasets, high cardinality features, faster than XGBoost on big data |
| **NGBoost** | Natural gradient boosting with uncertainty | Probabilistic predictions, confidence intervals, uncertainty quantification |
| **Torch** | Neural networks with PyTorch | MLP regression/classification, deep learning, custom architectures |
| **Lightning** | PyTorch Lightning neural networks | MLP, autoencoder, conv1d, sequential, transformer architectures |
| **GP** | Gaussian Process regression | Small datasets, uncertainty quantification, Bayesian optimization surrogate |
| **MAPIE** | Conformal prediction intervals | Prediction intervals, prediction sets, uncertainty quantification |

### Bayesian Inference

| Module | Description | Use Cases |
|--------|-------------|-----------|
| **PyMC** | Bayesian inference with PyMC | Bayesian linear regression, hierarchical models, multi-layer joint estimation, posterior analysis |

### Simulation

| Module | Description | Use Cases |
|--------|-------------|-----------|
| **Simulation** | Economic ontology simulation via DES | Simulating economic resources, events, and processes; single deterministic runs, Monte Carlo trajectories |

### Explainability

| Module | Description | Use Cases |
|--------|-------------|-----------|
| **Shap** | SHAP values for model interpretation | Feature importance, model explanations, debugging predictions |

## Documentation

See [USAGE.md](./USAGE.md) for detailed API reference with examples.

## Development

```bash
npm run build     # Compile TypeScript
npm run test      # Run test suite
npm run lint      # Check code quality
```

## License

This package has different licenses for TypeScript and Python code:

**TypeScript (type definitions):** Dual AGPL-3.0 / Commercial
- Open source use: [AGPL-3.0](LICENSE.md)
- Commercial use: Available for proprietary use - contact support@elara.ai

**Python (runtime implementations):** BSL 1.1 (Business Source License)
- Non-production use (evaluation, testing, development) is free
- Production use by or on behalf of for-profit entities requires a commercial license
- Code becomes AGPL-3.0 four years after each release

See [LICENSE.md](LICENSE.md) for full details.

**Commercial licensing:** support@elara.ai

### Ecosystem

- **[East Node](https://github.com/elaraai/east-node)**: Node.js platform functions for I/O, databases, and system operations. Connect East programs to filesystems, SQL/NoSQL databases, cloud storage, and network services.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Filesystem, console, HTTP fetch, crypto, random distributions, timestamps
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, S3, FTP, SFTP
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Python](https://github.com/elaraai/east-py)**: Python runtime and platform functions for data science and machine learning. Execute East programs with access to optimization solvers, gradient boosting, neural networks, and model explainability.
  - [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience): TypeScript types for optimization, gradient boosting, neural networks, explainability

- **[East UI](https://github.com/elaraai/east-ui)**: East types and expressions for building dashboards and interactive layouts. Define UIs as data structures that render consistently across React, web, and other environments.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI styling

- **[e3 - East Execution Engine](https://github.com/elaraai/e3)**: Durable execution engine for running East pipelines at scale. Features Git-like content-addressable storage, automatic memoization, task queuing, and real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Git-like object store, task queue, result caching
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 init`, `e3 run`, `e3 logs` commands for managing and monitoring tasks
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 servers
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/East](https://github.com/elaraai/East)
- **Issues**: [https://github.com/elaraai/east-py/issues](https://github.com/elaraai/east-py/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
