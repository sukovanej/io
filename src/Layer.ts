/**
 * A `Layer<RIn, E, ROut>` describes how to build one or more services in your
 * application. Services can be injected into effects via
 * `Effect.provideService`. Effects can require services via `Effect.service`.
 *
 * Layer can be thought of as recipes for producing bundles of services, given
 * their dependencies (other services).
 *
 * Construction of services can be effectful and utilize resources that must be
 * acquired and safely released when the services are done being utilized.
 *
 * By default layers are shared, meaning that if the same layer is used twice
 * the layer will only be allocated a single time.
 *
 * Because of their excellent composition properties, layers are the idiomatic
 * way in Effect-TS to create services that depend on other services.
 *
 * @since 1.0.0
 */
import * as Context from "@effect/data/Context"
import type { LazyArg } from "@effect/data/Function"
import type * as Cause from "@effect/io/Cause"
import type * as Effect from "@effect/io/Effect"
import type { FiberRef } from "@effect/io/FiberRef"
import * as internal from "@effect/io/internal_effect_untraced/layer"
import type * as Runtime from "@effect/io/Runtime"
import type * as Schedule from "@effect/io/Schedule"
import type * as Scope from "@effect/io/Scope"

/**
 * @since 1.0.0
 * @category symbols
 */
export const LayerTypeId: unique symbol = internal.LayerTypeId

/**
 * @since 1.0.0
 * @category symbols
 */
export type LayerTypeId = typeof LayerTypeId

/**
 * @since 1.0.0
 * @category models
 */
export interface Layer<RIn, E, ROut> extends Layer.Variance<RIn, E, ROut> {}

/**
 * @since 1.0.0
 */
export declare namespace Layer {
  /**
   * @since 1.0.0
   * @category models
   */
  export interface Variance<RIn, E, ROut> {
    readonly [LayerTypeId]: {
      readonly _RIn: (_: never) => RIn
      readonly _E: (_: never) => E
      readonly _ROut: (_: ROut) => void
    }
  }
  /**
   * @since 1.0.0
   * @category type-level
   */
  export type Context<T extends Layer<any, any, never>> = [T] extends [Layer<infer _R, infer _E, infer _A>] ? _R : never
  /**
   * @since 1.0.0
   * @category type-level
   */
  export type Error<T extends Layer<any, any, never>> = [T] extends [Layer<infer _R, infer _E, infer _A>] ? _E : never
  /**
   * @since 1.0.0
   * @category type-level
   */
  export type Success<T extends Layer<any, any, never>> = [T] extends [Layer<infer _R, infer _E, infer _A>] ? _A : never
}

/**
 * Returns `true` if the specified value is a `Layer`, `false` otherwise.
 *
 * @since 1.0.0
 * @category getters
 */
export const isLayer: (u: unknown) => u is Layer<unknown, unknown, unknown> = internal.isLayer

/**
 * Returns `true` if the specified `Layer` is a fresh version that will not be
 * shared, `false` otherwise.
 *
 * @since 1.0.0
 * @category getters
 */
export const isFresh: <R, E, A>(self: Layer<R, E, A>) => boolean = internal.isFresh

/**
 * Builds a layer into a scoped value.
 *
 * @since 1.0.0
 * @category destructors
 */
export const build: <RIn, E, ROut>(
  self: Layer<RIn, E, ROut>
) => Effect.Effect<Scope.Scope | RIn, E, Context.Context<ROut>> = internal.build

/**
 * Builds a layer into an `Effect` value. Any resources associated with this
 * layer will be released when the specified scope is closed unless their scope
 * has been extended. This allows building layers where the lifetime of some of
 * the services output by the layer exceed the lifetime of the effect the
 * layer is provided to.
 *
 * @since 1.0.0
 * @category destructors
 */
export const buildWithScope: {
  (scope: Scope.Scope): <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Effect.Effect<RIn, E, Context.Context<ROut>>
  <RIn, E, ROut>(self: Layer<RIn, E, ROut>, scope: Scope.Scope): Effect.Effect<RIn, E, Context.Context<ROut>>
} = internal.buildWithScope

