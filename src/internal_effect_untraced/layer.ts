import * as Context from "@effect/data/Context"
import * as Debug from "@effect/data/Debug"
import * as Duration from "@effect/data/Duration"
import type { LazyArg } from "@effect/data/Function"
import { dual, pipe } from "@effect/data/Function"
import * as Cause from "@effect/io/Cause"
import * as Clock from "@effect/io/Clock"
import type * as Effect from "@effect/io/Effect"
import type * as Exit from "@effect/io/Exit"
import type { FiberRef } from "@effect/io/FiberRef"
import type * as FiberRefsPatch from "@effect/io/FiberRefs/Patch"
import * as core from "@effect/io/internal_effect_untraced/core"
import * as effect from "@effect/io/internal_effect_untraced/effect"
import * as circular from "@effect/io/internal_effect_untraced/effect/circular"
import * as fiberRuntime from "@effect/io/internal_effect_untraced/fiberRuntime"
import * as EffectOpCodes from "@effect/io/internal_effect_untraced/opCodes/effect"
import * as OpCodes from "@effect/io/internal_effect_untraced/opCodes/layer"
import * as ref from "@effect/io/internal_effect_untraced/ref"
import * as runtime from "@effect/io/internal_effect_untraced/runtime"
import * as synchronized from "@effect/io/internal_effect_untraced/synchronizedRef"
import type * as Layer from "@effect/io/Layer"
import type * as Synchronized from "@effect/io/Ref/Synchronized"
import type * as Runtime from "@effect/io/Runtime"
import type * as Schedule from "@effect/io/Schedule"
import * as ScheduleDecision from "@effect/io/Schedule/Decision"
import * as Intervals from "@effect/io/Schedule/Intervals"
import * as Scope from "@effect/io/Scope"

/** @internal */
const LayerSymbolKey = "@effect/io/Layer"

/** @internal */
export const LayerTypeId: Layer.LayerTypeId = Symbol.for(
  LayerSymbolKey
) as Layer.LayerTypeId

/** @internal */
const layerVariance = {
  _RIn: (_: never) => _,
  _E: (_: never) => _,
  _ROut: (_: unknown) => _
}

/** @internal */
const proto = {
  [LayerTypeId]: layerVariance
}

/** @internal */
export type Primitive =
  | ExtendScope
  | Fold
  | Fresh
  | FromEffect
  | Scoped
  | Suspend
  | Locally
  | ProvideTo
  | ZipWith
  | ZipWithPar

/** @internal */
export type Op<Tag extends string, Body = {}> = Layer.Layer<unknown, unknown, unknown> & Body & {
  readonly _tag: Tag
}

/** @internal */
export interface ExtendScope extends
  Op<OpCodes.OP_EXTEND_SCOPE, {
    readonly layer: Layer.Layer<never, never, unknown>
  }>
{}

/** @internal */
export interface Fold extends
  Op<OpCodes.OP_FOLD, {
    readonly layer: Layer.Layer<never, never, unknown>
    readonly failureK: (cause: Cause.Cause<unknown>) => Layer.Layer<never, never, unknown>
    readonly successK: (context: Context.Context<unknown>) => Layer.Layer<never, never, unknown>
  }>
{}

/** @internal */
export interface Fresh extends
  Op<OpCodes.OP_FRESH, {
    readonly layer: Layer.Layer<never, never, unknown>
  }>
{}

/** @internal */
export interface FromEffect extends
  Op<OpCodes.OP_FROM_EFFECT, {
    readonly effect: Effect.Effect<unknown, unknown, Context.Context<unknown>>
  }>
{}

/** @internal */
export interface Scoped extends
  Op<OpCodes.OP_SCOPED, {
    readonly effect: Effect.Effect<unknown, unknown, Context.Context<unknown>>
  }>
{}

/** @internal */
export interface Suspend extends
  Op<OpCodes.OP_SUSPEND, {
    readonly evaluate: LazyArg<Layer.Layer<never, never, unknown>>
  }>
{}

