#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Random number generation platform functions for East.

Provides random number generation for East programs running in Python.
Supports both cryptographically secure random (default) and seedable PRNG
for reproducible simulations.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.
"""

import math
import secrets
import time
from abc import ABC, abstractmethod

from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, IntegerType, NullType


class RNG(ABC):
    """Abstract base class for random number generators."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Name of this RNG implementation."""
        pass

    @abstractmethod
    def next(self) -> float:
        """Generate a random float in [0.0, 1.0)."""
        pass

    @abstractmethod
    def seed(self, seed_value: int) -> None:
        """Seed the RNG for reproducible sequences."""
        pass


class CryptoRNG(RNG):
    """Cryptographically secure RNG using Python's secrets module.

    Uses OS-provided entropy source. Cannot be seeded.
    """

    @property
    def name(self) -> str:
        return "crypto"

    def next(self) -> float:
        """Generate a random float in [0.0, 1.0) using secrets.randbelow."""
        return secrets.randbelow(2**53) / (2**53)

    def seed(self, seed_value: int) -> None:
        """No-op: crypto RNG uses OS entropy source and cannot be seeded."""
        pass


class XorShift128RNG(RNG):
    """Seedable RNG using XorShift128+ algorithm.

    Fast, high-quality PRNG suitable for simulations.
    Period: 2^128 - 1

    Uses same algorithm as TypeScript implementation for cross-platform
    reproducibility with the same seed.
    """

    def __init__(self, seed_value: int | None = None):
        self._state0: int = 0
        self._state1: int = 0
        if seed_value is not None:
            self.seed(seed_value)
        else:
            # Default seed based on current time
            self.seed(int(time.time() * 1000))

    @property
    def name(self) -> str:
        return "xorshift128+"

    def next(self) -> float:
        """Generate a random float in [0.0, 1.0) using XorShift128+."""
        # XorShift128+ algorithm
        s1 = self._state0
        s0 = self._state1
        result = (s0 + s1) & 0xFFFFFFFFFFFFFFFF  # 64-bit wrap

        self._state0 = s0
        s1 ^= (s1 << 23) & 0xFFFFFFFFFFFFFFFF
        self._state1 = (s1 ^ s0 ^ (s1 >> 17) ^ (s0 >> 26)) & 0xFFFFFFFFFFFFFFFF

        # Convert to [0, 1) range using upper 53 bits
        upper53 = (result >> 11) & ((1 << 53) - 1)
        return upper53 / (2**53)

    def seed(self, seed_value: int) -> None:
        """Seed the RNG for reproducible sequences."""
        # Initialize state using splitmix64 for good initial state
        self._state0 = self._splitmix64(seed_value & 0xFFFFFFFFFFFFFFFF)
        self._state1 = self._splitmix64(self._state0)

        # Ensure state is never all zeros
        if self._state0 == 0 and self._state1 == 0:
            self._state0 = 1

    def _splitmix64(self, x: int) -> int:
        """SplitMix64 for state initialization."""
        x = (x + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
        x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
        x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
        return (x ^ (x >> 31)) & 0xFFFFFFFFFFFFFFFF


# Global RNG instance - starts with crypto for security
_global_rng: RNG = CryptoRNG()


def _get_rng() -> RNG:
    """Get the current global RNG instance."""
    return _global_rng


def _set_rng(rng: RNG) -> None:
    """Set the global RNG instance."""
    global _global_rng
    _global_rng = rng


def _reset_to_crypto() -> None:
    """Reset to cryptographic RNG (for testing)."""
    global _global_rng
    _global_rng = CryptoRNG()


@platform_function(name="random_uniform", inputs=[], output=FloatType)
def random_uniform_impl() -> float:
    """Sample a uniform random float from ``[0.0, 1.0)``.

    Returns:
        ``Float`` (``float``) - uniformly distributed value in ``[0.0, 1.0)``.
    """
    return _get_rng().next()


@platform_function(name="random_normal", inputs=[], output=FloatType)
def random_normal_impl() -> float:
    """Sample a random float from the standard normal distribution N(0, 1).

    Uses the Marsaglia polar method (Box-Muller transform).

    Returns:
        ``Float`` (``float``) - variate drawn from N(0, 1).
    """
    rng = _get_rng()
    # Marsaglia polar method
    while True:
        u = 2.0 * rng.next() - 1.0
        v = 2.0 * rng.next() - 1.0
        s = u * u + v * v
        if 0 < s < 1:
            return u * math.sqrt(-2.0 * math.log(s) / s)


@platform_function(
    name="random_range", inputs=[IntegerType, IntegerType], output=IntegerType
)
def random_range_impl(min_val: int, max_val: int) -> int:
    """Sample a uniformly distributed random integer from the closed interval ``[min, max]``.

    Args:
        min_val: ``Integer`` (``int``) - inclusive lower bound.
        max_val: ``Integer`` (``int``) - inclusive upper bound.

    Returns:
        ``Integer`` (``int``) - random integer in ``[min_val, max_val]``.

    Raises:
        ValueError: If ``min_val > max_val``.
    """
    if min_val > max_val:
        raise ValueError("Invalid range")
    range_size = max_val - min_val + 1
    return int(_get_rng().next() * range_size) + min_val


@platform_function(name="random_exponential", inputs=[FloatType], output=FloatType)
def random_exponential_impl(lambda_rate: float) -> float:
    """Sample a random float from an exponential distribution with rate lambda.

    Args:
        lambda_rate: ``Float`` (``float``) - rate parameter lambda; mean of
            the distribution is ``1 / lambda_rate``.

    Returns:
        ``Float`` (``float``) - non-negative variate drawn from
        Exponential(lambda).

    Raises:
        ValueError: If ``lambda_rate <= 0``.
    """
    if lambda_rate <= 0:
        raise ValueError(f"Lambda rate must be positive, got {lambda_rate}")
    u = _get_rng().next()
    # Avoid log(0) by using 1-u instead of u
    return -math.log(1.0 - u) / lambda_rate


@platform_function(name="random_weibull", inputs=[FloatType], output=FloatType)
def random_weibull_impl(shape_k: float) -> float:
    """Sample a random float from a Weibull distribution with scale 1.

    Args:
        shape_k: ``Float`` (``float``) - shape parameter k; must be positive.

    Returns:
        ``Float`` (``float``) - variate drawn from Weibull(k, scale=1).

    Raises:
        ValueError: If ``shape_k <= 0``.
    """
    if shape_k <= 0:
        raise ValueError(f"Shape parameter must be positive, got {shape_k}")
    u = _get_rng().next()
    return math.pow(-math.log(1.0 - u), 1.0 / shape_k)


@platform_function(name="random_bernoulli", inputs=[FloatType], output=IntegerType)
def random_bernoulli_impl(p: float) -> int:
    """Perform a single Bernoulli trial with success probability p.

    Args:
        p: ``Float`` (``float``) - success probability in ``[0, 1]``.

    Returns:
        ``Integer`` (``int``) - ``1`` with probability ``p``, ``0`` with
        probability ``1 - p``.

    Raises:
        ValueError: If ``p`` is not in ``[0, 1]``.
    """
    if not 0 <= p <= 1:
        raise ValueError(f"Probability must be in [0, 1], got {p}")
    return 1 if _get_rng().next() < p else 0


@platform_function(
    name="random_binomial", inputs=[IntegerType, FloatType], output=IntegerType
)
def random_binomial_impl(n: int, p: float) -> int:
    """Sample the number of successes in n independent Bernoulli trials.

    Args:
        n: ``Integer`` (``int``) - number of trials; must be non-negative.
        p: ``Float`` (``float``) - success probability per trial in ``[0, 1]``.

    Returns:
        ``Integer`` (``int``) - number of successes in ``[0, n]``.

    Raises:
        ValueError: If ``n < 0`` or ``p`` is not in ``[0, 1]``.
    """
    if n < 0:
        raise ValueError(f"Number of trials must be non-negative, got {n}")
    if not 0 <= p <= 1:
        raise ValueError(f"Probability must be in [0, 1], got {p}")

    rng = _get_rng()
    count = 0
    for _ in range(n):
        if rng.next() < p:
            count += 1
    return count


@platform_function(name="random_geometric", inputs=[FloatType], output=IntegerType)
def random_geometric_impl(p: float) -> int:
    """Sample the number of trials until the first success in a Bernoulli process.

    Args:
        p: ``Float`` (``float``) - success probability per trial in ``(0, 1]``.

    Returns:
        ``Integer`` (``int``) - number of trials (>= 1) until first success.

    Raises:
        ValueError: If ``p`` is not in ``(0, 1]``.
    """
    if not 0 < p <= 1:
        raise ValueError(f"Probability must be in (0, 1], got {p}")
    u = _get_rng().next()
    return int(math.ceil(math.log(1.0 - u) / math.log(1.0 - p)))


@platform_function(name="random_poisson", inputs=[FloatType], output=IntegerType)
def random_poisson_impl(lambda_rate: float) -> int:
    """Sample the number of events from a Poisson process with rate lambda.

    Uses the Knuth algorithm for small lambda and a normal approximation for
    large lambda (>= 30).

    Args:
        lambda_rate: ``Float`` (``float``) - mean number of events per
            interval; must be non-negative.

    Returns:
        ``Integer`` (``int``) - non-negative event count drawn from
        Poisson(lambda).

    Raises:
        ValueError: If ``lambda_rate < 0``.
    """
    if lambda_rate < 0:
        raise ValueError(f"Lambda rate must be non-negative, got {lambda_rate}")

    # Special case: lambda=0 always returns 0
    if lambda_rate == 0:
        return 0

    rng = _get_rng()

    # Knuth algorithm for small lambda
    if lambda_rate < 30:
        limit_l = math.exp(-lambda_rate)
        k = 0
        p = 1.0
        while p > limit_l:
            k += 1
            p *= rng.next()
        return k - 1
    else:
        # For large lambda, use normal approximation
        # Generate normal using Marsaglia polar method inline
        while True:
            u = 2.0 * rng.next() - 1.0
            v = 2.0 * rng.next() - 1.0
            s = u * u + v * v
            if 0 < s < 1:
                z = u * math.sqrt(-2.0 * math.log(s) / s)
                break
        return max(0, int(z * math.sqrt(lambda_rate) + lambda_rate))


@platform_function(name="random_pareto", inputs=[FloatType], output=FloatType)
def random_pareto_impl(alpha: float) -> float:
    """Sample a random float from a Pareto distribution with scale 1.

    Args:
        alpha: ``Float`` (``float``) - shape parameter alpha; must be
            positive.

    Returns:
        ``Float`` (``float``) - variate drawn from Pareto(alpha, scale=1);
        always >= 1.0.

    Raises:
        ValueError: If ``alpha <= 0``.
    """
    if alpha <= 0:
        raise ValueError(f"Alpha must be positive, got {alpha}")
    u = _get_rng().next()
    return math.pow(1.0 - u, -1.0 / alpha)


@platform_function(
    name="random_log_normal", inputs=[FloatType, FloatType], output=FloatType
)
def random_log_normal_impl(mu: float, sigma: float) -> float:
    """Sample a random float from a log-normal distribution.

    Args:
        mu: ``Float`` (``float``) - mean of the underlying normal distribution
            (log-space mean).
        sigma: ``Float`` (``float``) - standard deviation of the underlying
            normal distribution (log-space std); must be positive.

    Returns:
        ``Float`` (``float``) - strictly positive variate drawn from
        LogNormal(mu, sigma).

    Raises:
        ValueError: If ``sigma <= 0``.
    """
    if sigma <= 0:
        raise ValueError(f"Sigma must be positive, got {sigma}")
    z = random_normal_impl()
    return math.exp(mu + sigma * z)


@platform_function(name="random_irwin_hall", inputs=[IntegerType], output=FloatType)
def random_irwin_hall_impl(n: int) -> float:
    """Sample the sum of n independent Uniform(0, 1) random variables.

    Args:
        n: ``Integer`` (``int``) - number of variables to sum; must be
            positive.

    Returns:
        ``Float`` (``float``) - sum in the range ``[0, n]``.

    Raises:
        ValueError: If ``n <= 0``.
    """
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    rng = _get_rng()
    return sum(rng.next() for _ in range(n))


@platform_function(name="random_bates", inputs=[IntegerType], output=FloatType)
def random_bates_impl(n: int) -> float:
    """Sample the mean of n independent Uniform(0, 1) random variables.

    Args:
        n: ``Integer`` (``int``) - number of variables to average; must be
            positive.

    Returns:
        ``Float`` (``float``) - mean in the range ``[0, 1]``.

    Raises:
        ValueError: If ``n <= 0``.
    """
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    return random_irwin_hall_impl(n) / n


@platform_function(name="random_seed", inputs=[IntegerType], output=NullType)
def random_seed_impl(seed: int) -> None:
    """Seed the random number generator for reproducible sequences.

    Switches the global RNG from the cryptographically secure default to a
    deterministic XorShift128+ PRNG. Uses the same algorithm as the
    TypeScript implementation so sequences are reproducible across platforms
    with the same seed. Do not call this when cryptographic security is
    required.

    Args:
        seed: ``Integer`` (``int``) - seed value.
    """
    _set_rng(XorShift128RNG(seed))


# Collected from the @platform_function decorations above.
random_impl = platform_functions(__name__)


__all__ = [
    "random_impl",
    "random_uniform_impl",
    "random_normal_impl",
    "random_range_impl",
    "random_exponential_impl",
    "random_weibull_impl",
    "random_bernoulli_impl",
    "random_binomial_impl",
    "random_geometric_impl",
    "random_poisson_impl",
    "random_pareto_impl",
    "random_log_normal_impl",
    "random_irwin_hall_impl",
    "random_bates_impl",
    "random_seed_impl",
]