/**
 * Recovers from all errors.
 *
 * @since 1.0.0
 * @category error handling
 */
export const catchAll: {
  <E, R2, E2, A2>(onError: (error: E) => Layer<R2, E2, A2>): <R, A>(self: Layer<R, E, A>) => Layer<R2 | R, E2, A & A2>
  <R, E, A, R2, E2, A2>(self: Layer<R, E, A>, onError: (error: E) => Layer<R2, E2, A2>): Layer<R | R2, E2, A & A2>
} = internal.catchAll

/**
 * Recovers from all errors.
 *
 * @since 1.0.0
 * @category error handling
 */
export const catchAllCause: {
  <E, R2, E2, A2>(
    onError: (cause: Cause.Cause<E>) => Layer<R2, E2, A2>
  ): <R, A>(self: Layer<R, E, A>) => Layer<R2 | R, E2, A & A2>
  <R, E, A, R2, E2, A2>(
    self: Layer<R, E, A>,
    onError: (cause: Cause.Cause<E>) => Layer<R2, E2, A2>
  ): Layer<R | R2, E2, A & A2>
} = internal.catchAllCause

/**
 * Constructs a `Layer` that passes along the specified context as an
 * output.
 *
 * @since 1.0.0
 * @category constructors
 */
export const context: <R>() => Layer<R, never, R> = internal.context

/**
 * Constructs a layer that dies with the specified defect.
 *
 * @since 1.0.0
 * @category constructors
 */
export const die: (defect: unknown) => Layer<never, never, unknown> = internal.die

/**
 * Constructs a layer that dies with the specified defect.
 *
 * @since 1.0.0
 * @category constructors
 */
export const dieSync: (evaluate: LazyArg<unknown>) => Layer<never, never, unknown> = internal.dieSync

/**
 * Replaces the layer's output with `void` and includes the layer only for its
 * side-effects.
 *
 * @since 1.0.0
 * @category mapping
 */
export const discard: <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn, E, never> = internal.discard

/**
 * Constructs a layer from the specified effect.
 *
 * @since 1.0.0
 * @category constructors
 */
export const effect: <T extends Context.Tag<any, any>, R, E>(
  tag: T,
  effect: Effect.Effect<R, E, Context.Tag.Service<T>>
) => Layer<R, E, Context.Tag.Identifier<T>> = internal.fromEffect

/**
 * Constructs a layer from the specified effect discarding it's output.
 *
 * @since 1.0.0
 * @category constructors
 */
export const effectDiscard: <R, E, _>(effect: Effect.Effect<R, E, _>) => Layer<R, E, never> = internal.fromEffectDiscard

/**
 * Constructs a layer from the specified effect, which must return one or more
 * services.
 *
 * @since 1.0.0
 * @category constructors
 */
export const effectContext: <R, E, A>(effect: Effect.Effect<R, E, Context.Context<A>>) => Layer<R, E, A> =
  internal.fromEffectContext

/**
 * Extends the scope of this layer, returning a new layer that when provided
 * to an effect will not immediately release its associated resources when
 * that effect completes execution but instead when the scope the resulting
 * effect depends on is closed.
 *
 * @since 1.0.0
 * @category utils
 */
export const extendScope: <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<Scope.Scope | RIn, E, ROut> =
  internal.extendScope

/**
 * Constructs a layer that fails with the specified error.
 *
 * @since 1.0.0
 * @category constructors
 */
export const fail: <E>(error: E) => Layer<never, E, unknown> = internal.fail

/**
 * Constructs a layer that fails with the specified error.
 *
 * @since 1.0.0
 * @category constructors
 */
export const failSync: <E>(evaluate: LazyArg<E>) => Layer<never, E, unknown> = internal.failSync

/**
 * Constructs a layer that fails with the specified cause.
 *
 * @since 1.0.0
 * @category constructors
 */
export const failCause: <E>(cause: Cause.Cause<E>) => Layer<never, E, unknown> = internal.failCause

