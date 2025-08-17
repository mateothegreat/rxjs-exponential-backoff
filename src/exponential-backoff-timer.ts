/**
 * RxJS Exponential Backoff Timer Factory
 *
 * This module provides a simple, drop-in replacement for your legacy timer implementation:
 * `timer(Math.min(1000 * Math.pow(2, retryCount - 1), 5000))`
 *
 * The new implementation adds jitter, better debugging, and maintains the same observable interface
 * while being completely backward compatible with your existing RxJS-based retry logic.
 */

import { Observable, timer } from "rxjs";
import { calculateExponentialBackoff, type BackoffOptions } from "./exponential-backoff";

/**
 * Configuration options for the RxJS exponential backoff timer.
 *
 * These options provide fine-grained control over the backoff behavior
 * while maintaining simplicity for common use cases.
 */
export interface BackoffTimerOptions extends BackoffOptions {
  /**
   * Whether to emit the delay value before starting the timer.
   *
   * When true, the observable will emit the calculated delay (in milliseconds)
   * immediately, then emit 0 after the delay completes. This is useful for
   * logging or monitoring retry delays.
   *
   * When false, the observable behaves exactly like RxJS timer() - it emits
   * 0 after the delay with no intermediate emissions.
   *
   * @defaultValue false
   */
  emitDelay?: boolean;

  /**
   * Whether to include calculation metadata in console debug logs.
   *
   * When true, each timer creation will log debug information about
   * the backoff calculation, including whether the delay was capped
   * and how much jitter was applied.
   *
   * This is useful during development but should typically be disabled
   * in production for performance.
   *
   * @defaultValue false
   */
  enableDebugLogs?: boolean;
}

/**
 * Factory class for creating RxJS timer observables with exponential backoff.
 *
 * This factory provides a clean, reusable way to create backoff timers with
 * consistent configuration across your application. It encapsulates the
 * exponential backoff logic while maintaining the familiar RxJS timer interface.
 *
 * @example
 * ```typescript
 * // Create a factory with your preferred defaults
 * const backoffTimerFactory = new BackoffTimerFactory({
 *   baseDelayMs: 1000,
 *   maxDelayMs: 5000,
 *   jitterFactor: 0.2
 * });
 *
 * // Use in retry logic (drop-in replacement)
 * return this.http.get('/api/data').pipe(
 *   retryWhen(errors => errors.pipe(
 *     scan((retryCount) => retryCount + 1, 0),
 *     mergeMap(retryCount =>
 *       retryCount > 5
 *         ? throwError('Max retries exceeded')
 *         : backoffTimerFactory.createTimer(retryCount)
 *     )
 *   ))
 * );
 * ```
 */
export class BackoffTimerFactory {
  private readonly options: Required<BackoffTimerOptions>;

  /**
   * Creates a new RxJS backoff timer factory with the specified default options.
   *
   * @param options - Default configuration for all timers created by this factory
   *
   * @example
   * ```typescript
   * // Factory configured to match your legacy implementation
   * const factory = new BackoffTimerFactory({
   *   baseDelayMs: 1000,
   *   maxDelayMs: 5000,
   *   jitterFactor: 0.2,
   *   enableDebugLogs: true
   * });
   * ```
   */
  constructor(options: BackoffTimerOptions = {}) {
    this.options = {
      baseDelayMs: options.baseDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 5000,
      jitterFactor: options.jitterFactor ?? 0.2,
      emitDelay: options.emitDelay ?? false,
      enableDebugLogs: options.enableDebugLogs ?? false
    };
  }