/** @internal */
export interface Locally extends
  Op<"Locally", {
    readonly self: Layer.Layer<never, never, unknown>
    readonly f: (_: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>
  }>
{}

/** @internal */
export interface ProvideTo extends
  Op<OpCodes.OP_PROVIDE_TO, {
    readonly first: Layer.Layer<never, never, unknown>
    readonly second: Layer.Layer<never, never, unknown>
  }>
{}

/** @internal */
export interface ZipWith extends
  Op<OpCodes.OP_ZIP_WITH, {
    readonly first: Layer.Layer<never, never, unknown>
    readonly second: Layer.Layer<never, never, unknown>
    readonly zipK: (
      left: Context.Context<unknown>,
      right: Context.Context<unknown>
    ) => Context.Context<unknown>
  }>
{}

/** @internal */
export interface ZipWithPar extends
  Op<OpCodes.OP_ZIP_WITH_PAR, {
    readonly first: Layer.Layer<never, never, unknown>
    readonly second: Layer.Layer<never, never, unknown>
    readonly zipK: (
      left: Context.Context<unknown>,
      right: Context.Context<unknown>
    ) => Context.Context<unknown>
  }>
{}

/** @internal */
export const isLayer = (u: unknown): u is Layer.Layer<unknown, unknown, unknown> => {
  return typeof u === "object" && u != null && LayerTypeId in u
}

/** @internal */
export const isFresh = <R, E, A>(self: Layer.Layer<R, E, A>): boolean => {
  return (self as Primitive)._tag === OpCodes.OP_FRESH
}

// -----------------------------------------------------------------------------
// MemoMap
// -----------------------------------------------------------------------------

/** @internal */
class MemoMap {
  constructor(
    readonly ref: Synchronized.Synchronized<
      Map<
        Layer.Layer<any, any, any>,
        readonly [Effect.Effect<never, any, any>, Scope.Scope.Finalizer]
      >
    >
  ) {
  }

  /**
   * Checks the memo map to see if a layer exists. If it is, immediately
   * returns it. Otherwise, obtains the layer, stores it in the memo map,
   * and adds a finalizer to the `Scope`.
   */
  getOrElseMemoize<RIn, E, ROut>(
    layer: Layer.Layer<RIn, E, ROut>,
    scope: Scope.Scope
  ): Effect.Effect<RIn, E, Context.Context<ROut>> {
    return pipe(
      synchronized.modifyEffect(this.ref, (map) => {
        const inMap = map.get(layer)
        if (inMap !== undefined) {
          const [acquire, release] = inMap
          const cached: Effect.Effect<never, E, Context.Context<ROut>> = pipe(
            acquire as Effect.Effect<never, E, readonly [FiberRefsPatch.FiberRefsPatch, Context.Context<ROut>]>,
            core.flatMap(([patch, b]) => pipe(effect.patchFiberRefs(patch), core.as(b))),
            core.onExit(core.exitMatch(
              () => core.unit(),
              () => core.scopeAddFinalizerExit(scope, release)
            ))
          )
          return core.succeed([cached, map] as const)
        }
        return pipe(
          ref.make(0),
          core.flatMap((observers) =>
            pipe(
              core.deferredMake<E, readonly [FiberRefsPatch.FiberRefsPatch, Context.Context<ROut>]>(),
              core.flatMap((deferred) =>
                pipe(
                  ref.make<Scope.Scope.Finalizer>(() => core.unit()),
                  core.map((finalizerRef) => {
                    const resource = core.uninterruptibleMask((restore) =>
                      pipe(
                        fiberRuntime.scopeMake(),
                        core.flatMap((innerScope) =>
                          pipe(
                            restore(core.flatMap(
                              withScope(layer, innerScope),
                              (f) => effect.diffFiberRefs(f(this))
                            )),
                            core.exit,
                            core.flatMap((exit) => {
                              switch (exit._tag) {
                                case EffectOpCodes.OP_FAILURE: {
                                  return pipe(
                                    core.deferredFailCause(deferred, exit.i0),
                                    core.zipRight(core.scopeClose(innerScope, exit)),
                                    core.zipRight(core.failCause(exit.i0))
                                  )
                                }
                                case EffectOpCodes.OP_SUCCESS: {
                                  return pipe(
                                    ref.set(finalizerRef, (exit) =>
                                      pipe(
                                        core.scopeClose(innerScope, exit),
                                        core.whenEffect(
                                          ref.modify(observers, (n) => [n === 1, n - 1] as const)
                                        ),
                                        core.asUnit
                                      )),
                                    core.zipRight(ref.update(observers, (n) => n + 1)),
                                    core.zipRight(
                                      core.scopeAddFinalizerExit(scope, (exit) =>
                                        pipe(
                                          ref.get(finalizerRef),
                                          core.flatMap((finalizer) => finalizer(exit))
                                        ))
                                    ),
                                    core.zipRight(core.deferredSucceed(deferred, exit.i0)),
                                    core.as(exit.i0[1])
                                  )
                                }
                              }
                            })
                          )
                        )
                      )
                    )
                    const memoized = [
                      pipe(
                        core.deferredAwait(deferred),
                        core.onExit(core.exitMatchEffect(
                          () => core.unit(),
                          () => ref.update(observers, (n) => n + 1)
                        ))
                      ),
                      (exit: Exit.Exit<unknown, unknown>) =>
                        pipe(
                          ref.get(finalizerRef),
                          core.flatMap((finalizer) => finalizer(exit))
                        )
                    ] as const
                    return [
                      resource,
                      isFresh(layer) ? map : map.set(layer, memoized)
                    ] as const
                  })
                )
              )
            )
          )
        )
      }),
      core.flatten
    )
  }
}

const makeMemoMap = (): Effect.Effect<never, never, MemoMap> => {
  return pipe(
    circular.makeSynchronized<
      Map<
        Layer.Layer<any, any, any>,
        readonly [
          Effect.Effect<never, any, any>,
          Scope.Scope.Finalizer
        ]
      >
    >(new Map()),
    core.map((ref) => new MemoMap(ref))
  )
}

/** @internal */
export const build = Debug.methodWithTrace((trace) =>
  <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>): Effect.Effect<RIn | Scope.Scope, E, Context.Context<ROut>> =>
    fiberRuntime.scopeWith(
      (scope) => pipe(self, buildWithScope(scope))
    ).traced(trace)
)

/** @internal */
export const buildWithScope = Debug.dualWithTrace<
  (
    scope: Scope.Scope
  ) => <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>) => Effect.Effect<RIn, E, Context.Context<ROut>>,
  <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>,
    scope: Scope.Scope
  ) => Effect.Effect<RIn, E, Context.Context<ROut>>