/**
 * Constructs a layer that fails with the specified cause.
 *
 * @since 1.0.0
 * @category constructors
 */
export const failCauseSync: <E>(evaluate: LazyArg<Cause.Cause<E>>) => Layer<never, E, unknown> = internal.failCauseSync

/**
 * Constructs a layer dynamically based on the output of this layer.
 *
 * @since 1.0.0
 * @category sequencing
 */
export const flatMap: {
  <A, R2, E2, A2>(
    f: (context: Context.Context<A>) => Layer<R2, E2, A2>
  ): <R, E>(self: Layer<R, E, A>) => Layer<R2 | R, E2 | E, A2>
  <R, E, A, R2, E2, A2>(
    self: Layer<R, E, A>,
    f: (context: Context.Context<A>) => Layer<R2, E2, A2>
  ): Layer<R | R2, E | E2, A2>
} = internal.flatMap

/**
 * Flattens layers nested in the context of an effect.
 *
 * @since 1.0.0
 * @category sequencing
 */
export const flatten: {
  <R2, E2, A, I>(tag: Context.Tag<I, Layer<R2, E2, A>>): <R, E>(self: Layer<R, E, I>) => Layer<R2 | R, E2 | E, A>
  <R, E, A, R2, E2, I>(self: Layer<R, E, I>, tag: Context.Tag<I, Layer<R2, E2, A>>): Layer<R | R2, E | E2, A>
} = internal.flatten

/**
 * Creates a fresh version of this layer that will not be shared.
 *
 * @since 1.0.0
 * @category utils
 */
export const fresh: <R, E, A>(self: Layer<R, E, A>) => Layer<R, E, A> = internal.fresh

const fromFunction: <A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
  tagA: A,
  tagB: B,
  f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
) => Layer<Context.Tag.Identifier<A>, never, Context.Tag.Identifier<B>> = internal.fromFunction

export {
  /**
   * Constructs a layer from the context using the specified function.
   *
   * @since 1.0.0
   * @category constructors
   */
  fromFunction as function
}

/**
 * Builds this layer and uses it until it is interrupted. This is useful when
 * your entire application is a layer, such as an HTTP server.
 *
 * @since 1.0.0
 * @category conversions
 */
export const launch: <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Effect.Effect<RIn, E, never> = internal.launch

/**
 * Returns a new layer whose output is mapped by the specified function.
 *
 * @since 1.0.0
 * @category mapping
 */
export const map: {
  <A, B>(f: (context: Context.Context<A>) => Context.Context<B>): <R, E>(self: Layer<R, E, A>) => Layer<R, E, B>
  <R, E, A, B>(self: Layer<R, E, A>, f: (context: Context.Context<A>) => Context.Context<B>): Layer<R, E, B>
} = internal.map

/**
 * Returns a layer with its error channel mapped using the specified function.
 *
 * @since 1.0.0
 * @category mapping
 */
export const mapError: {
  <E, E2>(f: (error: E) => E2): <R, A>(self: Layer<R, E, A>) => Layer<R, E2, A>
  <R, E, A, E2>(self: Layer<R, E, A>, f: (error: E) => E2): Layer<R, E2, A>
} = internal.mapError

/**
 * Feeds the error or output services of this layer into the input of either
 * the specified `failure` or `success` layers, resulting in a new layer with
 * the inputs of this layer, and the error or outputs of the specified layer.
 *
 * @since 1.0.0
 * @category folding
 */
export const matchLayer: {
  <E, R2, E2, A2, A, R3, E3, A3>(
    onFailure: (error: E) => Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer<R3, E3, A3>
  ): <R>(self: Layer<R, E, A>) => Layer<R2 | R3 | R, E2 | E3, A2 & A3>
  <R, E, A, R2, E2, A2, R3, E3, A3>(
    self: Layer<R, E, A>,
    onFailure: (error: E) => Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer<R3, E3, A3>
  ): Layer<R | R2 | R3, E2 | E3, A2 & A3>
} = internal.matchLayer

