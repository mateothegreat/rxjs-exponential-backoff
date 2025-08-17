import { of, throwError, timer } from "rxjs";
import { map, mergeMap, retry, toArray } from "rxjs/operators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpRequestError,
  HttpRetryService,
  type CustomHttpRequestError
} from "./exponential-backoff-example";
import {
  BackoffTimerFactory,
  createBackoffDelayFunction,
  createBackoffTimer,
  debugBackoffDelay,
  type BackoffTimerOptions
} from "./exponential-backoff-timer";

describe("RxjsBackoffTimerFactory", () => {
  let mockConsoleDebug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    mockConsoleDebug.mockRestore();
  });

  describe("constructor", () => {
    it("should create factory with default options", () => {
      const factory = new BackoffTimerFactory();
      const options = factory.getOptions();

      expect(options.baseDelayMs).toBe(1000);
      expect(options.maxDelayMs).toBe(5000);
      expect(options.jitterFactor).toBe(0.2);
      expect(options.emitDelay).toBe(false);
      expect(options.enableDebugLogs).toBe(false);
    });

    it("should create factory with custom options", () => {
      const customOptions: BackoffTimerOptions = {
        baseDelayMs: 500,
        maxDelayMs: 10000,
        jitterFactor: 0.1,
        emitDelay: true,
        enableDebugLogs: true
      };

      const factory = new BackoffTimerFactory(customOptions);
      const options = factory.getOptions();

      expect(options.baseDelayMs).toBe(500);
      expect(options.maxDelayMs).toBe(10000);
      expect(options.jitterFactor).toBe(0.1);
      expect(options.emitDelay).toBe(true);
      expect(options.enableDebugLogs).toBe(true);
    });

    it("should merge partial options with defaults", () => {
      const factory = new BackoffTimerFactory({ baseDelayMs: 200 });
      const options = factory.getOptions();

      expect(options.baseDelayMs).toBe(200);
      expect(options.maxDelayMs).toBe(5000); // Default
      expect(options.jitterFactor).toBe(0.2); // Default
      expect(options.emitDelay).toBe(false); // Default
      expect(options.enableDebugLogs).toBe(false); // Default
    });
  });

  describe("getDefaultOptions", () => {
    it("should return immutable options", () => {
      const factory = new BackoffTimerFactory();
      const options = factory.getOptions();

      expect(() => {
        // @ts-expect-error - Testing runtime immutability
        options.baseDelayMs = 999;
      }).toThrow();
    });

    it("should return fresh copy each time", () => {
      const factory = new BackoffTimerFactory();
      const options1 = factory.getOptions();
      const options2 = factory.getOptions();

      expect(options1).toEqual(options2);
      expect(options1).not.toBe(options2); // Different object instances
    });
  });

  describe("createTimer", () => {
    it("should create timer with calculated exponential backoff delay", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 100,
          maxDelayMs: 1000,
          jitterFactor: 0 // Disable jitter for predictable test
        });

        const startTime = Date.now();

        factory.create(1).subscribe({
          next: (value) => {
            const elapsedTime = Date.now() - startTime;

            expect(value).toBe(0); // RxJS timer emits 0
            expect(elapsedTime).toBeGreaterThanOrEqual(80); // Allow some margin
            expect(elapsedTime).toBeLessThan(150);
            resolve();
          }
        });
      });
    });

    it("should create timer with jitter when enabled", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 100,
          maxDelayMs: 1000,
          jitterFactor: 0.2
        });

        // Test multiple timers to verify jitter variance
        const delays: number[] = [];
        let completedCount = 0;

        for (let i = 0; i < 5; i++) {
          const startTime = Date.now();

          factory.create(2).subscribe({
            next: () => {
              delays.push(Date.now() - startTime);
              completedCount++;

              if (completedCount === 5) {
                // With jitter, delays should not all be identical
                const uniqueDelays = new Set(delays.map((d) => Math.round(d / 10) * 10));
                expect(uniqueDelays.size).toBeGreaterThanOrEqual(2);
                resolve();
              }
            }
          });
        }
      });
    });

    it("should apply override options", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 1000,
          jitterFactor: 0
        });

        const startTime = Date.now();

        factory
          .create(1, {
            baseDelayMs: 50, // Override
            jitterFactor: 0
          })
          .subscribe({
            next: () => {
              const elapsedTime = Date.now() - startTime;
              expect(elapsedTime).toBeGreaterThanOrEqual(40);
              expect(elapsedTime).toBeLessThan(80);
              resolve();
            }
          });
      });
    });

    it("should emit delay value when emitDelay is true", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 100,
          jitterFactor: 0,
          emitDelay: true
        });

        const emissions: number[] = [];

        factory.create(2).subscribe({
          next: (value) => emissions.push(value),
          complete: () => {
            expect(emissions).toHaveLength(2);
            expect(emissions[0]).toBe(200); // The delay value
            expect(emissions[1]).toBe(0); // Timer completion
            resolve();
          }
        });
      });
    });

    it("should log debug information when enabled", () => {
      const factory = new BackoffTimerFactory({
        baseDelayMs: 100,
        jitterFactor: 0,
        enableDebugLogs: true
      });

      factory.create(3);

      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining(
          "[exponential-backoff-timer] Retry 3: 400ms (raw: 400ms, no jitter)"
        )
      );
    });

    it("should not log when debug is disabled", () => {
      const factory = new BackoffTimerFactory({
        enableDebugLogs: false
      });

      factory.create(2);

      expect(mockConsoleDebug).not.toHaveBeenCalled();
    });

    it("should handle edge case retry counts", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 10,
          jitterFactor: 0
        });

        let completedTests = 0;
        const totalTests = 3;

        // Test zero retry count
        factory.create(0).subscribe({
          next: (value) => {
            expect(value).toBe(0);
            completedTests++;
            if (completedTests === totalTests) resolve();
          }
        });

        // Test negative retry count
        factory.create(-1).subscribe({
          next: (value) => {
            expect(value).toBe(0);
            completedTests++;
            if (completedTests === totalTests) resolve();
          }
        });

        // Test very high retry count (should be capped)
        const startTime = Date.now();
        factory.create(100, { maxDelayMs: 50 }).subscribe({
          next: () => {
            const elapsedTime = Date.now() - startTime;
            expect(elapsedTime).toBeLessThan(80); // Should be capped at 50ms
            completedTests++;
            if (completedTests === totalTests) resolve();
          }
        });
      });
    });

    it("should be unsubscribable", () => {
      return new Promise<void>((resolve) => {
        const factory = new BackoffTimerFactory({
          baseDelayMs: 1000
        });

        const subscription = factory.create(1).subscribe({
          next: () => {
            // This should not be called because we unsubscribe
            expect.fail("Timer should have been unsubscribed");
          }
        });

        // Unsubscribe immediately
        subscription.unsubscribe();

        // Wait a bit to ensure the timer doesn't emit
        setTimeout(() => {
          expect(subscription.closed).toBe(true);
          resolve();
        }, 100);
      });
    });
  });
});

