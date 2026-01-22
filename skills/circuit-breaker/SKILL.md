---
name: circuit-breaker
description: Implement the circuit breaker pattern to prevent cascade failures in distributed systems. Use when adding resilience to API clients, external service calls, or any operation that can fail and should fail fast.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: resilience
  time: 4h
  source: drift-masterguide
---

# Circuit Breaker Pattern

Prevent cascade failures by failing fast when a service is unhealthy.

## When to Use This Skill

- Adding resilience to external API calls
- Protecting against slow or failing downstream services
- Implementing graceful degradation
- Building fault-tolerant microservices

## Core Concepts

A circuit breaker has three states:

1. **CLOSED**: Normal operation, requests pass through
2. **OPEN**: Service is failing, requests fail immediately
3. **HALF_OPEN**: Testing if service recovered

## TypeScript Implementation

```typescript
// circuit-breaker.ts
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening
  successThreshold: number;      // Successes to close from half-open
  timeout: number;               // Ms before trying half-open
  fallback?: () => Promise<any>; // Optional fallback
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30000,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.config.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        if (this.config.fallback) {
          return this.config.fallback();
        }
        throw new CircuitOpenError('Circuit is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export { CircuitBreaker, CircuitBreakerConfig, CircuitOpenError };
```

## Python Implementation

```python
# circuit_breaker.py
import time
from enum import Enum
from typing import Callable, TypeVar, Optional
from functools import wraps

T = TypeVar('T')

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitOpenError(Exception):
    pass

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        success_threshold: int = 2,
        timeout: float = 30.0,
        fallback: Optional[Callable] = None,
    ):
        self.failure_threshold = failure_threshold
        self.success_threshold = success_threshold
        self.timeout = timeout
        self.fallback = fallback
        
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._successes = 0
        self._last_failure_time = 0.0

    @property
    def state(self) -> CircuitState:
        return self._state

    def __call__(self, fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> T:
            return self.execute(lambda: fn(*args, **kwargs))
        return wrapper

    def execute(self, fn: Callable[[], T]) -> T:
        if self._state == CircuitState.OPEN:
            if time.time() - self._last_failure_time >= self.timeout:
                self._state = CircuitState.HALF_OPEN
            else:
                if self.fallback:
                    return self.fallback()
                raise CircuitOpenError("Circuit is OPEN")

        try:
            result = fn()
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        self._failures = 0
        if self._state == CircuitState.HALF_OPEN:
            self._successes += 1
            if self._successes >= self.success_threshold:
                self._state = CircuitState.CLOSED
                self._successes = 0

    def _on_failure(self) -> None:
        self._failures += 1
        self._last_failure_time = time.time()
        if self._failures >= self.failure_threshold:
            self._state = CircuitState.OPEN
```

## Usage Examples

### TypeScript with API Client

```typescript
const paymentCircuit = new CircuitBreaker({
  failureThreshold: 3,
  timeout: 60000,
  fallback: async () => ({ status: 'pending', message: 'Payment service unavailable' }),
});

async function processPayment(amount: number) {
  return paymentCircuit.execute(async () => {
    const response = await fetch('https://api.stripe.com/v1/charges', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) throw new Error('Payment failed');
    return response.json();
  });
}
```

### Python Decorator Style

```python
circuit = CircuitBreaker(failure_threshold=3, timeout=60)

@circuit
def call_external_api(endpoint: str) -> dict:
    response = requests.get(endpoint, timeout=5)
    response.raise_for_status()
    return response.json()
```

## Integration with Observability

Add metrics to track circuit state:

```typescript
// With Prometheus
import { Gauge, Counter } from 'prom-client';

const circuitState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Current circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
});

const circuitTrips = new Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Total circuit breaker trips',
  labelNames: ['service'],
});
```

## Best Practices

1. **Tune thresholds per service**: Critical services need lower thresholds
2. **Always provide fallbacks**: Graceful degradation > hard failures
3. **Monitor circuit state**: Alert when circuits open frequently
4. **Use separate circuits**: One per external dependency
5. **Consider bulkheads**: Combine with connection pooling

## Common Mistakes

- Setting timeout too short (service never recovers)
- Sharing circuits across unrelated services
- Not handling CircuitOpenError in calling code
- Forgetting to add observability

## Related Patterns

- Retry with exponential backoff
- Bulkhead isolation
- Timeout pattern
- Fallback pattern
