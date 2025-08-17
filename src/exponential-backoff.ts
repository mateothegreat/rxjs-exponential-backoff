/**
 * # Understanding Exponential Backoff
 *
 * When distributed systems communicate over networks, failures are inevitable.
 * Network requests can timeout, servers can become temporarily overloaded,
 * or services might be momentarily unavailable. The question isn't whether
 * failures will happen, but how we should respond when they do.
 *
 * ## The Problem with Immediate Retries
 *
 * A naive approach might retry failed requests immediately and repeatedly.
 * However, this creates several problems:
 *
 * 1. **Server Overload**: If a server is struggling, bombarding it with retries
 *    makes the problem worse, potentially causing a cascade failure.
 *
 * 2. **Retry Storms**: When multiple clients fail simultaneously (common during
 *    outages), they all retry at once, creating synchronized load spikes.
 *
 * 3. **Resource Waste**: Rapid retries consume bandwidth, CPU, and battery life
 *    without giving the underlying issue time to resolve.
 *
 * ## The Exponential Backoff Solution
 *
 * Exponential backoff solves these problems by progressively increasing the
 * delay between retry attempts. This gives failing systems time to recover
 * while reducing the overall load during outages.
 */

/**
 * Configuration options for exponential backoff behavior.
 *
 * These parameters allow you to tune the backoff strategy for different
 * scenarios - from quick recovery of transient network hiccups to
 * patient handling of major service outages.
 *
 * @example
 * ```typescript
 * // Quick recovery for network blips
 * const networkOptions: BackoffOptions = {
 *   baseDelayMs: 100,
 *   maxDelayMs: 2000,
 *   jitterFactor: 0.1
 * };
 *
 * // Patient approach for service outages
 * const serviceOptions: BackoffOptions = {
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   jitterFactor: 0.3
 * };
 * ```
 */
export interface BackoffOptions {
  /**
   * The initial delay in milliseconds before the first retry attempt.
   *
   * This is your "starting wait time" - each subsequent retry will double
   * the previous delay until hitting the maximum. Choose this based on how
   * quickly you expect transient issues to resolve.
   *
   * **Typical values:**
   * - API calls: 100-500ms (network issues resolve quickly)
   * - Database operations: 500-1000ms (connection pools need time)
   * - External services: 1000-2000ms (third-party systems vary widely)
   *
   * @defaultValue 1000
   */
  baseDelayMs?: number;

  /**
   * The maximum delay in milliseconds, preventing runaway wait times.
   *
   * Without a cap, exponential growth becomes impractical quickly:
   * - Retry 10: ~17 minutes (with 1000ms base)
   * - Retry 15: ~9 hours
   * - Retry 20: ~12 days
   *
   * The cap ensures delays remain reasonable while still providing
   * exponential benefits for earlier retries.
   *
   * **Typical values:**
   * - Interactive operations: 5000-10000ms (users won't wait longer)
   * - Background processes: 30000-60000ms (can afford longer waits)
   * - Critical systems: 120000ms+ (must eventually succeed)
   *
   * @defaultValue 5000
   */
  maxDelayMs?: number;

  /**
   * Randomization factor between 0 and 1 to prevent synchronized retries.
   *
   * When multiple clients fail simultaneously (common during outages),
   * they often retry at predictable intervals. Jitter adds randomness
   * to spread these retries across time, preventing load spikes.
   *
   * **How it works:** The final delay is adjusted by a random amount
   * within ±(calculatedDelay × jitterFactor).
   *
   * **Typical values:**
   * - 0.0: No randomness (deterministic, good for testing)
   * - 0.1-0.2: Light jitter (gentle load spreading)
   * - 0.3-0.5: Heavy jitter (strong spike prevention)
   *
   * **Example with 4000ms delay and 0.25 jitter:**
   * - Range: 3000ms to 5000ms
   * - Average: Still 4000ms across many clients
   *
   * @defaultValue 0.2
   */
  jitterFactor?: number;
}

/**
 * Represents a calculated backoff delay with metadata about how it was computed.
 *
 * This class provides not just the delay value, but context about the
 * calculation that can help with debugging and monitoring retry behavior.
 */