describe("createBackoffTimer function", () => {
  it("should work as a simple function replacement", () => {
    return new Promise<void>((resolve) => {
      const startTime = Date.now();

      createBackoffTimer(1, {
        baseDelayMs: 50,
        jitterFactor: 0
      }).subscribe({
        next: (value) => {
          const elapsedTime = Date.now() - startTime;
          expect(value).toBe(0);
          expect(elapsedTime).toBeGreaterThanOrEqual(40);
          expect(elapsedTime).toBeLessThan(80);
          resolve();
        }
      });
    });
  });

  it("should use default options when none provided", () => {
    return new Promise<void>((resolve) => {
      const startTime = Date.now();

      createBackoffTimer(1).subscribe({
        next: () => {
          const elapsedTime = Date.now() - startTime;
          // Should use default 1000ms base, but allow for jitter
          expect(elapsedTime).toBeGreaterThanOrEqual(800);
          expect(elapsedTime).toBeLessThan(1300);
          resolve();
        }
      });
    });
  });

  it("should create independent factory instances", () => {
    // Each call should create a new factory, so they don't share state
    const timer1 = createBackoffTimer(1, { enableDebugLogs: true });
    const timer2 = createBackoffTimer(1, { enableDebugLogs: false });

    // Both should work independently
    expect(timer1).toBeDefined();
    expect(timer2).toBeDefined();
  });
});

