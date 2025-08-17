/**
 * Examples and patterns for using the exponential backoff timer.
 */
import { Observable, retry } from "rxjs";
import { createBackoffDelayFunction, createBackoffTimer } from "./exponential-backoff-timer";

export class HttpRequestError extends Error {
  status: number;
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

export type CustomHttpRequestError = { status: number; message: string };

export const isCustomHttpRequestError = (e: unknown): e is CustomHttpRequestError =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as HttpRequestError).status === "number" &&
  typeof (e as HttpRequestError).message === "string";

export const toError = (e: unknown): Error => {
  if (e instanceof Error) return e;
  if (isCustomHttpRequestError(e)) return new HttpRequestError(e.message, e.status, { cause: e });
  return new Error(typeof e === "string" ? e : JSON.stringify(e));
};

/**
 * Example: HTTP Retry Service
 *
 * Shows how to integrate the new timer into modern RxJS retry patterns using
 * the retry operator instead of the deprecated retryWhen.
 */
export class HttpRetryService {
  private readonly backoffDelayFunction = createBackoffDelayFunction({
    baseDelayMs: 250,
    maxDelayMs: 1000,
    jitterFactor: 0.25
  });

  /**
   * Example: Recommended retry implementation using retry operator.
   */
  retryHttpRequestModern<T>(source: Observable<T>, maxRetries: number = 5): Observable<T> {
    return source.pipe(
      retry({
        count: maxRetries,
        delay: this.backoffDelayFunction
      })
    );
  }

  /**
   * Example: Using the simple delay function approach.
   * This provides more control over retry logic while using modern operators.
   */
  retryHttpRequestWithCustomLogic<T>(
    source: Observable<T>,
    maxRetries: number = 5,
    shouldRetry?: (error: unknown) => boolean
  ): Observable<T> {
    return source.pipe(
      retry({
        count: maxRetries,
        delay: (error, retryCount) => {
          // Custom retry logic.
          if (shouldRetry && !shouldRetry(error)) {
            throw error;
          }

          return createBackoffTimer(retryCount, {
            baseDelayMs: 1000,
            maxDelayMs: 5000,
            jitterFactor: 0.2
          });
        }
      })
    );
  }

  /**
   * Example: HTTP-specific retry logic with status code handling.
   */
  retryHttpWithStatusCodeLogic<T>(source: Observable<T>, maxRetries = 5): Observable<T> {
    return source.pipe(
      retry({
        count: maxRetries,
        delay: (error: HttpRequestError, retryCount) => {
          // Only retry on 5xx and 429; fail fast on other 4xx
          if (error.status < 500 && error.status !== 429) {
            throw error;
          }

          // Longer delay for rate limiting.
          const baseDelayMs = error.status === 429 ? 2000 : 1000;

          // Create a backoff timer and return it so it can be scheduled.
          return createBackoffTimer(retryCount, {
            baseDelayMs,
            maxDelayMs: 30000,
            jitterFactor: 0.25
          });
        }
      })
    );
  }
}