>(2, (trace) =>
  (self, scope) =>
    core.flatMap(
      makeMemoMap(),
      (memoMap) => core.flatMap(withScope(self, scope), (run) => run(memoMap))
    ).traced(trace))

const withScope = <RIn, E, ROut>(
  self: Layer.Layer<RIn, E, ROut>,
  scope: Scope.Scope
): Effect.Effect<never, never, (memoMap: MemoMap) => Effect.Effect<RIn, E, Context.Context<ROut>>> => {
  const op = self as Primitive
  switch (op._tag) {
    case "Locally": {
      return core.sync(() => (memoMap: MemoMap) => op.f(memoMap.getOrElseMemoize(op.self, scope)))
    }
    case "ExtendScope": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          fiberRuntime.scopeWith(
            (scope) => memoMap.getOrElseMemoize(op.layer, scope)
          ) as unknown as Effect.Effect<RIn, E, Context.Context<ROut>>
      )
    }
    case "Fold": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          pipe(
            memoMap.getOrElseMemoize(op.layer, scope),
            core.matchCauseEffect(
              (cause) => memoMap.getOrElseMemoize(op.failureK(cause), scope),
              (value) => memoMap.getOrElseMemoize(op.successK(value), scope)
            )
          )
      )
    }
    case "Fresh": {
      return core.sync(() => (_: MemoMap) => pipe(op.layer, buildWithScope(scope)))
    }
    case "FromEffect": {
      return core.sync(() => (_: MemoMap) => op.effect as Effect.Effect<RIn, E, Context.Context<ROut>>)
    }
    case "ProvideTo": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          pipe(
            memoMap.getOrElseMemoize(op.first, scope),
            core.flatMap((env) =>
              pipe(
                memoMap.getOrElseMemoize(op.second, scope),
                core.provideContext(env)
              )
            )
          )
      )
    }
    case "Scoped": {
      return core.sync(() =>
        (_: MemoMap) =>
          fiberRuntime.scopeExtend(
            op.effect as Effect.Effect<RIn, E, Context.Context<ROut>>,
            scope
          )
      )
    }
    case "Suspend": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          memoMap.getOrElseMemoize(
            op.evaluate(),
            scope
          )
      )
    }
    case "ZipWith": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          pipe(
            memoMap.getOrElseMemoize(op.first, scope),
            core.zipWith(
              memoMap.getOrElseMemoize(op.second, scope),
              op.zipK
            )
          )
      )
    }
    case "ZipWithPar": {
      return core.sync(() =>
        (memoMap: MemoMap) =>
          pipe(
            memoMap.getOrElseMemoize(op.first, scope),
            circular.zipWithPar(
              memoMap.getOrElseMemoize(op.second, scope),
              op.zipK
            )
          )
      )
    }
  }
}

// -----------------------------------------------------------------------------
// Layer
// -----------------------------------------------------------------------------

/** @internal */
export const catchAll = Debug.untracedDual<
  <E, R2, E2, A2>(
    onError: (error: E) => Layer.Layer<R2, E2, A2>
  ) => <R, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2, E2, A & A2>,
  <R, E, A, R2, E2, A2>(
    self: Layer.Layer<R, E, A>,
    onError: (error: E) => Layer.Layer<R2, E2, A2>
  ) => Layer.Layer<R | R2, E2, A & A2>
>(2, (restore) => (self, onError) => matchLayer(self, restore(onError), succeedContext))

/** @internal */
export const catchAllCause = Debug.untracedDual<
  <E, R2, E2, A2>(
    onError: (cause: Cause.Cause<E>) => Layer.Layer<R2, E2, A2>
  ) => <R, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2, E2, A & A2>,
  <R, E, A, R2, E2, A2>(
    self: Layer.Layer<R, E, A>,
    onError: (cause: Cause.Cause<E>) => Layer.Layer<R2, E2, A2>
  ) => Layer.Layer<R | R2, E2, A & A2>
>(2, (restore) => (self, onError) => matchCauseLayer(self, restore(onError), succeedContext))

/** @internal */
export const die = (defect: unknown): Layer.Layer<never, never, unknown> => failCause(Cause.die(defect))

/** @internal */
export const dieSync = (evaluate: LazyArg<unknown>): Layer.Layer<never, never, unknown> =>
  failCauseSync(() => Cause.die(evaluate()))

/** @internal */
export const discard = <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>): Layer.Layer<RIn, E, never> =>
  map(self, () => Context.empty())

/** @internal */
export const context = <R>(): Layer.Layer<R, never, R> => fromEffectContext(core.context<R>())

/** @internal */
export const extendScope = <RIn, E, ROut>(
  self: Layer.Layer<RIn, E, ROut>
): Layer.Layer<RIn | Scope.Scope, E, ROut> => {
  const extendScope = Object.create(proto)
  extendScope._tag = OpCodes.OP_EXTEND_SCOPE
  extendScope.layer = self
  return extendScope
}

/** @internal */
export const fail = <E>(error: E): Layer.Layer<never, E, unknown> => failCause(Cause.fail(error))

/** @internal */
export const failSync = <E>(evaluate: LazyArg<E>): Layer.Layer<never, E, unknown> =>
  failCauseSync(() => Cause.fail(evaluate()))

/** @internal */
export const failCause = <E>(cause: Cause.Cause<E>): Layer.Layer<never, E, unknown> =>
  fromEffectContext(core.failCause(cause))