  /**
   * Creates an RxJS timer observable with exponential backoff delay.
   *
   * This method is a direct replacement for your legacy timer call.
   * It calculates an exponential backoff delay and returns an observable
   * that emits after the calculated delay period.
   *
   * @param retryCount - The current retry attempt number (1-based).
   * @param overrideOptions - Optional configuration to override factory defaults.
   *
   * @returns Observable that emits 0 after the calculated delay.
   */
  public create<E = unknown>(
    retryCount: number,
    overrideOptions?: Partial<BackoffTimerOptions>
  ): Observable<number> {
    const options = { ...this.options, ...overrideOptions };

    const backoffResult = calculateExponentialBackoff(retryCount, {
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      jitterFactor: options.jitterFactor
    });

    // Optional debug logging.
    if (options.enableDebugLogs) {
      console.debug(`[exponential-backoff-timer] ${backoffResult.toString()}`);
    }

    // Create the timer observable.
    const observable = timer(backoffResult.delayMs);

    // Optionally emit the delay value before the timer completes.
    if (options.emitDelay) {
      return new Observable<number>((subscriber) => {
        // Immediately emit the delay value.
        subscriber.next(backoffResult.delayMs);

        // Subscribe to the timer and emit 0 when it completes.
        const subscription = observable.subscribe({
          next: () => subscriber.next(0),
          error: (err: E) => subscriber.error(err),
          complete: () => subscriber.complete()
        });

        // Cleanup function.
        return () => subscription.unsubscribe();
      });
    }

    return observable;
  }

  /**
   * Gets the current factory configuration.
   *
   * @returns Immutable copy of the factory's options.
   */
  public getOptions(): Readonly<Required<BackoffTimerOptions>> {
    return Object.freeze({ ...this.options });
  }
}

/**
 * Creates a delay function for use with RxJS retry operator's delay option.
 *
 * This is the modern, recommended approach for RxJS v8+ that replaces the deprecated
 * retryWhen operator. It returns a function that can be passed directly to retry()'s
 * delay option for exponential backoff behavior.
 *
 * @param options - Optional backoff configuration
 * @returns Function that calculates delay based on retry metadata
 *
 * @example
 * ```typescript
 * // MODERN: Using retry operator with delay function (RxJS v8+)
 * return this.http.get('/api/data').pipe(
 *   retry({
 *     count: 5,
 *     delay: createBackoffDelayFunction({
 *       baseDelayMs: 1000,
 *       maxDelayMs: 5000,
 *       jitterFactor: 0.2
 *     })
 *   })
 * );
 * ```
 */
export function createBackoffDelayFunction<E = unknown>(
  options?: BackoffTimerOptions
): (error: E, retryCount: number) => Observable<number> {
  const factory = new BackoffTimerFactory(options);

  return (_error: E, retryCount: number) => {
    return factory.create(retryCount);
  };
}

/**
 * Creates a simple exponential backoff timer observable.
 *
 * This is provided for backward compatibility and simple use cases.
 * For modern RxJS applications, prefer createBackoffDelayFunction() with retry().
 *
 * @param retryCount - The current retry attempt number (1-based)
 * @param options - Optional backoff configuration
 * @returns Observable that emits 0 after the calculated exponential backoff delay
 *
 * @example
 * ```typescript
 * // LEGACY: Direct timer replacement (backward compatibility)
 * return createBackoffTimer(retryCount);
 *
 * // MODERN: Preferred approach
 * return source.pipe(
 *   retry({
 *     count: 5,
 *     delay: createBackoffDelayFunction(options)
 *   })
 * );
 * ```
 */
export function createBackoffTimer<E = unknown>(
  retryCount: number,
  options?: BackoffTimerOptions
): Observable<number> {
  const factory = new BackoffTimerFactory(options);
  return factory.create<E>(retryCount);
}

/**
 * Development-friendly delay function with debug logging enabled.
 *
 * This function is identical to the legacy-compatible version but includes
 * debug logging to help you monitor retry behavior during development.
 *
 * @example
 * ```typescript
 * // Use during development to see retry calculations
 * return source.pipe(
 *   retry({
 *     count: 5,
 *     delay: debugBackoffDelay
 *   })
 * );
 * // Console output: "[exponential-backoff-timer] Retry 3: 4123ms (raw: 4000ms, jitter: +123ms)"
 * ```
 */
export const debugBackoffDelay = createBackoffDelayFunction({
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  jitterFactor: 0.2,
  emitDelay: false,
  enableDebugLogs: true
});