/**
 * Feeds the error or output services of this layer into the input of either
 * the specified `failure` or `success` layers, resulting in a new layer with
 * the inputs of this layer, and the error or outputs of the specified layer.
 *
 * @since 1.0.0
 * @category folding
 */
export const matchCauseLayer: {
  <E, A, R2, E2, A2, R3, E3, A3>(
    onFailure: (cause: Cause.Cause<E>) => Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer<R3, E3, A3>
  ): <R>(self: Layer<R, E, A>) => Layer<R2 | R3 | R, E2 | E3, A2 & A3>
  <R, E, A, R2, E2, A2, R3, E3, A3>(
    self: Layer<R, E, A>,
    onFailure: (cause: Cause.Cause<E>) => Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer<R3, E3, A3>
  ): Layer<R | R2 | R3, E2 | E3, A2 & A3>
} = internal.matchCauseLayer

/**
 * Returns a scoped effect that, if evaluated, will return the lazily computed
 * result of this layer.
 *
 * @since 1.0.0
 * @category utils
 */
export const memoize: <RIn, E, ROut>(
  self: Layer<RIn, E, ROut>
) => Effect.Effect<Scope.Scope, never, Layer<RIn, E, ROut>> = internal.memoize

/**
 * Combines this layer with the specified layer, producing a new layer that
 * has the inputs and outputs of both.
 *
 * @since 1.0.0
 * @category utils
 */
export const merge: {
  <RIn2, E2, ROut2>(
    that: Layer<RIn2, E2, ROut2>
  ): <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn2 | RIn, E2 | E, ROut2 | ROut>
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer<RIn, E, ROut>,
    that: Layer<RIn2, E2, ROut2>
  ): Layer<RIn | RIn2, E | E2, ROut | ROut2>
} = internal.merge

/**
 * Merges all the layers together in parallel.
 *
 * @since 1.0.0
 * @category zipping
 */
export const mergeAll: <Layers extends [Layer<any, any, never>, ...Array<Layer<any, any, never>>]>(
  ...layers: Layers
) => Layer<
  { [k in keyof Layers]: Layer.Context<Layers[k]> }[number],
  { [k in keyof Layers]: Layer.Error<Layers[k]> }[number],
  { [k in keyof Layers]: Layer.Success<Layers[k]> }[number]
> = internal.mergeAll

/**
 * Translates effect failure into death of the fiber, making all failures
 * unchecked and not a part of the type of the layer.
 *
 * @since 1.0.0
 * @category error handling
 */
export const orDie: <R, E, A>(self: Layer<R, E, A>) => Layer<R, never, A> = internal.orDie

/**
 * Executes this layer and returns its output, if it succeeds, but otherwise
 * executes the specified layer.
 *
 * @since 1.0.0
 * @category error handling
 */
export const orElse: {
  <R2, E2, A2>(that: LazyArg<Layer<R2, E2, A2>>): <R, E, A>(self: Layer<R, E, A>) => Layer<R2 | R, E2 | E, A & A2>
  <R, E, A, R2, E2, A2>(self: Layer<R, E, A>, that: LazyArg<Layer<R2, E2, A2>>): Layer<R | R2, E | E2, A & A2>
} = internal.orElse

/**
 * Returns a new layer that produces the outputs of this layer but also
 * passes through the inputs.
 *
 * @since 1.0.0
 * @category utils
 */
export const passthrough: <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn, E, RIn | ROut> = internal.passthrough

/**
 * Projects out part of one of the services output by this layer using the
 * specified function.
 *
 * @since 1.0.0
 * @category utils
 */
export const project: {
  <A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
    tagA: A,
    tagB: B,
    f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
  ): <RIn, E>(self: Layer<RIn, E, Context.Tag.Identifier<A>>) => Layer<RIn, E, Context.Tag.Identifier<B>>
  <RIn, E, A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
    self: Layer<RIn, E, Context.Tag.Identifier<A>>,
    tagA: A,
    tagB: B,
    f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
  ): Layer<RIn, E, Context.Tag.Identifier<B>>
} = internal.project

