# Third-Party Notices

This project includes code from third-party open source projects. The following is a list of these projects and their licenses.

---

## random

**Source:** https://github.com/transitive-bullshit/random
**License:** MIT License
**Copyright:** Copyright (c) 2018 Travis Fischer
**Used in:** `/src/random/` directory

The `random` package provides seedable random number generation supporting many different probability distributions. We have vendored portions of this library to provide robust statistical distribution functions.

### MIT License

```
MIT License

Copyright (c) 2018 Travis Fischer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Files Included

The following files are derived from the `random` package:
- `src/random/rng.ts` - Base RNG abstract class
- `src/random/crypto-rng.ts` - Cryptographically secure RNG implementation (modified)
- `src/random/distributions/uniform.ts` - Uniform distribution
- `src/random/distributions/uniform-int.ts` - Uniform integer distribution (modified)
- `src/random/distributions/normal.ts` - Normal/Gaussian distribution
- `src/random/distributions/exponential.ts` - Exponential distribution (modified)
- `src/random/distributions/bernoulli.ts` - Bernoulli distribution (modified)
- `src/random/distributions/binomial.ts` - Binomial distribution (modified)
- `src/random/distributions/geometric.ts` - Geometric distribution (modified)
- `src/random/distributions/poisson.ts` - Poisson distribution (modified)
- `src/random/distributions/pareto.ts` - Pareto distribution (modified)
- `src/random/distributions/log-normal.ts` - Log-normal distribution
- `src/random/distributions/irwin-hall.ts` - Irwin-Hall distribution (modified)
- `src/random/distributions/bates.ts` - Bates distribution (modified)

### Modifications

The vendored code has been modified from the original:
1. Converted to TypeScript with explicit type annotations
2. Removed dependency on seedable RNG (using crypto RNG instead)
3. Removed validation utility dependency (inlined validation)
4. Changed integer functions to accept `bigint` instead of `number`
5. Added Elara AI copyright headers
6. Updated imports to match our project structure

All modifications are released under the same terms as the rest of this project (AGPL-3.0 or commercial license).

---

## Compliance Statement

The inclusion of MIT-licensed code in this AGPL-3.0 licensed project is permitted as the MIT License is compatible with AGPL-3.0. The MIT License allows use, modification, and distribution, including in projects under different licenses, provided the MIT license and copyright notice are preserved.

All vendored code files include headers indicating their origin and original license. The full MIT license text above satisfies the attribution requirements.
