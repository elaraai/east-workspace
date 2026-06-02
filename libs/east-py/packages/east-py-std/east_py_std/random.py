#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Random number generation platform functions for East.

Provides random number generation for East programs running in Python.
Supports both cryptographically secure random (default) and seedable PRNG
for reproducible simulations.
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


# For testing - allow resetting to crypto RNG
def _reset_to_crypto() -> None:
    """Reset to cryptographic RNG (for testing)."""
    global _global_rng
    _global_rng = CryptoRNG()


@platform_function(name="random_uniform", inputs=[], output=FloatType)
def random_uniform_impl() -> float:
    """Generate uniform random float in [0.0, 1.0).

    Returns:
        Random float in range [0.0, 1.0)
    """
    return _get_rng().next()


@platform_function(name="random_normal", inputs=[], output=FloatType)
def random_normal_impl() -> float:
    """Generate random float from standard normal distribution.

    Uses Marsaglia polar method for Box-Muller transform.

    Returns:
        Random float from N(0, 1) distribution
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
    """Generate uniformly distributed random integer in [min, max].

    Args:
        min_val: Minimum value (inclusive)
        max_val: Maximum value (inclusive)

    Returns:
        Random integer in range [min, max]

    Raises:
        ValueError: If min > max
    """
    if min_val > max_val:
        raise ValueError("Invalid range")
    range_size = max_val - min_val + 1
    return int(_get_rng().next() * range_size) + min_val


@platform_function(name="random_exponential", inputs=[FloatType], output=FloatType)
def random_exponential_impl(lambda_rate: float) -> float:
    """Generate random float from exponential distribution.

    Args:
        lambda_rate: Rate parameter (mean = 1/λ)

    Returns:
        Random float from exponential distribution

    Raises:
        ValueError: If lambda_rate <= 0
    """
    if lambda_rate <= 0:
        raise ValueError(f"Lambda rate must be positive, got {lambda_rate}")
    u = _get_rng().next()
    # Avoid log(0) by using 1-u instead of u
    return -math.log(1.0 - u) / lambda_rate


@platform_function(name="random_weibull", inputs=[FloatType], output=FloatType)
def random_weibull_impl(shape_k: float) -> float:
    """Generate random float from Weibull distribution.

    Args:
        shape_k: Shape parameter k

    Returns:
        Random float from Weibull(k, 1) distribution

    Raises:
        ValueError: If shape_k <= 0
    """
    if shape_k <= 0:
        raise ValueError(f"Shape parameter must be positive, got {shape_k}")
    u = _get_rng().next()
    return math.pow(-math.log(1.0 - u), 1.0 / shape_k)


@platform_function(name="random_bernoulli", inputs=[FloatType], output=IntegerType)
def random_bernoulli_impl(p: float) -> int:
    """Generate binary random outcome (Bernoulli trial).

    Args:
        p: Success probability [0, 1]

    Returns:
        1 with probability p, 0 with probability (1-p)

    Raises:
        ValueError: If p not in [0, 1]
    """
    if not 0 <= p <= 1:
        raise ValueError(f"Probability must be in [0, 1], got {p}")
    return 1 if _get_rng().next() < p else 0


@platform_function(
    name="random_binomial", inputs=[IntegerType, FloatType], output=IntegerType
)
def random_binomial_impl(n: int, p: float) -> int:
    """Generate number of successes in n Bernoulli trials.

    Args:
        n: Number of trials
        p: Success probability [0, 1]

    Returns:
        Number of successes

    Raises:
        ValueError: If n < 0 or p not in [0, 1]
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
    """Generate number of trials until first success.

    Args:
        p: Success probability (0, 1]

    Returns:
        Number of trials until first success

    Raises:
        ValueError: If p not in (0, 1]
    """
    if not 0 < p <= 1:
        raise ValueError(f"Probability must be in (0, 1], got {p}")
    u = _get_rng().next()
    return int(math.ceil(math.log(1.0 - u) / math.log(1.0 - p)))


@platform_function(name="random_poisson", inputs=[FloatType], output=IntegerType)
def random_poisson_impl(lambda_rate: float) -> int:
    """Generate number of events from Poisson process.

    Args:
        lambda_rate: Rate parameter (mean number of events)

    Returns:
        Number of events

    Raises:
        ValueError: If lambda_rate < 0
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
    """Generate random float from Pareto distribution.

    Args:
        alpha: Shape parameter

    Returns:
        Random float from Pareto(α) distribution, value >= 1.0

    Raises:
        ValueError: If alpha <= 0
    """
    if alpha <= 0:
        raise ValueError(f"Alpha must be positive, got {alpha}")
    u = _get_rng().next()
    return math.pow(1.0 - u, -1.0 / alpha)


@platform_function(
    name="random_log_normal", inputs=[FloatType, FloatType], output=FloatType
)
def random_log_normal_impl(mu: float, sigma: float) -> float:
    """Generate random float from log-normal distribution.

    Args:
        mu: Mean of underlying normal distribution
        sigma: Standard deviation of underlying normal distribution

    Returns:
        Random float from log-normal distribution (always positive)

    Raises:
        ValueError: If sigma <= 0
    """
    if sigma <= 0:
        raise ValueError(f"Sigma must be positive, got {sigma}")
    z = random_normal_impl()
    return math.exp(mu + sigma * z)


@platform_function(name="random_irwin_hall", inputs=[IntegerType], output=FloatType)
def random_irwin_hall_impl(n: int) -> float:
    """Generate sum of n uniform(0,1) random variables.

    Args:
        n: Number of variables to sum

    Returns:
        Random float in range [0, n]

    Raises:
        ValueError: If n <= 0
    """
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    rng = _get_rng()
    return sum(rng.next() for _ in range(n))


@platform_function(name="random_bates", inputs=[IntegerType], output=FloatType)
def random_bates_impl(n: int) -> float:
    """Generate average of n uniform(0,1) random variables.

    Args:
        n: Number of variables to average

    Returns:
        Random float in range [0, 1]

    Raises:
        ValueError: If n <= 0
    """
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    return random_irwin_hall_impl(n) / n


@platform_function(name="random_seed", inputs=[IntegerType], output=NullType)
def random_seed_impl(seed: int) -> None:
    """Seed the random number generator for reproducible sequences.

    IMPORTANT: Calling this function switches from cryptographically secure
    random to a deterministic PRNG (XorShift128+). This is essential for
    reproducible simulations but should not be used when cryptographic security
    is required.

    Uses same algorithm as TypeScript implementation for cross-platform
    reproducibility with the same seed.

    Args:
        seed: Seed value for reproducible random sequences
    """
    _set_rng(XorShift128RNG(seed))


# Collected from the @platform_function decorations above.
random_impl = platform_functions(__name__)


__all__ = ["random_impl", "_reset_to_crypto"]