/** @internal */
export const failCauseSync = <E>(evaluate: LazyArg<Cause.Cause<E>>): Layer.Layer<never, E, unknown> =>
  fromEffectContext(core.failCauseSync(evaluate))

/** @internal */
export const flatMap = Debug.untracedDual<
  <A, R2, E2, A2>(
    f: (context: Context.Context<A>) => Layer.Layer<R2, E2, A2>
  ) => <R, E>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2, E | E2, A2>,
  <R, E, A, R2, E2, A2>(
    self: Layer.Layer<R, E, A>,
    f: (context: Context.Context<A>) => Layer.Layer<R2, E2, A2>
  ) => Layer.Layer<R | R2, E | E2, A2>
>(2, (restore) => (self, f) => matchLayer(self, fail, restore(f)))

/** @internal */
export const flatten = dual<
  <R2, E2, A, I>(
    tag: Context.Tag<I, Layer.Layer<R2, E2, A>>
  ) => <R, E>(
    self: Layer.Layer<R, E, I>
  ) => Layer.Layer<R | R2, E | E2, A>,
  <R, E, A, R2, E2, I>(
    self: Layer.Layer<R, E, I>,
    tag: Context.Tag<I, Layer.Layer<R2, E2, A>>
  ) => Layer.Layer<R | R2, E | E2, A>
>(2, (self, tag) => flatMap(self, Context.get(tag as any) as any))

/** @internal */
export const fresh = <R, E, A>(self: Layer.Layer<R, E, A>): Layer.Layer<R, E, A> => {
  const fresh = Object.create(proto)
  fresh._tag = OpCodes.OP_FRESH
  fresh.layer = self
  return fresh
}

/** @internal */
export const fromEffect = <T extends Context.Tag<any, any>, R, E>(
  tag: T,
  effect: Effect.Effect<R, E, Context.Tag.Service<T>>
): Layer.Layer<R, E, Context.Tag.Identifier<T>> =>
  fromEffectContext(core.map(effect, (service) => Context.make(tag, service)))

/** @internal */
export const fromEffectDiscard = <R, E, _>(effect: Effect.Effect<R, E, _>) =>
  fromEffectContext(core.map(effect, () => Context.empty()))

/** @internal */
export function fromEffectContext<R, E, A>(
  effect: Effect.Effect<R, E, Context.Context<A>>
): Layer.Layer<R, E, A> {
  const fromEffect = Object.create(proto)
  fromEffect._tag = OpCodes.OP_FROM_EFFECT
  fromEffect.effect = effect
  return fromEffect
}

/** @internal */
export const fiberRefLocally = dual<
  <X>(ref: FiberRef<X>, value: X) => <R, E, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R, E, A>,
  <R, E, A, X>(self: Layer.Layer<R, E, A>, ref: FiberRef<X>, value: X) => Layer.Layer<R, E, A>
>(3, (self, ref, value) => locallyEffect(self, core.fiberRefLocally(ref, value)))

/** @internal */
export const locallyEffect = dual<
  <RIn, E, ROut, RIn2, E2, ROut2>(
    f: (_: Effect.Effect<RIn, E, Context.Context<ROut>>) => Effect.Effect<RIn2, E2, Context.Context<ROut2>>
  ) => (self: Layer.Layer<RIn, E, ROut>) => Layer.Layer<RIn2, E2, ROut2>,
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer.Layer<RIn, E, ROut>,
    f: (_: Effect.Effect<RIn, E, Context.Context<ROut>>) => Effect.Effect<RIn2, E2, Context.Context<ROut2>>
  ) => Layer.Layer<RIn2, E2, ROut2>
>(2, (self, f) => {
  const locally = Object.create(proto)
  locally._tag = "Locally"
  locally.self = self
  locally.f = f
  return locally
})

/** @internal */
export const fiberRefLocallyWith = dual<
  <X>(ref: FiberRef<X>, value: (_: X) => X) => <R, E, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R, E, A>,
  <R, E, A, X>(self: Layer.Layer<R, E, A>, ref: FiberRef<X>, value: (_: X) => X) => Layer.Layer<R, E, A>
>(3, (self, ref, value) => locallyEffect(self, core.fiberRefLocallyWith(ref, value)))

/** @internal */
export const fiberRefLocallyScoped = <A>(self: FiberRef<A>, value: A): Layer.Layer<never, never, never> =>
  scopedDiscard(fiberRuntime.fiberRefLocallyScoped(self, value))

/** @internal */
export const fiberRefLocallyScopedWith = <A>(self: FiberRef<A>, value: (_: A) => A): Layer.Layer<never, never, never> =>
  scopedDiscard(fiberRuntime.fiberRefLocallyScopedWith(self, value))

/** @internal */
export const fromFunction = <A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
  tagA: A,
  tagB: B,
  f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
): Layer.Layer<Context.Tag.Identifier<A>, never, Context.Tag.Identifier<B>> =>
  fromEffectContext(core.map(tagA, (a) => Context.make(tagB, f(a))))

/** @internal */
export const launch = Debug.methodWithTrace((trace) =>
  <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>): Effect.Effect<RIn, E, never> =>
    fiberRuntime.scopedEffect(
      core.zipRight(
        fiberRuntime.scopeWith((scope) => pipe(self, buildWithScope(scope))),
        core.never()
      )
    ).traced(trace)
)