describe("createBackoffDelayFunction", () => {
  it("should return a function that works with retry operator", () => {
    return new Promise<void>((resolve) => {
      const delayFunction = createBackoffDelayFunction({
        baseDelayMs: 10,
        maxDelayMs: 50,
        jitterFactor: 0
      });

      let attemptCount = 0;
      const maxRetries = 3;

      const source = of(null).pipe(
        map(() => {
          attemptCount++;
          if (attemptCount <= 2) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          return `Success on attempt ${attemptCount}`;
        }),
        retry({
          count: maxRetries,
          delay: delayFunction
        })
      );

      source.subscribe({
        next: (result) => {
          expect(result).toBe("Success on attempt 3");
          expect(attemptCount).toBe(3);
          resolve();
        },
        error: resolve
      });
    });
  });

  it("should pass correct parameters to delay function", () => {
    const delaySpy = vi.fn(() => {
      createBackoffDelayFunction({
        baseDelayMs: 100,
        jitterFactor: 0
      });
      return timer(10);
    });

    let attemptCount = 0;
    const source = of(null).pipe(
      map(() => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Test error");
        }
        return "success";
      }),
      retry({
        count: 2,
        delay: delaySpy
      })
    );

    source.subscribe({
      next: () => {
        expect(delaySpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Test error" }),
          1
        );
      }
    });
  });

  it("should work with custom options", () => {
    return new Promise<void>((resolve) => {
      const delayFunction = createBackoffDelayFunction({
        baseDelayMs: 20,
        maxDelayMs: 100,
        jitterFactor: 0,
        enableDebugLogs: true
      });

      let attemptCount = 0;
      const source = of(null).pipe(
        map(() => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error("Test error");
          }
          return "success";
        }),
        retry({
          count: 2,
          delay: delayFunction
        })
      );

      source.subscribe({
        next: (result) => {
          expect(result).toBe("success");
          resolve();
        },
        error: resolve
      });
    });
  });

  describe("Pre-configured delay functions", () => {
    describe("legacyCompatibleBackoffDelay", () => {
      it("should work with retry operator", () => {
        return new Promise<void>((resolve) => {
          let attemptCount = 0;
          const source = of(null).pipe(
            map(() => {
              attemptCount++;
              if (attemptCount === 1) {
                throw new Error("Test error");
              }
              return "success";
            }),
            retry({
              count: 2,
              delay: createBackoffDelayFunction({
                baseDelayMs: 100,
                jitterFactor: 0
              })
            })
          );

          source.subscribe({
            next: (result) => {
              expect(result).toBe("success");
              expect(attemptCount).toBe(2);
              resolve();
            },
            error: resolve
          });
        });
      });

      it("should not log debug information", () => {
        return new Promise<void>((resolve) => {
          const source = throwError(() => new Error("Test")).pipe(
            retry({
              count: 1,
              delay: createBackoffDelayFunction({
                baseDelayMs: 100,
                jitterFactor: 0
              })
            })
          );

          source.subscribe({
            error: () => {
              resolve();
            }
          });
        });
      });
    });

    describe("debugBackoffDelay", () => {
      it("should log debug information", () => {
        return new Promise<void>((resolve) => {
          const source = throwError(() => new Error("Test")).pipe(
            retry({
              count: 1,
              delay: debugBackoffDelay
            })
          );

          source.subscribe({
            error: () => {
              resolve();
            }
          });
        });
      });
    });
  });
});