/**
 * Feeds the output services of this builder into the input of the specified
 * builder, resulting in a new builder with the inputs of this builder as
 * well as any leftover inputs, and the outputs of the specified builder.
 *
 * @since 1.0.0
 * @category utils
 */
export const provide: {
  <RIn2, E2, ROut2>(
    that: Layer<RIn2, E2, ROut2>
  ): <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut2>
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer<RIn, E, ROut>,
    that: Layer<RIn2, E2, ROut2>
  ): Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>
} = internal.provide

/**
 * @since 1.0.0
 * @category utils
 */
export const locallyEffect: {
  <RIn, E, ROut, RIn2, E2, ROut2>(
    f: (_: Effect.Effect<RIn, E, Context.Context<ROut>>) => Effect.Effect<RIn2, E2, Context.Context<ROut2>>
  ): (self: Layer<RIn, E, ROut>) => Layer<RIn2, E2, ROut2>
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer<RIn, E, ROut>,
    f: (_: Effect.Effect<RIn, E, Context.Context<ROut>>) => Effect.Effect<RIn2, E2, Context.Context<ROut2>>
  ): Layer<RIn2, E2, ROut2>
} = internal.locallyEffect

/**
 * @since 1.0.0
 * @category utils
 */
export const locally: {
  <X>(
    ref: FiberRef<X>,
    value: X
  ): <R, E, A>(self: Layer<R, E, A>) => Layer<R, E, A>
  <R, E, A, X>(
    self: Layer<R, E, A>,
    ref: FiberRef<X>,
    value: X
  ): Layer<R, E, A>
} = internal.fiberRefLocally

/**
 * @since 1.0.0
 * @category utils
 */
export const locallyWith: {
  <X>(ref: FiberRef<X>, value: (_: X) => X): <R, E, A>(self: Layer<R, E, A>) => Layer<R, E, A>
  <R, E, A, X>(self: Layer<R, E, A>, ref: FiberRef<X>, value: (_: X) => X): Layer<R, E, A>
} = internal.fiberRefLocallyWith

/**
 * @since 1.0.0
 * @category utils
 */
export const locallyScoped: <A>(self: FiberRef<A>, value: A) => Layer<never, never, never> =
  internal.fiberRefLocallyScoped

/**
 * @since 1.0.0
 * @category utils
 */
export const fiberRefLocallyScopedWith: <A>(self: FiberRef<A>, value: (_: A) => A) => Layer<never, never, never> =
  internal.fiberRefLocallyScopedWith

/**
 * Feeds the output services of this layer into the input of the specified
 * layer, resulting in a new layer with the inputs of this layer, and the
 * outputs of both layers.
 *
 * @since 1.0.0
 * @category utils
 */
export const provideMerge: {
  <RIn2, E2, ROut2>(
    that: Layer<RIn2, E2, ROut2>
  ): <RIn, E, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut2 | ROut>
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer<RIn, E, ROut>,
    that: Layer<RIn2, E2, ROut2>
  ): Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut | ROut2>
} = internal.provideMerge

/**
 * Retries constructing this layer according to the specified schedule.
 *
 * @since 1.0.0
 * @category retrying
 */
export const retry: {
  <RIn2, E, X>(
    schedule: Schedule.Schedule<RIn2, E, X>
  ): <RIn, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn2 | RIn, E, ROut>
  <RIn, E, ROut, RIn2, X>(
    self: Layer<RIn, E, ROut>,
    schedule: Schedule.Schedule<RIn2, E, X>
  ): Layer<RIn | RIn2, E, ROut>
} = internal.retry

/**
 * A layer that constructs a scope and closes it when the workflow the layer
 * is provided to completes execution, whether by success, failure, or
 * interruption. This can be used to close a scope when providing a layer to a
 * workflow.
 *
 * @since 1.0.0
 * @category constructors
 */
export const scope: (_: void) => Layer<never, never, Scope.CloseableScope> = internal.scope

/**
 * Constructs a layer from the specified scoped effect.
 *
 * @since 1.0.0
 * @category constructors
 */