/** @internal */
export const map = Debug.untracedDual<
  <A, B>(
    f: (context: Context.Context<A>) => Context.Context<B>
  ) => <R, E>(self: Layer.Layer<R, E, A>) => Layer.Layer<R, E, B>,
  <R, E, A, B>(
    self: Layer.Layer<R, E, A>,
    f: (context: Context.Context<A>) => Context.Context<B>
  ) => Layer.Layer<R, E, B>
>(2, (restore) => (self, f) => flatMap(self, (context) => succeedContext(restore(f)(context))))

/** @internal */
export const mapError = Debug.untracedDual<
  <E, E2>(f: (error: E) => E2) => <R, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R, E2, A>,
  <R, E, A, E2>(self: Layer.Layer<R, E, A>, f: (error: E) => E2) => Layer.Layer<R, E2, A>
>(2, (restore) => (self, f) => catchAll(self, (error) => failSync(() => restore(f)(error))))

/** @internal */
export const matchCauseLayer = Debug.untracedDual<
  <E, A, R2, E2, A2, R3, E3, A3>(
    onFailure: (cause: Cause.Cause<E>) => Layer.Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer.Layer<R3, E3, A3>
  ) => <R>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2 | R3, E2 | E3, A2 & A3>,
  <R, E, A, R2, E2, A2, R3, E3, A3>(
    self: Layer.Layer<R, E, A>,
    onFailure: (cause: Cause.Cause<E>) => Layer.Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer.Layer<R3, E3, A3>
  ) => Layer.Layer<R | R2 | R3, E2 | E3, A2 & A3>
>(3, (restore) =>
  (self, onFailure, onSuccess) => {
    const fold = Object.create(proto)
    fold._tag = OpCodes.OP_FOLD
    fold.layer = self
    fold.failureK = restore(onFailure)
    fold.successK = restore(onSuccess)
    return fold
  })

/** @internal */
export const matchLayer = Debug.untracedDual<
  <E, R2, E2, A2, A, R3, E3, A3>(
    onFailure: (error: E) => Layer.Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer.Layer<R3, E3, A3>
  ) => <R>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2 | R3, E2 | E3, A2 & A3>,
  <R, E, A, R2, E2, A2, R3, E3, A3>(
    self: Layer.Layer<R, E, A>,
    onFailure: (error: E) => Layer.Layer<R2, E2, A2>,
    onSuccess: (context: Context.Context<A>) => Layer.Layer<R3, E3, A3>
  ) => Layer.Layer<R | R2 | R3, E2 | E3, A2 & A3>
>(3, (restore) =>
  (self, onFailure, onSuccess) =>
    matchCauseLayer(
      self,
      (cause) => {
        const failureOrCause = Cause.failureOrCause(cause)
        switch (failureOrCause._tag) {
          case "Left": {
            return restore(onFailure)(failureOrCause.left)
          }
          case "Right": {
            return failCause(failureOrCause.right)
          }
        }
      },
      restore(onSuccess)
    ))

/** @internal */
export const memoize = Debug.methodWithTrace((trace) =>
  <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ): Effect.Effect<Scope.Scope, never, Layer.Layer<RIn, E, ROut>> =>
    fiberRuntime.scopeWith((scope) =>
      pipe(
        effect.memoize(buildWithScope(self, scope)),
        core.map(fromEffectContext)
      )
    ).traced(trace)
)

/** @internal */
export const merge = dual<
  <RIn2, E2, ROut2>(
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>) => Layer.Layer<
    RIn | RIn2,
    E | E2,
    ROut | ROut2
  >,
  <RIn, E, ROut, RIn2, E2, ROut2>(self: Layer.Layer<RIn, E, ROut>, that: Layer.Layer<RIn2, E2, ROut2>) => Layer.Layer<
    RIn | RIn2,
    E | E2,
    ROut | ROut2
  >
>(2, (self, that) => zipWithPar(self, that, (a, b) => pipe(a, Context.merge(b))))

/** @internal */
export const mergeAll = <Layers extends [Layer.Layer<any, any, never>, ...Array<Layer.Layer<any, any, never>>]>(
  ...layers: Layers
): Layer.Layer<
  { [k in keyof Layers]: Layer.Layer.Context<Layers[k]> }[number],
  { [k in keyof Layers]: Layer.Layer.Error<Layers[k]> }[number],
  { [k in keyof Layers]: Layer.Layer.Success<Layers[k]> }[number]
> => {
  let final = layers[0]
  for (let i = 1; i < layers.length; i++) {
    final = merge(layers[i])(final)
  }
  return final as any
}

/** @internal */
export const orDie = <R, E, A>(self: Layer.Layer<R, E, A>): Layer.Layer<R, never, A> =>
  catchAll(self, (defect) => die(defect))

/** @internal */
export const orElse = Debug.untracedDual<
  <R2, E2, A2>(
    that: LazyArg<Layer.Layer<R2, E2, A2>>
  ) => <R, E, A>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2, E | E2, A & A2>,
  <R, E, A, R2, E2, A2>(
    self: Layer.Layer<R, E, A>,
    that: LazyArg<Layer.Layer<R2, E2, A2>>
  ) => Layer.Layer<R | R2, E | E2, A & A2>
>(2, (restore) => (self, that) => catchAll(self, restore(that)))

/** @internal */
export const passthrough = <RIn, E, ROut>(self: Layer.Layer<RIn, E, ROut>): Layer.Layer<RIn, E, RIn | ROut> =>
  merge(context<RIn>(), self)