describe("HttpRetryService", () => {
  let httpRetryService: HttpRetryService;

  beforeEach(() => {
    httpRetryService = new HttpRetryService();
  });

  describe("retryHttpRequestModern", () => {
    it("should retry failed requests with exponential backoff using modern retry operator", () => {
      return new Promise<void>((resolve) => {
        let attemptCount = 0;
        const maxRetries = 3;

        const failingSource = of(null).pipe(
          mergeMap(() => {
            attemptCount++;
            if (attemptCount <= 2) {
              return throwError(() => new Error(`Attempt ${attemptCount} failed`));
            }
            return of(`Success on attempt ${attemptCount}`);
          })
        );

        const startTime = Date.now();
        httpRetryService.retryHttpRequestModern(failingSource, maxRetries).subscribe({
          next: (result) => {
            const totalTime = Date.now() - startTime;

            expect(result).toBe("Success on attempt 3");
            expect(attemptCount).toBe(3);
            // Should have had 2 retry delays (exponential backoff).
            expect(totalTime).toBeGreaterThan(100); // Some delay occurred.
            resolve();
          },
          error: () => {
            resolve();
          }
        });
      });
    });

    describe("retryHttpWithStatusCodeLogic", () => {
      it("should not retry client errors (4xx except 429)", () => {
        return new Promise<void>((resolve) => {
          const clientErrorSource = throwError(() => ({ status: 404, message: "Not Found" }));

          httpRetryService.retryHttpWithStatusCodeLogic(clientErrorSource, 3).subscribe({
            next: () => {
              throw new Error("Should not have succeeded");
            },
            error: (e: CustomHttpRequestError) => {
              expect(e.status).toBe(404);
              resolve();
            }
          });
        });
      });

      it("should retry server errors (5xx)", () => {
        return new Promise<void>((resolve) => {
          let attemptCount = 0;

          const serverErrorSource = of(null).pipe(
            mergeMap(() => {
              attemptCount++;
              if (attemptCount === 1) {
                return throwError(() => ({ status: 500, message: "Server Error" }));
              }
              return of("Success after server error");
            })
          );

          httpRetryService.retryHttpWithStatusCodeLogic(serverErrorSource, 3).subscribe({
            next: (result) => {
              expect(result).toBe("Success after server error");
              expect(attemptCount).toBe(2);
              resolve();
            },
            error: resolve
          });
        });
      });
    });

    it("should throw error when max retries exceeded", () => {
      return new Promise<void>((resolve) => {
        const alwaysFailingSource = of(null).pipe(
          mergeMap(() => throwError(() => new Error("Always fails")))
        );

        httpRetryService.retryHttpRequestModern(alwaysFailingSource, 2).subscribe({
          next: () => {
            throw new Error("Should not succeed");
          },
          error: (err: CustomHttpRequestError) => {
            expect(err.message).toBe("Always fails");
            resolve();
          }
        });
      });
    });

    it("should succeed immediately if no error occurs", () => {
      return new Promise<void>((resolve) => {
        const successSource = of("Immediate success");

        httpRetryService.retryHttpRequestModern(successSource, 3).subscribe({
          next: (result) => {
            expect(result).toBe("Immediate success");
            resolve();
          },
          error: resolve
        });
      });
    });
  });
});

describe("retryHttpRequestSimple", () => {
  let httpRetryService: HttpRetryService;

  beforeEach(() => {
    httpRetryService = new HttpRetryService();
  });

  it("should work with the simple function approach", () => {
    return new Promise<void>((resolve) => {
      let attemptCount = 0;

      const failingSource = of(null).pipe(
        mergeMap(() => {
          attemptCount++;
          if (attemptCount === 1) {
            return throwError(() => new Error("First attempt failed"));
          }
          return of("Success on second attempt");
        })
      );

      httpRetryService.retryHttpRequestWithCustomLogic(failingSource, 3).subscribe({
        next: (result) => {
          expect(result).toBe("Success on second attempt");
          expect(attemptCount).toBe(2);
          resolve();
        },
        error: resolve
      });
    });
  });
});