export const scoped: <T extends Context.Tag<any, any>, R, E>(
  tag: T,
  effect: Effect.Effect<R, E, Context.Tag.Service<T>>
) => Layer<Exclude<R, Scope.Scope>, E, Context.Tag.Identifier<T>> = internal.scoped

/**
 * Constructs a layer from the specified scoped effect.
 *
 * @since 1.0.0
 * @category constructors
 */
export const scopedDiscard: <R, E, T>(effect: Effect.Effect<R, E, T>) => Layer<Exclude<R, Scope.Scope>, E, never> =
  internal.scopedDiscard

/**
 * Constructs a layer from the specified scoped effect, which must return one
 * or more services.
 *
 * @since 1.0.0
 * @category constructors
 */
export const scopedContext: <R, E, A>(
  effect: Effect.Effect<R, E, Context.Context<A>>
) => Layer<Exclude<R, Scope.Scope>, E, A> = internal.scopedContext

/**
 * Constructs a layer that accesses and returns the specified service from the
 * context.
 *
 * @since 1.0.0
 * @category constructors
 */
export const service: <T extends Context.Tag<any, any>>(
  tag: T
) => Layer<Context.Tag.Identifier<T>, never, Context.Tag.Identifier<T>> = internal.service

/**
 * Constructs a layer from the specified value.
 *
 * @since 1.0.0
 * @category constructors
 */
export const succeed: <T extends Context.Tag<any, any>>(
  tag: T,
  resource: Context.Tag.Service<T>
) => Layer<never, never, Context.Tag.Identifier<T>> = internal.succeed

/**
 * Constructs a layer from the specified value, which must return one or more
 * services.
 *
 * @since 1.0.0
 * @category constructors
 */
export const succeedContext: <A>(context: Context.Context<A>) => Layer<never, never, A> = internal.succeedContext

/**
 * Lazily constructs a layer. This is useful to avoid infinite recursion when
 * creating layers that refer to themselves.
 *
 * @since 1.0.0
 * @category constructors
 */
export const suspend: <RIn, E, ROut>(evaluate: LazyArg<Layer<RIn, E, ROut>>) => Layer<RIn, E, ROut> = internal.suspend

/**
 * Lazily constructs a layer from the specified value.
 *
 * @since 1.0.0
 * @category constructors
 */
export const sync: <T extends Context.Tag<any, any>>(
  tag: T,
  evaluate: LazyArg<Context.Tag.Service<T>>
) => Layer<never, never, Context.Tag.Identifier<T>> = internal.sync

/**
 * Lazily constructs a layer from the specified value, which must return one or more
 * services.
 *
 * @since 1.0.0
 * @category constructors
 */
export const syncContext: <A>(evaluate: LazyArg<Context.Context<A>>) => Layer<never, never, A> = internal.syncContext

/**
 * Performs the specified effect if this layer succeeds.
 *
 * @since 1.0.0
 * @category sequencing
 */
export const tap: {
  <ROut, RIn2, E2, X>(
    f: (context: Context.Context<ROut>) => Effect.Effect<RIn2, E2, X>
  ): <RIn, E>(self: Layer<RIn, E, ROut>) => Layer<RIn2 | RIn, E2 | E, ROut>
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer<RIn, E, ROut>,
    f: (context: Context.Context<ROut>) => Effect.Effect<RIn2, E2, X>
  ): Layer<RIn | RIn2, E | E2, ROut>
} = internal.tap

/**
 * Performs the specified effect if this layer fails.
 *
 * @since 1.0.0
 * @category sequencing
 */
export const tapError: {
  <E, RIn2, E2, X>(
    f: (e: E) => Effect.Effect<RIn2, E2, X>
  ): <RIn, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn2 | RIn, E | E2, ROut>
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer<RIn, E, ROut>,
    f: (e: E) => Effect.Effect<RIn2, E2, X>
  ): Layer<RIn | RIn2, E | E2, ROut>
} = internal.tapError