/** @internal */
export const project = Debug.untracedDual<
  <A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
    tagA: A,
    tagB: B,
    f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
  ) => <RIn, E>(self: Layer.Layer<RIn, E, Context.Tag.Identifier<A>>) => Layer.Layer<RIn, E, Context.Tag.Identifier<B>>,
  <RIn, E, A extends Context.Tag<any, any>, B extends Context.Tag<any, any>>(
    self: Layer.Layer<RIn, E, Context.Tag.Identifier<A>>,
    tagA: A,
    tagB: B,
    f: (a: Context.Tag.Service<A>) => Context.Tag.Service<B>
  ) => Layer.Layer<RIn, E, Context.Tag.Identifier<B>>
>(4, (restore) =>
  (self, tagA, tagB, f) =>
    map(
      self,
      (context) => Context.make(tagB, restore(f)(Context.unsafeGet(context, tagA)))
    ))

/** @internal */
export const provide = dual<
  <RIn2, E2, ROut2>(
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>,
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer.Layer<RIn, E, ROut>,
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>
>(2, <RIn, E, ROut, RIn2, E2, ROut2>(
  self: Layer.Layer<RIn, E, ROut>,
  that: Layer.Layer<RIn2, E2, ROut2>
) =>
  suspend(() => {
    const provideTo = Object.create(proto)
    provideTo._tag = OpCodes.OP_PROVIDE_TO
    provideTo.first = Object.create(proto, {
      _tag: { value: OpCodes.OP_ZIP_WITH, enumerable: true },
      first: { value: context<Exclude<RIn2, ROut>>(), enumerable: true },
      second: { value: self },
      zipK: { value: (a: Context.Context<ROut>, b: Context.Context<ROut2>) => pipe(a, Context.merge(b)) }
    })
    provideTo.second = that
    return provideTo
  }))

/** @internal */
export const provideMerge = dual<
  <RIn2, E2, ROut2>(that: Layer.Layer<RIn2, E2, ROut2>) => <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut | ROut2>,
  <RIn, E, ROut, RIn2, E2, ROut2>(
    self: Layer.Layer<RIn, E, ROut>,
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut | ROut2>
>(2, <RIn, E, ROut, RIn2, E2, ROut2>(
  self: Layer.Layer<RIn, E, ROut>,
  that: Layer.Layer<RIn2, E2, ROut2>
) => {
  const zipWith = Object.create(proto)
  zipWith._tag = OpCodes.OP_ZIP_WITH
  zipWith.first = self
  zipWith.second = pipe(self, provide(that))
  zipWith.zipK = (a: Context.Context<ROut>, b: Context.Context<ROut2>): Context.Context<ROut | ROut2> => {
    return pipe(a, Context.merge(b))
  }
  return zipWith
})

/** @internal */
export const retry = dual<
  <RIn2, E, X>(
    schedule: Schedule.Schedule<RIn2, E, X>
  ) => <RIn, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ) => Layer.Layer<RIn | RIn2, E, ROut>,
  <RIn, E, ROut, RIn2, X>(
    self: Layer.Layer<RIn, E, ROut>,
    schedule: Schedule.Schedule<RIn2, E, X>
  ) => Layer.Layer<RIn | RIn2, E, ROut>
>(2, (self, schedule) =>
  suspend(() => {
    const stateTag = Context.Tag<{ state: unknown }>()
    return pipe(
      succeed(stateTag, { state: schedule.initial }),
      flatMap((env: Context.Context<{ state: unknown }>) =>
        retryLoop(self, schedule, stateTag, pipe(env, Context.get(stateTag)).state)
      )
    )
  }))

/** @internal */
const retryLoop = <RIn, E, ROut, RIn2, X>(
  self: Layer.Layer<RIn, E, ROut>,
  schedule: Schedule.Schedule<RIn2, E, X>,
  stateTag: Context.Tag<{ state: unknown }, { state: unknown }>,
  state: unknown
): Layer.Layer<RIn | RIn2, E, ROut> => {
  return pipe(
    self,
    catchAll((error) =>
      pipe(
        retryUpdate(schedule, stateTag, error, state),
        flatMap((env) => fresh(retryLoop(self, schedule, stateTag, pipe(env, Context.get(stateTag)).state)))
      )
    )
  )
}

/** @internal */
const retryUpdate = <RIn, E, X>(
  schedule: Schedule.Schedule<RIn, E, X>,
  stateTag: Context.Tag<{ state: unknown }, { state: unknown }>,
  error: E,
  state: unknown
): Layer.Layer<RIn, E, { state: unknown }> => {
  return fromEffect(
    stateTag,
    pipe(
      Clock.currentTimeMillis(),
      core.flatMap((now) =>
        pipe(
          schedule.step(now, error, state),
          core.flatMap(([state, _, decision]) =>
            ScheduleDecision.isDone(decision) ?
              core.fail(error) :
              pipe(
                Clock.sleep(Duration.millis(Intervals.start(decision.intervals) - now)),
                core.as({ state })
              )
          )
        )
      )
    )
  )
}

/** @internal */
export const scope = (): Layer.Layer<never, never, Scope.Scope.Closeable> => {
  return scopedContext(
    pipe(
      fiberRuntime.acquireRelease(
        fiberRuntime.scopeMake(),
        (scope, exit) => scope.close(exit)
      ),
      core.map((scope) => Context.make(Scope.Scope, scope))
    )
  )
}

/** @internal */
export const scoped = <T extends Context.Tag<any, any>, R, E>(
  tag: T,
  effect: Effect.Effect<R, E, Context.Tag.Service<T>>
): Layer.Layer<Exclude<R, Scope.Scope>, E, Context.Tag.Identifier<T>> => {
  return scopedContext(core.map(effect, (service) => Context.make(tag, service)))
}

/** @internal */
export const scopedDiscard = <R, E, _>(
  effect: Effect.Effect<R, E, _>
): Layer.Layer<Exclude<R, Scope.Scope>, E, never> => {
  return scopedContext(pipe(effect, core.as(Context.empty())))
}

/** @internal */
export const scopedContext = <R, E, A>(
  effect: Effect.Effect<R, E, Context.Context<A>>
): Layer.Layer<Exclude<R, Scope.Scope>, E, A> => {
  const scoped = Object.create(proto)
  scoped._tag = OpCodes.OP_SCOPED
  scoped.effect = effect
  return scoped
}

/** @internal */
export const service = <T extends Context.Tag<any, any>>(
  tag: T
): Layer.Layer<Context.Tag.Identifier<T>, never, Context.Tag.Identifier<T>> => {
  return fromEffect(tag, tag)
}

/** @internal */
export const succeed = <T extends Context.Tag<any, any>>(
  tag: T,
  resource: Context.Tag.Service<T>
): Layer.Layer<never, never, Context.Tag.Identifier<T>> => {
  return fromEffectContext(core.succeed(Context.make(tag, resource)))
}

/** @internal */
export const succeedContext = <A>(
  context: Context.Context<A>
): Layer.Layer<never, never, A> => {
  return fromEffectContext(core.succeed(context))
}

/** @internal */
export const suspend = <RIn, E, ROut>(
  evaluate: LazyArg<Layer.Layer<RIn, E, ROut>>
): Layer.Layer<RIn, E, ROut> => {
  const suspend = Object.create(proto)
  suspend._tag = OpCodes.OP_SUSPEND
  suspend.evaluate = evaluate
  return suspend
}

/** @internal */
export const sync = <T extends Context.Tag<any, any>>(
  tag: T,
  evaluate: LazyArg<Context.Tag.Service<T>>
): Layer.Layer<never, never, Context.Tag.Identifier<T>> => {
  return fromEffectContext(core.sync(() => Context.make(tag, evaluate())))
}

/** @internal */
export const syncContext = <A>(evaluate: LazyArg<Context.Context<A>>): Layer.Layer<never, never, A> => {
  return fromEffectContext(core.sync(evaluate))
}

/** @internal */
export const tap = Debug.untracedDual<
  <ROut, RIn2, E2, X>(
    f: (context: Context.Context<ROut>) => Effect.Effect<RIn2, E2, X>
  ) => <RIn, E>(self: Layer.Layer<RIn, E, ROut>) => Layer.Layer<RIn | RIn2, E | E2, ROut>,
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer.Layer<RIn, E, ROut>,
    f: (context: Context.Context<ROut>) => Effect.Effect<RIn2, E2, X>
  ) => Layer.Layer<RIn | RIn2, E | E2, ROut>