export class BackoffResult {
  /**
   * The final delay in milliseconds to wait before retrying.
   */
  public readonly delayMs: number;

  /**
   * The raw exponential delay before capping and jitter were applied.
   */
  public readonly rawDelayMs: number;

  /**
   * The delay after applying the maximum cap but before jitter.
   */
  public readonly cappedDelayMs: number;

  /**
   * The random offset applied during jitter calculation.
   * Will be 0 if jitter is disabled.
   */
  public readonly jitterOffsetMs: number;

  /**
   * Whether the raw exponential delay exceeded the maximum cap.
   */
  public readonly wasCapped: boolean;

  /**
   * The retry attempt number used in the calculation.
   */
  public readonly retryAttempt: number;

  /**
   * Creates a new BackoffResult with calculation details.
   *
   * @param delayMs - The final delay to use
   * @param rawDelayMs - The uncapped exponential delay
   * @param cappedDelayMs - The delay after applying the cap
   * @param jitterOffsetMs - The random offset applied
   * @param retryAttempt - The retry attempt number
   */
  constructor(
    delayMs: number,
    rawDelayMs: number,
    cappedDelayMs: number,
    jitterOffsetMs: number,
    retryAttempt: number
  ) {
    this.delayMs = Math.max(0, delayMs); // Never allow negative delays
    this.rawDelayMs = rawDelayMs;
    this.cappedDelayMs = cappedDelayMs;
    this.jitterOffsetMs = jitterOffsetMs;
    this.wasCapped = rawDelayMs > cappedDelayMs;
    this.retryAttempt = retryAttempt;
  }

  /**
   * Returns a human-readable description of this backoff calculation.
   *
   * Useful for logging and debugging retry behavior.
   *
   * @returns A descriptive string about the calculation
   *
   * @example
   * ```typescript
   * const result = calculateExponentialBackoff(5);
   * console.log(result.toString());
   * // "Retry 5: 4000ms (raw: 16000ms, capped, jitter: -200ms)"
   * ```
   */
  public toString(): string {
    let result = `Retry ${this.retryAttempt}: ${this.delayMs}ms (raw: ${this.rawDelayMs}ms`;

    if (this.wasCapped) {
      result += ", capped";
    }

    if (this.jitterOffsetMs !== 0) {
      const sign = this.jitterOffsetMs >= 0 ? "+" : "";
      result += `, jitter: ${sign}${Math.round(this.jitterOffsetMs)}ms`;
    } else {
      result += ", no jitter";
    }

    result += ")";
    return result;
  }
}