/**
 * Performs the specified effect if this layer fails.
 *
 * @since 1.0.0
 * @category sequencing
 */
export const tapErrorCause: {
  <E, RIn2, E2, X>(
    f: (cause: Cause.Cause<E>) => Effect.Effect<RIn2, E2, X>
  ): <RIn, ROut>(self: Layer<RIn, E, ROut>) => Layer<RIn2 | RIn, E | E2, ROut>
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer<RIn, E, ROut>,
    f: (cause: Cause.Cause<E>) => Effect.Effect<RIn2, E2, X>
  ): Layer<RIn | RIn2, E | E2, ROut>
} = internal.tapErrorCause

/**
 * Converts a layer that requires no services into a scoped runtime, which can
 * be used to execute effects.
 *
 * @since 1.0.0
 * @category conversions
 */
export const toRuntime: <RIn, E, ROut>(
  self: Layer<RIn, E, ROut>
) => Effect.Effect<Scope.Scope | RIn, E, Runtime.Runtime<ROut>> = internal.toRuntime

/**
 * Feeds the output services of this builder into the input of the specified
 * builder, resulting in a new builder with the inputs of this builder as
 * well as any leftover inputs, and the outputs of the specified builder.
 *
 * @since 1.0.0
 * @category utils
 */
export const use: {
  <RIn, E, ROut>(
    self: Layer<RIn, E, ROut>
  ): <RIn2, E2, ROut2>(that: Layer<RIn2, E2, ROut2>) => Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>
  <RIn2, E2, ROut2, RIn, E, ROut>(
    that: Layer<RIn2, E2, ROut2>,
    self: Layer<RIn, E, ROut>
  ): Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut2>
} = internal.use

/**
 * Feeds the output services of this layer into the input of the specified
 * layer, resulting in a new layer with the inputs of this layer, and the
 * outputs of both layers.
 *
 * @since 1.0.0
 * @category utils
 */
export const useMerge: {
  <RIn, E, ROut>(
    self: Layer<RIn, E, ROut>
  ): <RIn2, E2, ROut2>(that: Layer<RIn2, E2, ROut2>) => Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut | ROut2>
  <RIn2, E2, ROut2, RIn, E, ROut>(
    that: Layer<RIn2, E2, ROut2>,
    self: Layer<RIn, E, ROut>
  ): Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut2 | ROut>
} = internal.useMerge

/**
 * Combines this layer the specified layer, producing a new layer that has the
 * inputs of both, and the outputs of both combined using the specified
 * function.
 *
 * @since 1.0.0
 * @category zipping
 */
export const zipWithPar: {
  <R2, E2, B, A, C>(
    that: Layer<R2, E2, B>,
    f: (a: Context.Context<A>, b: Context.Context<B>) => Context.Context<C>
  ): <R, E>(self: Layer<R, E, A>) => Layer<R2 | R, E2 | E, C>
  <R, E, R2, E2, B, A, C>(
    self: Layer<R, E, A>,
    that: Layer<R2, E2, B>,
    f: (a: Context.Context<A>, b: Context.Context<B>) => Context.Context<C>
  ): Layer<R | R2, E | E2, C>
} = internal.zipWithPar

/**
 * @since 1.0.0
 * @category utils
 */
export const unwrapEffect = <R, E, R1, E1, A>(
  self: Effect.Effect<R, E, Layer<R1, E1, A>>
): Layer<R | R1, E | E1, A> => {
  const tag = Context.Tag<Layer<R1, E1, A>>()
  return internal.flatMap(internal.fromEffect(tag, self), (context) => Context.get(context, tag))
}

/**
 * @since 1.0.0
 * @category utils
 */
export const unwrapScoped = <R, E, R1, E1, A>(
  self: Effect.Effect<R, E, Layer<R1, E1, A>>
): Layer<R1 | Exclude<R, Scope.Scope>, E | E1, A> => {
  const tag = Context.Tag<Layer<R1, E1, A>>()
  return internal.flatMap(internal.scoped(tag, self), (context) => Context.get(context, tag))
}