>(2, (restore) => (self, f) => flatMap(self, (context) => fromEffectContext(core.as(restore(f)(context), context))))

/** @internal */
export const tapError = Debug.untracedDual<
  <E, RIn2, E2, X>(
    f: (e: E) => Effect.Effect<RIn2, E2, X>
  ) => <RIn, ROut>(self: Layer.Layer<RIn, E, ROut>) => Layer.Layer<RIn | RIn2, E | E2, ROut>,
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer.Layer<RIn, E, ROut>,
    f: (e: E) => Effect.Effect<RIn2, E2, X>
  ) => Layer.Layer<RIn | RIn2, E | E2, ROut>
>(2, (restore) =>
  (self, f) =>
    catchAll(
      self,
      (e) => fromEffectContext(core.flatMap(restore(f)(e), () => core.fail(e)))
    ))

/** @internal */
export const tapErrorCause = Debug.untracedDual<
  <E, RIn2, E2, X>(
    f: (cause: Cause.Cause<E>) => Effect.Effect<RIn2, E2, X>
  ) => <RIn, ROut>(self: Layer.Layer<RIn, E, ROut>) => Layer.Layer<RIn | RIn2, E | E2, ROut>,
  <RIn, E, ROut, RIn2, E2, X>(
    self: Layer.Layer<RIn, E, ROut>,
    f: (cause: Cause.Cause<E>) => Effect.Effect<RIn2, E2, X>
  ) => Layer.Layer<RIn | RIn2, E | E2, ROut>
>(2, (restore) =>
  (self, f) =>
    catchAllCause(
      self,
      (cause) => fromEffectContext(core.flatMap(restore(f)(cause), () => core.failCause(cause)))
    ))

/** @internal */
export const toRuntime = <RIn, E, ROut>(
  self: Layer.Layer<RIn, E, ROut>
): Effect.Effect<RIn | Scope.Scope, E, Runtime.Runtime<ROut>> => {
  return pipe(
    fiberRuntime.scopeWith((scope) => pipe(self, buildWithScope(scope))),
    core.flatMap((context) =>
      pipe(
        runtime.runtime<ROut>(),
        core.provideContext(context)
      )
    )
  )
}

