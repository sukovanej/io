import type * as Duration from "@effect/data/Duration"
import type * as Deferred from "@effect/io/Deferred"
import type * as FiberId from "@effect/io/Fiber/Id"

/**
 * `Sleep` represents the state of a scheduled effect, including the time the
 * effect is scheduled to run, a promise that can be completed to resume
 * execution of the effect, and the fiber executing the effect.
 *
 * @internal
 */
export interface Sleep {
  readonly duration: Duration.Duration
  readonly deferred: Deferred.Deferred<never, void>
  readonly fiberId: FiberId.FiberId
}

/** @internal */
export const make = (
  duration: Duration.Duration,
  deferred: Deferred.Deferred<never, void>,
  fiberId: FiberId.FiberId
): Sleep => ({
  duration,
  deferred,
  fiberId
})
