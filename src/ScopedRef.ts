/**
 * @since 1.0.0
 */
import type { LazyArg } from "@effect/data/Function"
import type * as Effect from "@effect/io/Effect"
import * as internal from "@effect/io/internal_effect_untraced/scopedRef"
import type * as Synchronized from "@effect/io/Ref/Synchronized"
import type * as Scope from "@effect/io/Scope"

/**
 * @since 1.0.0
 * @category symbols
 */
export const ScopedRefTypeId: unique symbol = internal.ScopedRefTypeId

/**
 * @since 1.0.0
 * @category symbols
 */
export type ScopedRefTypeId = typeof ScopedRefTypeId

/**
 * A `ScopedRef` is a reference whose value is associated with resources,
 * which must be released properly. You can both get the current value of any
 * `ScopedRef`, as well as set it to a new value (which may require new
 * resources). The reference itself takes care of properly releasing resources
 * for the old value whenever a new value is obtained.
 *
 * @since 1.0.0
 * @category models
 */
export interface ScopedRef<A> extends ScopedRef.Variance<A> {
  /** @internal */
  readonly ref: Synchronized.Synchronized<readonly [Scope.Scope.Closeable, A]>
}

/**
 * @since 1.0.0
 */
export declare namespace ScopedRef {
  /**
   * @since 1.0.0
   * @category models
   */
  export interface Variance<A> {
    readonly [ScopedRefTypeId]: {
      readonly _A: (_: never) => A
    }
  }
}

/**
 * Creates a new `ScopedRef` from an effect that resourcefully produces a
 * value.
 *
 * @since 1.0.0
 * @category constructors
 */
export const fromAcquire: <R, E, A>(
  acquire: Effect.Effect<R, E, A>
) => Effect.Effect<Scope.Scope | R, E, ScopedRef<A>> = internal.fromAcquire

/**
 * Retrieves the current value of the scoped reference.
 *
 * @since 1.0.0
 * @category getters
 */
export const get: <A>(self: ScopedRef<A>) => Effect.Effect<never, never, A> = internal.get

/**
 * Creates a new `ScopedRef` from the specified value. This method should
 * not be used for values whose creation require the acquisition of resources.
 *
 * @since 1.0.0
 * @category constructors
 */
export const make: <A>(evaluate: LazyArg<A>) => Effect.Effect<Scope.Scope, never, ScopedRef<A>> = internal.make

/**
 * Sets the value of this reference to the specified resourcefully-created
 * value. Any resources associated with the old value will be released.
 *
 * This method will not return until either the reference is successfully
 * changed to the new value, with old resources released, or until the attempt
 * to acquire a new value fails.
 *
 * @since 1.0.0
 * @category getters
 */
export const set: {
  <A, R, E>(acquire: Effect.Effect<R, E, A>): (self: ScopedRef<A>) => Effect.Effect<Exclude<R, Scope.Scope>, E, void>
  <A, R, E>(self: ScopedRef<A>, acquire: Effect.Effect<R, E, A>): Effect.Effect<Exclude<R, Scope.Scope>, E, void>
} = internal.set