/**
 * Calculates an exponential backoff delay with capping and optional jitter.
 *
 * ## How the Algorithm Works
 *
 * The calculation follows these steps in order:
 *
 * 1. **Input Validation**: Ensure retryAttempt is at least 1
 * 2. **Exponential Growth**: Calculate baseDelay × 2^(retryAttempt - 1)
 * 3. **Apply Cap**: Limit the delay to maxDelayMs to prevent runaway growth
 * 4. **Add Jitter**: Apply random offset to prevent synchronized retries
 * 5. **Safety Check**: Ensure the final delay is never negative
 *
 * ## Mathematical Formula
 *
 * ```
 * rawDelay = baseDelay × 2^(retryAttempt - 1)
 * cappedDelay = min(rawDelay, maxDelay)
 * jitterOffset = random(-1, +1) × cappedDelay × jitterFactor
 * finalDelay = max(0, cappedDelay + jitterOffset)
 * ```
 *
 * ## Practical Examples
 *
 * **Default settings (base: 1000ms, cap: 5000ms, jitter: 0.2):**
 * - Attempt 1: ~1000ms ± 200ms
 * - Attempt 2: ~2000ms ± 400ms
 * - Attempt 3: ~4000ms ± 800ms
 * - Attempt 4+: ~5000ms ± 1000ms (capped)
 *
 * **Quick recovery (base: 200ms, cap: 2000ms, jitter: 0.1):**
 * - Attempt 1: ~200ms ± 20ms
 * - Attempt 2: ~400ms ± 40ms
 * - Attempt 3: ~800ms ± 80ms
 * - Attempt 4: ~1600ms ± 160ms
 * - Attempt 5+: ~2000ms ± 200ms (capped)
 *
 * ## Usage Patterns
 *
 * **HTTP API Retries:**
 * ```typescript
 * const result = calculateExponentialBackoff(attemptNumber, {
 *   baseDelayMs: 500,
 *   maxDelayMs: 10000,
 *   jitterFactor: 0.25
 * });
 * await new Promise(resolve => setTimeout(resolve, result.delayMs));
 * ```
 *
 * **Database Connection Retries:**
 * ```typescript
 * const result = calculateExponentialBackoff(attemptNumber, {
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   jitterFactor: 0.3
 * });
 * ```
 *
 * @param retryAttempt - The current retry attempt number (1-based).
 *                      Values ≤ 0 are treated as 1 for safety.
 * @param options - Configuration for the backoff calculation
 * @returns A BackoffResult containing the delay and calculation details
 *
 * @throws Never throws - all inputs are validated and sanitized
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const delay1 = calculateExponentialBackoff(1); // ~1000ms
 * const delay3 = calculateExponentialBackoff(3); // ~4000ms
 *
 * // Custom configuration for API calls
 * const apiDelay = calculateExponentialBackoff(2, {
 *   baseDelayMs: 300,
 *   maxDelayMs: 8000,
 *   jitterFactor: 0.15
 * }); // ~600ms ± 90ms
 *
 * // Deterministic delays for testing
 * const testDelay = calculateExponentialBackoff(4, {
 *   baseDelayMs: 100,
 *   maxDelayMs: 1000,
 *   jitterFactor: 0 // No randomness
 * }); // Exactly 800ms
 * ```
 */
export const calculateExponentialBackoff = (
  retryAttempt: number,
  { baseDelayMs = 1000, maxDelayMs = 5000, jitterFactor = 0.2 }: BackoffOptions = {}
): BackoffResult => {
  // Normalize retry attempt to be at least 1
  // This ensures the exponential formula works correctly and provides
  // intuitive behavior for callers who might pass 0 or negative values
  const normalizedAttempt = Math.max(1, Math.floor(retryAttempt));

  // Calculate the raw exponential delay
  // Formula: baseDelay × 2^(attempt - 1)
  // - Attempt 1: baseDelay × 2^0 = baseDelay × 1 = baseDelay
  // - Attempt 2: baseDelay × 2^1 = baseDelay × 2 = 2 × baseDelay
  // - Attempt 3: baseDelay × 2^2 = baseDelay × 4 = 4 × baseDelay
  // The subtraction of 1 ensures the first retry uses the base delay directly
  const rawDelayMs = baseDelayMs * Math.pow(2, normalizedAttempt - 1);

  // Apply the maximum cap to prevent impractically long delays
  // This is crucial because exponential growth becomes extreme quickly:
  // Without a cap, attempt 20 with base 1000ms would be ~524 seconds (8+ minutes)
  const cappedDelayMs = Math.min(rawDelayMs, maxDelayMs);

  // Calculate and apply jitter if enabled
  let jitterOffsetMs = 0;
  let finalDelayMs = cappedDelayMs;

  if (jitterFactor > 0) {
    // Calculate the maximum jitter range
    // This is the amount by which we can vary the delay in either direction
    const jitterRangeMs = cappedDelayMs * Math.abs(jitterFactor);

    // Generate a random offset in the range [-jitterRange, +jitterRange]
    // Math.random() returns [0, 1), so:
    // - Math.random() * 2 gives [0, 2)
    // - Subtracting 1 gives [-1, 1)
    // - Multiplying by jitterRange gives [-jitterRange, +jitterRange)
    jitterOffsetMs = (Math.random() * 2 - 1) * jitterRangeMs;

    // Apply the jitter offset and ensure we never return a negative delay
    // Negative delays don't make sense for waiting, so we clamp to 0
    finalDelayMs = Math.max(0, cappedDelayMs + jitterOffsetMs);
  }

  return new BackoffResult(
    finalDelayMs,
    rawDelayMs,
    cappedDelayMs,
    jitterOffsetMs,
    normalizedAttempt
  );
};