/** @internal */
export const use = dual<
  <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ) => <RIn2, E2, ROut2>(
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>,
  <RIn2, E2, ROut2, RIn, E, ROut>(
    that: Layer.Layer<RIn2, E2, ROut2>,
    self: Layer.Layer<RIn, E, ROut>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E | E2, ROut2>
>(2, <RIn2, E2, ROut2, RIn, E, ROut>(
  that: Layer.Layer<RIn2, E2, ROut2>,
  self: Layer.Layer<RIn, E, ROut>
) =>
  suspend(() => {
    const provideTo = Object.create(proto)
    provideTo._tag = OpCodes.OP_PROVIDE_TO
    provideTo.first = Object.create(proto, {
      _tag: { value: OpCodes.OP_ZIP_WITH, enumerable: true },
      first: { value: context<Exclude<RIn2, ROut>>(), enumerable: true },
      second: { value: self },
      zipK: { value: (a: Context.Context<ROut>, b: Context.Context<ROut2>) => pipe(a, Context.merge(b)) }
    })
    provideTo.second = that
    return provideTo
  }))

/** @internal */
export const useMerge = dual<
  <RIn, E, ROut>(
    self: Layer.Layer<RIn, E, ROut>
  ) => <RIn2, E2, ROut2>(
    that: Layer.Layer<RIn2, E2, ROut2>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut | ROut2>,
  <RIn2, E2, ROut2, RIn, E, ROut>(
    that: Layer.Layer<RIn2, E2, ROut2>,
    self: Layer.Layer<RIn, E, ROut>
  ) => Layer.Layer<RIn | Exclude<RIn2, ROut>, E2 | E, ROut | ROut2>
>(2, <RIn2, E2, ROut2, RIn, E, ROut>(that: Layer.Layer<RIn2, E2, ROut2>, self: Layer.Layer<RIn, E, ROut>) => {
  const zipWith = Object.create(proto)
  zipWith._tag = OpCodes.OP_ZIP_WITH
  zipWith.first = self
  zipWith.second = pipe(self, provide(that))
  zipWith.zipK = (a: Context.Context<ROut>, b: Context.Context<ROut2>): Context.Context<ROut | ROut2> => {
    return pipe(a, Context.merge(b))
  }
  return zipWith
})

/** @internal */
export const zipWithPar = Debug.untracedDual<
  <R2, E2, B, A, C>(
    that: Layer.Layer<R2, E2, B>,
    f: (a: Context.Context<A>, b: Context.Context<B>) => Context.Context<C>
  ) => <R, E>(self: Layer.Layer<R, E, A>) => Layer.Layer<R | R2, E | E2, C>,
  <R, E, R2, E2, B, A, C>(
    self: Layer.Layer<R, E, A>,
    that: Layer.Layer<R2, E2, B>,
    f: (a: Context.Context<A>, b: Context.Context<B>) => Context.Context<C>
  ) => Layer.Layer<R | R2, E | E2, C>
>(3, (restore) =>
  (self, that, f) =>
    suspend(() => {
      const zipWithPar = Object.create(proto)
      zipWithPar._tag = OpCodes.OP_ZIP_WITH_PAR
      zipWithPar.first = self
      zipWithPar.second = that
      zipWithPar.zipK = restore(f)
      return zipWithPar
    }))

// circular with Effect

/** @internal */
export const provideLayer = Debug.dualWithTrace<
  <R0, E2, R>(layer: Layer.Layer<R0, E2, R>) => <E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R0, E | E2, A>,
  <R, E, A, R0, E2>(self: Effect.Effect<R, E, A>, layer: Layer.Layer<R0, E2, R>) => Effect.Effect<R0, E | E2, A>
>(2, (trace) =>
  (self, layer) =>
    core.acquireUseRelease(
      fiberRuntime.scopeMake(),
      (scope) =>
        core.flatMap(
          buildWithScope(layer, scope),
          (context) => core.provideContext(self, context)
        ),
      (scope, exit) => core.scopeClose(scope, exit)
    ).traced(trace))

/** @internal */
export const provideSomeLayer: {
  <R2, E2, A2>(
    layer: Layer.Layer<R2, E2, A2>
  ): <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R2 | Exclude<R, A2>, E | E2, A>
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    layer: Layer.Layer<R2, E2, A2>
  ): Effect.Effect<R2 | Exclude<R, A2>, E | E2, A>
} = Debug.dualWithTrace(2, (trace) => (self, layer) => provideLayer(self, pipe(context(), merge(layer))).traced(trace))

/** @internal */
export const toLayer = dual<
  <I, A>(tag: Context.Tag<I, A>) => <R, E>(self: Effect.Effect<R, E, A>) => Layer.Layer<R, E, I>,
  <R, E, A, I>(self: Effect.Effect<R, E, A>, tag: Context.Tag<I, A>) => Layer.Layer<R, E, I>
>(2, (self, tag) => fromEffect(tag, self))

/** @internal */
export const toLayerScoped = dual<
  <I, A>(tag: Context.Tag<I, A>) => <R, E>(self: Effect.Effect<R, E, A>) => Layer.Layer<Exclude<R, Scope.Scope>, E, I>,
  <R, E, I, A>(self: Effect.Effect<R, E, A>, tag: Context.Tag<I, A>) => Layer.Layer<Exclude<R, Scope.Scope>, E, I>
>(2, (self, tag) => scoped(tag, self))