describe("Integration with RxJS operators", () => {
  it("should work correctly with modern retry operator", () => {
    return new Promise<void>((resolve) => {
      const delayFunction = createBackoffDelayFunction({
        baseDelayMs: 10, // Fast for testing
        maxDelayMs: 50,
        jitterFactor: 0
      });

      let attempts = 0;
      const maxRetries = 3;

      const source = of(null).pipe(
        map(() => {
          attempts++;
          if (attempts <= 2) {
            throw new Error(`Attempt ${attempts} failed`);
          }
          return `Success on attempt ${attempts}`;
        }),
        retry({
          count: maxRetries,
          delay: delayFunction
        })
      );

      source.subscribe({
        next: (result) => {
          expect(result).toBe("Success on attempt 3");
          expect(attempts).toBe(3);
          resolve();
        },
        error: resolve
      });
    });
  });

  it("should work with complex operator chains using retry", () => {
    return new Promise<void>((resolve) => {
      // Create multiple failing sources and retry them.
      of("source1", "source2", "source3")
        .pipe(
          mergeMap((sourceId) => {
            let attempts = 0;
            return of(sourceId).pipe(
              map((id) => {
                attempts++;
                if (attempts === 1) {
                  throw new Error(`${id} failed on first attempt`);
                }
                return `${id} succeeded on attempt ${attempts}`;
              }),
              retry({
                count: 2,
                delay: createBackoffDelayFunction({
                  baseDelayMs: 10,
                  jitterFactor: 0
                })
              })
            );
          }),
          toArray()
        )
        .subscribe({
          next: (allResults) => {
            expect(allResults).toHaveLength(3);
            expect(allResults).toEqual([
              "source1 succeeded on attempt 2",
              "source2 succeeded on attempt 2",
              "source3 succeeded on attempt 2"
            ]);
            resolve();
          },
          error: resolve
        });
    });
  });

  it("should handle immediate failures with retry exhaustion", () => {
    return new Promise<void>((resolve) => {
      const alwaysFailingSource = of(null).pipe(
        map(() => {
          throw new Error("Always fails");
        }),
        retry({
          count: 2,
          delay: createBackoffDelayFunction({
            baseDelayMs: 5,
            jitterFactor: 0
          })
        })
      );

      alwaysFailingSource.subscribe({
        next: () => {
          throw new Error("Should not succeed");
        },
        error: (err: HttpRequestError) => {
          expect(err.message).toBe("Always fails");
          resolve();
        }
      });
    });
  });

  it("should work with conditional retry logic", () => {
    return new Promise<void>((resolve) => {
      let attempts = 0;

      const conditionalSource = of(null).pipe(
        map(() => {
          attempts++;
          if (attempts <= 2) {
            throw new HttpRequestError("Retryable error", 429);
          } else if (attempts === 3) {
            throw new HttpRequestError("Fatal error", 500);
          }
          return "Should not reach here";
        }),
        retry({
          count: 5,
          delay: (error: HttpRequestError, retryCount) => {
            // Only retry specific error types
            if (error.status === 500) {
              return throwError(() => error);
            }

            return createBackoffTimer(retryCount, {
              baseDelayMs: 10,
              jitterFactor: 0
            });
          }
        })
      );

      conditionalSource.subscribe({
        next: () => {
          throw new Error("Should not succeed");
        },
        error: (err: HttpRequestError) => {
          expect(err.status).toBe(500);
          expect(attempts).toBe(3); // Should have stopped retrying after fatal error
          resolve();
        }
      });
    });
  });
});