/**
 * A utility class for managing retry attempts with exponential backoff.
 *
 * This class encapsulates the state and logic needed for retry loops,
 * making it easier to implement robust retry mechanisms in your applications.
 *
 * @example
 * ```typescript
 * const retryManager = new RetryManager({
 *   baseDelayMs: 500,
 *   maxDelayMs: 10000,
 *   jitterFactor: 0.25
 * });
 *
 * while (retryManager.canRetry() && retryManager.attemptCount < 5) {
 *   try {
 *     const result = await riskyOperation();
 *     return result; // Success!
 *   } catch (error) {
 *     if (retryManager.shouldRetry(error)) {
 *       await retryManager.waitForNextRetry();
 *     } else {
 *       throw error; // Don't retry this type of error
 *     }
 *   }
 * }
 * ```
 */
export class RetryManager {
  private _attemptCount = 0;
  private readonly _options: Required<BackoffOptions>;

  /**
   * Gets the current number of retry attempts made.
   */
  public get attemptCount(): number {
    return this._attemptCount;
  }

  /**
   * Gets the configuration options for this retry manager.
   */
  public get options(): Readonly<Required<BackoffOptions>> {
    return Object.freeze({ ...this._options });
  }

  /**
   * Creates a new RetryManager with the specified configuration.
   *
   * @param options - Configuration for retry behavior
   */
  constructor(options: BackoffOptions = {}) {
    this._options = {
      baseDelayMs: options.baseDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 5000,
      jitterFactor: options.jitterFactor ?? 0.2
    };
  }

  /**
   * Determines if another retry attempt should be made.
   *
   * This is a simple check that can be extended with more sophisticated
   * logic (like maximum attempt limits) in subclasses.
   *
   * @returns true if retrying is recommended
   */
  public canRetry(): boolean {
    return true; // Override in subclasses for more sophisticated logic
  }

  /**
   * Determines if a specific error should trigger a retry.
   *
   * Override this method to implement custom retry logic based on error types.
   *
   * @param error - The error that occurred
   * @returns true if the error is retryable
   *
   * @example
   * ```typescript
   * class ApiRetryManager extends RetryManager {
   *   shouldRetry(error: unknown): boolean {
   *     if (error instanceof HttpError) {
   *       // Retry on server errors and rate limits, but not client errors
   *       return error.status >= 500 || error.status === 429;
   *     }
   *     return super.shouldRetry(error);
   *   }
   * }
   * ```
   */
  public shouldRetry(_error: unknown): boolean {
    // Default implementation: retry all errors
    // Override this method for more sophisticated error handling
    return true;
  }

  /**
   * Calculates the delay for the next retry and waits for that duration.
   *
   * This method increments the attempt counter and returns a Promise that
   * resolves after the calculated backoff delay.
   *
   * @returns A Promise that resolves after the backoff delay
   *
   * @example
   * ```typescript
   * try {
   *   await riskyOperation();
   * } catch (error) {
   *   await retryManager.waitForNextRetry();
   *   // Now ready for next attempt
   * }
   * ```
   */
  public async waitForNextRetry(): Promise<BackoffResult> {
    this._attemptCount++;

    const backoffResult = calculateExponentialBackoff(this._attemptCount, this._options);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, backoffResult.delayMs);
    });

    return backoffResult;
  }

  /**
   * Calculates the delay for the next retry without waiting or incrementing counters.
   *
   * Useful for preview/logging purposes or when you want to handle the delay yourself.
   *
   * @returns The calculated backoff result for the next attempt
   */
  public previewNextDelay(): BackoffResult {
    return calculateExponentialBackoff(this._attemptCount + 1, this._options);
  }

  /**
   * Resets the retry manager to its initial state.
   *
   * Call this when starting a new operation that should have fresh retry counts.
   */
  public reset(): void {
    this._attemptCount = 0;
  }
}
