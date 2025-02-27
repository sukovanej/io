import * as Debug from "@effect/data/Debug"
import type * as Duration from "@effect/data/Duration"
import * as Either from "@effect/data/Either"
import * as Equal from "@effect/data/Equal"
import type { LazyArg } from "@effect/data/Function"
import { pipe } from "@effect/data/Function"
import * as Hash from "@effect/data/Hash"
import * as MutableHashMap from "@effect/data/MutableHashMap"
import * as Option from "@effect/data/Option"
import { tuple } from "@effect/data/ReadonlyArray"
import type { Equivalence } from "@effect/data/typeclass/Equivalence"
import type * as Cause from "@effect/io/Cause"
import type * as Deferred from "@effect/io/Deferred"
import type * as Effect from "@effect/io/Effect"
import * as ExecutionStrategy from "@effect/io/ExecutionStrategy"
import * as Exit from "@effect/io/Exit"
import type * as Fiber from "@effect/io/Fiber"
import * as FiberId from "@effect/io/Fiber/Id"
import type * as FiberRefsPatch from "@effect/io/FiberRefs/Patch"
import * as internalCause from "@effect/io/internal_effect_untraced/cause"
import * as core from "@effect/io/internal_effect_untraced/core"
import * as effect from "@effect/io/internal_effect_untraced/effect"
import * as internalFiber from "@effect/io/internal_effect_untraced/fiber"
import * as fiberRuntime from "@effect/io/internal_effect_untraced/fiberRuntime"
import * as internalRef from "@effect/io/internal_effect_untraced/ref"
import * as _schedule from "@effect/io/internal_effect_untraced/schedule"
import * as supervisor from "@effect/io/internal_effect_untraced/supervisor"
import type * as Ref from "@effect/io/Ref"
import type * as Synchronized from "@effect/io/Ref/Synchronized"
import type * as Schedule from "@effect/io/Schedule"
import type * as Scope from "@effect/io/Scope"
import type * as Supervisor from "@effect/io/Supervisor"

/** @internal */
class Semaphore {
  public waiters = new Array<() => void>()
  public taken = 0

  constructor(readonly permits: number) {}

  get free() {
    return this.permits - this.taken
  }

  readonly take = (n: number): Effect.Effect<never, never, number> =>
    Debug.bodyWithTrace((trace) =>
      core.asyncInterruptEither<never, never, number>((resume) => {
        if (this.free < n) {
          const observer = () => {
            if (this.free >= n) {
              const observerIndex = this.waiters.findIndex((cb) => cb === observer)
              if (observerIndex !== -1) {
                this.waiters.splice(observerIndex, 1)
              }
              this.taken += n
              resume(core.succeed(n))
            }
          }
          this.waiters.push(observer)
          return Either.left(core.sync(() => {
            const observerIndex = this.waiters.findIndex((cb) => cb === observer)
            if (observerIndex !== -1) {
              this.waiters.splice(observerIndex, 1)
            }
          }))
        }
        this.taken += n
        return Either.right(core.succeed(n))
      }).traced(trace)
    )

  readonly release = (n: number): Effect.Effect<never, never, void> =>
    Debug.bodyWithTrace((trace) =>
      core.withFiberRuntime<never, never, void>((fiber) => {
        this.taken -= n
        fiber.getFiberRef(core.currentScheduler).scheduleTask(() => {
          this.waiters.forEach((wake) => wake())
        })
        return core.unit()
      }).traced(trace)
    )

  readonly withPermits = (n: number) =>
    Debug.bodyWithTrace((trace) =>
      <R, E, A>(self: Effect.Effect<R, E, A>) =>
        Debug.untraced(() =>
          core.uninterruptibleMask((restore) =>
            core.flatMap(
              restore(this.take(n)),
              (permits) => fiberRuntime.ensuring(restore(self), this.release(permits))
            )
          )
        ).traced(trace)
    )
}

/** @internal */
export const unsafeMakeSemaphore = (leases: number) => {
  return new Semaphore(leases)
}

/** @internal */
export const makeSemaphore = Debug.methodWithTrace((trace) =>
  (permits: number) => core.sync(() => unsafeMakeSemaphore(permits)).traced(trace)
)

/** @internal */
export const acquireReleaseInterruptible = Debug.methodWithTrace((trace, restore) =>
  <R, E, A, R2, X>(
    acquire: Effect.Effect<R, E, A>,
    release: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<R2, never, X>
  ): Effect.Effect<R | R2 | Scope.Scope, E, A> =>
    fiberRuntime.ensuring(acquire, fiberRuntime.addFinalizer(restore(release))).traced(trace)
)

/** @internal */
export const awaitAllChildren = Debug.methodWithTrace((trace) =>
  <R, E, A>(self: Effect.Effect<R, E, A>): Effect.Effect<R, E, A> =>
    ensuringChildren(self, fiberRuntime.fiberAwaitAll).traced(trace)
)

/** @internal */
export const cached = Debug.dualWithTrace<
  (
    timeToLive: Duration.Duration
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, never, Effect.Effect<never, E, A>>,
  <R, E, A>(
    self: Effect.Effect<R, E, A>,
    timeToLive: Duration.Duration
  ) => Effect.Effect<R, never, Effect.Effect<never, E, A>>
>(2, (trace) => (self, timeToLive) => core.map(cachedInvalidate(self, timeToLive), (tuple) => tuple[0]).traced(trace))

/** @internal */
export const cachedInvalidate = Debug.dualWithTrace<
  (
    timeToLive: Duration.Duration
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R, never, [Effect.Effect<never, E, A>, Effect.Effect<never, never, void>]>,
  <R, E, A>(
    self: Effect.Effect<R, E, A>,
    timeToLive: Duration.Duration
  ) => Effect.Effect<R, never, [Effect.Effect<never, E, A>, Effect.Effect<never, never, void>]>
>(
  2,
  (trace) =>
    <R, E, A>(self: Effect.Effect<R, E, A>, timeToLive: Duration.Duration) =>
      core.flatMap(
        core.context<R>(),
        (env) =>
          core.map(
            makeSynchronized<Option.Option<[number, Deferred.Deferred<E, A>]>>(Option.none()),
            (cache) =>
              [
                core.provideContext(getCachedValue(self, timeToLive, cache), env),
                invalidateCache(cache)
              ] as [Effect.Effect<never, E, A>, Effect.Effect<never, never, void>]
          )
      ).traced(trace)
)

/** @internal */
const computeCachedValue = <R, E, A>(
  self: Effect.Effect<R, E, A>,
  timeToLive: Duration.Duration,
  start: number
): Effect.Effect<R, never, Option.Option<readonly [number, Deferred.Deferred<E, A>]>> =>
  pipe(
    core.deferredMake<E, A>(),
    core.tap((deferred) => core.intoDeferred(self, deferred)),
    core.map((deferred) => Option.some([start + timeToLive.millis, deferred] as const))
  )

/** @internal */
const getCachedValue = <R, E, A>(
  self: Effect.Effect<R, E, A>,
  timeToLive: Duration.Duration,
  cache: Synchronized.Synchronized<Option.Option<readonly [number, Deferred.Deferred<E, A>]>>
): Effect.Effect<R, E, A> =>
  core.uninterruptibleMask<R, E, A>((restore) =>
    pipe(
      effect.clockWith((clock) => clock.currentTimeMillis()),
      core.flatMap((time) =>
        updateSomeAndGetEffectSynchronized(cache, (option) => {
          switch (option._tag) {
            case "None": {
              return Option.some(computeCachedValue(self, timeToLive, time))
            }
            case "Some": {
              const [end] = option.value
              return end - time <= 0
                ? Option.some(computeCachedValue(self, timeToLive, time))
                : Option.none()
            }
          }
        })
      ),
      core.flatMap((option) =>
        Option.isNone(option) ?
          core.dieMessage(
            "BUG: Effect.cachedInvalidate - please report an issue at https://github.com/Effect-TS/io/issues"
          ) :
          restore(core.deferredAwait(option.value[1]))
      )
    )
  )

/** @internal */
const invalidateCache = <E, A>(
  cache: Synchronized.Synchronized<Option.Option<readonly [number, Deferred.Deferred<E, A>]>>
): Effect.Effect<never, never, void> => internalRef.set(cache, Option.none())

/** @internal */
export const ensuringChild = Debug.dualWithTrace<
  <R2, X>(
    f: (fiber: Fiber.Fiber<any, Array<unknown>>) => Effect.Effect<R2, never, X>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E, A>,
  <R, E, A, R2, X>(
    self: Effect.Effect<R, E, A>,
    f: (fiber: Fiber.Fiber<any, Array<unknown>>) => Effect.Effect<R2, never, X>
  ) => Effect.Effect<R | R2, E, A>
>(
  2,
  (trace, restore) =>
    (self, f) =>
      ensuringChildren(
        self,
        (children) => restore(f)(fiberRuntime.fiberCollectAll(children))
      ).traced(trace)
)

/** @internal */
export const ensuringChildren = Debug.dualWithTrace<
  <R1, X>(
    children: (fibers: Array<Fiber.RuntimeFiber<any, any>>) => Effect.Effect<R1, never, X>
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R | R1, E, A>,
  <R, E, A, R1, X>(
    self: Effect.Effect<R, E, A>,
    children: (fibers: Array<Fiber.RuntimeFiber<any, any>>) => Effect.Effect<R1, never, X>
  ) => Effect.Effect<R | R1, E, A>
>(2, (trace, restore) =>
  (self, children) =>
    core.flatMap(supervisor.track(), (supervisor) =>
      pipe(
        self,
        supervised(supervisor),
        fiberRuntime.ensuring(core.flatMap(supervisor.value(), restore(children)))
      )).traced(trace))

/** @internal */
export const forkAll = Debug.methodWithTrace((trace) =>
  <R, E, A>(
    effects: Iterable<Effect.Effect<R, E, A>>
  ): Effect.Effect<R, never, Fiber.Fiber<E, Array<A>>> =>
    core.map(core.forEach(effects, fiberRuntime.fork), fiberRuntime.fiberCollectAll).traced(trace)
)

/** @internal */
export const forkIn = Debug.dualWithTrace<
  (scope: Scope.Scope) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, never, Fiber.RuntimeFiber<E, A>>,
  <R, E, A>(self: Effect.Effect<R, E, A>, scope: Scope.Scope) => Effect.Effect<R, never, Fiber.RuntimeFiber<E, A>>
>(
  2,
  (trace) =>
    (self, scope) =>
      core.uninterruptibleMask((restore) =>
        core.flatMap(scope.fork(ExecutionStrategy.sequential), (child) =>
          pipe(
            restore(self),
            core.onExit((exit) => child.close(exit)),
            fiberRuntime.forkDaemon,
            core.tap((fiber) =>
              child.addFinalizer(() =>
                core.fiberIdWith((fiberId) =>
                  Equal.equals(fiberId, fiber.id()) ?
                    core.unit() :
                    core.asUnit(core.interruptFiber(fiber))
                )
              )
            )
          ))
      ).traced(trace)
)

/** @internal */
export const forkScoped = Debug.methodWithTrace((trace) =>
  <R, E, A>(
    self: Effect.Effect<R, E, A>
  ): Effect.Effect<R | Scope.Scope, never, Fiber.RuntimeFiber<E, A>> =>
    fiberRuntime.scopeWith((scope) => forkIn(self, scope)).traced(trace)
)

/** @internal */
export const fromFiber = Debug.methodWithTrace((trace) =>
  <E, A>(fiber: Fiber.Fiber<E, A>): Effect.Effect<never, E, A> => internalFiber.join(fiber).traced(trace)
)

/** @internal */
export const fromFiberEffect = Debug.methodWithTrace((trace) =>
  <R, E, A>(fiber: Effect.Effect<R, E, Fiber.Fiber<E, A>>): Effect.Effect<R, E, A> =>
    core.suspend(() => core.flatMap(fiber, internalFiber.join)).traced(trace)
)

const memoKeySymbol = Symbol.for("@effect/io/Effect/memoizeFunction.key")

class Key<A> implements Equal.Equal {
  [memoKeySymbol] = memoKeySymbol
  constructor(readonly a: A, readonly eq?: Equivalence<A>) {}
  [Equal.symbol](that: Equal.Equal) {
    if (typeof that === "object" && that !== null && memoKeySymbol in that) {
      if (this.eq) {
        return this.eq(this.a, (that as unknown as Key<A>).a)
      } else {
        return Equal.equals(this.a, (that as unknown as Key<A>).a)
      }
    }
    return false
  }
  [Hash.symbol]() {
    return this.eq ? 0 : Hash.hash(this.a)
  }
}

/** @internal */
export const memoizeFunction = Debug.methodWithTrace((trace) =>
  <R, E, A, B>(
    f: (a: A) => Effect.Effect<R, E, B>,
    eq?: Equivalence<A>
  ): Effect.Effect<never, never, (a: A) => Effect.Effect<R, E, B>> => {
    return pipe(
      core.sync(() =>
        MutableHashMap.empty<Key<A>, Deferred.Deferred<E, readonly [FiberRefsPatch.FiberRefsPatch, B]>>()
      ),
      core.flatMap(makeSynchronized),
      core.map((ref) =>
        (a: A) =>
          pipe(
            ref.modifyEffect((map) => {
              const result = pipe(map, MutableHashMap.get(new Key(a, eq)))
              if (Option.isNone(result)) {
                return pipe(
                  core.deferredMake<E, readonly [FiberRefsPatch.FiberRefsPatch, B]>(),
                  core.tap((deferred) =>
                    pipe(
                      effect.diffFiberRefs(f(a)),
                      core.intoDeferred(deferred),
                      fiberRuntime.fork
                    )
                  ),
                  core.map((deferred) => [deferred, pipe(map, MutableHashMap.set(new Key(a, eq), deferred))] as const)
                )
              }
              return core.succeed([result.value, map] as const)
            }),
            core.flatMap(core.deferredAwait),
            core.flatMap(([patch, b]) => pipe(effect.patchFiberRefs(patch), core.as(b)))
          )
      )
    ).traced(trace)
  }
)

/** @internal */
export const raceEither = Debug.dualWithTrace<
  <R2, E2, A2>(
    that: Effect.Effect<R2, E2, A2>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E | E2, Either.Either<A, A2>>,
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) => Effect.Effect<R | R2, E | E2, Either.Either<A, A2>>
>(
  2,
  (trace) => (self, that) => fiberRuntime.race(core.map(self, Either.left), core.map(that, Either.right)).traced(trace)
)

/** @internal */
export const raceFirst = Debug.dualWithTrace<
  <R2, E2, A2>(
    that: Effect.Effect<R2, E2, A2>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E2 | E, A2 | A>,
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) => Effect.Effect<R | R2, E2 | E, A2 | A>
>(2, (trace) =>
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) =>
    pipe(
      core.exit(self),
      fiberRuntime.race(core.exit(that)),
      (effect: Effect.Effect<R | R2, never, Exit.Exit<E | E2, A | A2>>) => core.flatten(effect)
    ).traced(trace))

/** @internal */
export const scheduleForked = Debug.dualWithTrace<
  <R2, Out>(
    schedule: Schedule.Schedule<R2, unknown, Out>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2 | Scope.Scope, never, Fiber.RuntimeFiber<E, Out>>,
  <R, E, A, R2, Out>(
    self: Effect.Effect<R, E, A>,
    schedule: Schedule.Schedule<R2, unknown, Out>
  ) => Effect.Effect<R | R2 | Scope.Scope, never, Fiber.RuntimeFiber<E, Out>>
>(2, (trace) => (self, schedule) => pipe(self, _schedule.schedule_Effect(schedule), forkScoped).traced(trace))

/** @internal */
export const supervised = Debug.dualWithTrace<
  <X>(supervisor: Supervisor.Supervisor<X>) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E, A>,
  <R, E, A, X>(self: Effect.Effect<R, E, A>, supervisor: Supervisor.Supervisor<X>) => Effect.Effect<R, E, A>
>(2, (trace) =>
  (self, supervisor) => {
    const supervise = core.fiberRefLocallyWith(fiberRuntime.currentSupervisor, (s) => s.zip(supervisor))
    return supervise(self).traced(trace)
  })

/** @internal */
export const timeout = Debug.dualWithTrace<
  (duration: Duration.Duration) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E, Option.Option<A>>,
  <R, E, A>(self: Effect.Effect<R, E, A>, duration: Duration.Duration) => Effect.Effect<R, E, Option.Option<A>>
>(2, (trace) => (self, duration) => timeoutTo(self, Option.none(), Option.some, duration).traced(trace))

/** @internal */
export const timeoutFail = Debug.dualWithTrace<
  <E1>(
    evaluate: LazyArg<E1>,
    duration: Duration.Duration
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E | E1, A>,
  <R, E, A, E1>(
    self: Effect.Effect<R, E, A>,
    evaluate: LazyArg<E1>,
    duration: Duration.Duration
  ) => Effect.Effect<R, E | E1, A>
>(
  3,
  (trace, restore) =>
    (self, evaluate, duration) =>
      core.flatten(timeoutTo(self, core.failSync(restore(evaluate)), core.succeed, duration)).traced(trace)
)

/** @internal */
export const timeoutFailCause = Debug.dualWithTrace<
  <E1>(
    evaluate: LazyArg<Cause.Cause<E1>>,
    duration: Duration.Duration
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E | E1, A>,
  <R, E, A, E1>(
    self: Effect.Effect<R, E, A>,
    evaluate: LazyArg<Cause.Cause<E1>>,
    duration: Duration.Duration
  ) => Effect.Effect<R, E | E1, A>
>(
  3,
  (trace, restore) =>
    (self, evaluate, duration) =>
      core.flatten(timeoutTo(self, core.failCauseSync(restore(evaluate)), core.succeed, duration)).traced(trace)
)

/** @internal */
export const timeoutTo = Debug.dualWithTrace<
  <A, B, B1>(
    def: B1,
    f: (a: A) => B,
    duration: Duration.Duration
  ) => <R, E>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E, B | B1>,
  <R, E, A, B, B1>(
    self: Effect.Effect<R, E, A>,
    def: B1,
    f: (a: A) => B,
    duration: Duration.Duration
  ) => Effect.Effect<R, E, B | B1>
>(4, (trace, restore) =>
  (self, def, f, duration) =>
    raceFirst(
      core.map(self, restore(f)),
      pipe(
        effect.sleep(duration),
        core.as(def),
        core.interruptible
      )
    ).traced(trace))

/** @internal */
export const validatePar = Debug.dualWithTrace<
  <R1, E1, B>(
    that: Effect.Effect<R1, E1, B>
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R | R1, E | E1, [A, B]>,
  <R, E, A, R1, E1, B>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R1, E1, B>
  ) => Effect.Effect<R | R1, E | E1, [A, B]>
>(2, (trace) => (self, that) => validateWithPar(self, that, (a, b) => tuple(a, b)).traced(trace))

/** @internal */
export const validateWithPar = Debug.dualWithTrace<
  <A, R1, E1, B, C>(
    that: Effect.Effect<R1, E1, B>,
    f: (a: A, b: B) => C
  ) => <R, E>(self: Effect.Effect<R, E, A>) => Effect.Effect<R | R1, E | E1, C>,
  <R, E, A, R1, E1, B, C>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R1, E1, B>,
    f: (a: A, b: B) => C
  ) => Effect.Effect<R | R1, E | E1, C>
>(3, (trace, restore) =>
  (self, that, f) =>
    core.flatten(zipWithPar(
      core.exit(self),
      core.exit(that),
      (ea, eb) => pipe(ea, core.exitZipWith(eb, restore(f), (ca, cb) => internalCause.parallel(ca, cb)))
    )).traced(trace))

/** @internal */
export const zipPar = Debug.dualWithTrace<
  <R2, E2, A2>(
    that: Effect.Effect<R2, E2, A2>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E | E2, [A, A2]>,
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) => Effect.Effect<R | R2, E | E2, [A, A2]>
>(2, (trace) =>
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ): Effect.Effect<R | R2, E | E2, [A, A2]> => zipWithPar(self, that, (a, b) => [a, b] as [A, A2]).traced(trace))

/** @internal */
export const zipParLeft = Debug.dualWithTrace<
  <R2, E2, A2>(
    that: Effect.Effect<R2, E2, A2>
  ) => <R, E, A>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E | E2, A>,
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) => Effect.Effect<R | R2, E | E2, A>
>(2, (trace) => (self, that) => zipWithPar(self, that, (a, _) => a).traced(trace))

/** @internal */
export const zipParRight = Debug.dualWithTrace<
  <R2, E2, A2>(
    that: Effect.Effect<R2, E2, A2>
  ) => <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R | R2, E | E2, A2>,
  <R, E, A, R2, E2, A2>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>
  ) => Effect.Effect<R | R2, E | E2, A2>
>(2, (trace) => (self, that) => zipWithPar(self, that, (_, b) => b).traced(trace))

/** @internal */
export const zipWithPar: {
  <R2, E2, A2, A, B>(
    that: Effect.Effect<R2, E2, A2>,
    f: (a: A, b: A2) => B
  ): <R, E>(self: Effect.Effect<R, E, A>) => Effect.Effect<R2 | R, E2 | E, B>
  <R, E, A, R2, E2, A2, B>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>,
    f: (a: A, b: A2) => B
  ): Effect.Effect<R | R2, E | E2, B>
} = Debug.dualWithTrace<
  <R2, E2, A2, A, B>(
    that: Effect.Effect<R2, E2, A2>,
    f: (a: A, b: A2) => B
  ) => <R, E>(
    self: Effect.Effect<R, E, A>
  ) => Effect.Effect<R | R2, E | E2, B>,
  <R, E, A, R2, E2, A2, B>(
    self: Effect.Effect<R, E, A>,
    that: Effect.Effect<R2, E2, A2>,
    f: (a: A, b: A2) => B
  ) => Effect.Effect<R | R2, E | E2, B>
>(
  3,
  (trace, restoreTrace) =>
    <R, E, A, R2, E2, A2, B>(
      self: Effect.Effect<R, E, A>,
      that: Effect.Effect<R2, E2, A2>,
      f: (a: A, b: A2) => B
    ): Effect.Effect<R | R2, E | E2, B> =>
      core.map(fiberRuntime.allPar(self, that), ([a, a2]) => restoreTrace(f)(a, a2)).traced(trace)
)

// circular with Synchronized

/** @internal */
const SynchronizedSymbolKey = "@effect/io/Ref/Synchronized"

/** @internal */
export const SynchronizedTypeId: Synchronized.SynchronizedTypeId = Symbol.for(
  SynchronizedSymbolKey
) as Synchronized.SynchronizedTypeId

/** @internal */
export const synchronizedVariance = {
  _A: (_: never) => _
}

/** @internal */
class SynchronizedImpl<A> implements Synchronized.Synchronized<A> {
  readonly [SynchronizedTypeId] = synchronizedVariance
  readonly [internalRef.RefTypeId] = internalRef.refVariance
  constructor(
    readonly ref: Ref.Ref<A>,
    readonly withLock: <R, E, A>(self: Effect.Effect<R, E, A>) => Effect.Effect<R, E, A>
  ) {}
  modify<B>(f: (a: A) => readonly [B, A]): Effect.Effect<never, never, B> {
    return Debug.bodyWithTrace((trace, restore) => this.modifyEffect((a) => core.succeed(restore(f)(a))).traced(trace))
  }
  modifyEffect<R, E, B>(f: (a: A) => Effect.Effect<R, E, readonly [B, A]>): Effect.Effect<R, E, B> {
    return Debug.bodyWithTrace((trace, restore) =>
      this.withLock(
        pipe(
          core.flatMap(internalRef.get(this.ref), restore(f)),
          core.flatMap(([b, a]) => core.as(internalRef.set(this.ref, a), b))
        )
      ).traced(trace)
    )
  }
}

/** @internal */
export const makeSynchronized = Debug.methodWithTrace((trace) =>
  <A>(value: A): Effect.Effect<never, never, Synchronized.Synchronized<A>> =>
    core.sync(() => unsafeMakeSynchronized(value)).traced(trace)
)

/** @internal */
export const unsafeMakeSynchronized = <A>(value: A): Synchronized.Synchronized<A> => {
  const ref = internalRef.unsafeMake(value)
  const sem = unsafeMakeSemaphore(1)
  return new SynchronizedImpl(ref, sem.withPermits(1))
}

/** @internal */
export const updateSomeAndGetEffectSynchronized = Debug.dualWithTrace<
  <A, R, E>(
    pf: (a: A) => Option.Option<Effect.Effect<R, E, A>>
  ) => (self: Synchronized.Synchronized<A>) => Effect.Effect<R, E, A>,
  <A, R, E>(
    self: Synchronized.Synchronized<A>,
    pf: (a: A) => Option.Option<Effect.Effect<R, E, A>>
  ) => Effect.Effect<R, E, A>
>(2, (trace, restore) =>
  (self, pf) =>
    self.modifyEffect((value) => {
      const result = restore(pf)(value)
      switch (result._tag) {
        case "None": {
          return core.succeed([value, value] as const)
        }
        case "Some": {
          return core.map(result.value, (a) => [a, a] as const)
        }
      }
    }).traced(trace))

// circular with Fiber

/** @internal */
export const zipFiber = Debug.untracedDual<
  <E2, A2>(that: Fiber.Fiber<E2, A2>) => <E, A>(self: Fiber.Fiber<E, A>) => Fiber.Fiber<E | E2, readonly [A, A2]>,
  <E, A, E2, A2>(self: Fiber.Fiber<E, A>, that: Fiber.Fiber<E2, A2>) => Fiber.Fiber<E | E2, readonly [A, A2]>
>(2, () => (self, that) => zipWithFiber(self, that, (a, b) => [a, b] as const))

/** @internal */
export const zipLeftFiber = Debug.untracedDual<
  <E2, A2>(that: Fiber.Fiber<E2, A2>) => <E, A>(self: Fiber.Fiber<E, A>) => Fiber.Fiber<E | E2, A>,
  <E, A, E2, A2>(self: Fiber.Fiber<E, A>, that: Fiber.Fiber<E2, A2>) => Fiber.Fiber<E | E2, A>
>(2, () => (self, that) => zipWithFiber(self, that, (a, _) => a))

/** @internal */
export const zipRightFiber = Debug.untracedDual<
  <E2, A2>(that: Fiber.Fiber<E2, A2>) => <E, A>(self: Fiber.Fiber<E, A>) => Fiber.Fiber<E | E2, A2>,
  <E, A, E2, A2>(self: Fiber.Fiber<E, A>, that: Fiber.Fiber<E2, A2>) => Fiber.Fiber<E | E2, A2>
>(2, () => (self, that) => zipWithFiber(self, that, (_, b) => b))

/** @internal */
export const zipWithFiber = Debug.untracedDual<
  <E2, A, B, C>(
    that: Fiber.Fiber<E2, B>,
    f: (a: A, b: B) => C
  ) => <E>(self: Fiber.Fiber<E, A>) => Fiber.Fiber<E | E2, C>,
  <E, A, E2, B, C>(
    self: Fiber.Fiber<E, A>,
    that: Fiber.Fiber<E2, B>,
    f: (a: A, b: B) => C
  ) => Fiber.Fiber<E | E2, C>
>(3, (restore) =>
  (self, that, f) => ({
    [internalFiber.FiberTypeId]: internalFiber.fiberVariance,
    id: () => pipe(self.id(), FiberId.getOrElse(that.id())),
    await: Debug.methodWithTrace((trace) =>
      () =>
        pipe(
          self.await(),
          core.flatten,
          zipWithPar(core.flatten(that.await()), restore(f)),
          core.exit
        ).traced(trace)
    ),
    children: Debug.methodWithTrace((trace) => () => self.children().traced(trace)),
    inheritAll: Debug.methodWithTrace((trace) =>
      () =>
        core.zipRight(
          that.inheritAll(),
          self.inheritAll()
        ).traced(trace)
    ),
    poll: Debug.methodWithTrace((trace) =>
      () =>
        core.zipWith(
          self.poll(),
          that.poll(),
          (optionA, optionB) =>
            pipe(
              optionA,
              Option.flatMap((exitA) =>
                pipe(
                  optionB,
                  Option.map((exitB) =>
                    pipe(
                      exitA,
                      Exit.zipWith(exitB, restore(f), internalCause.parallel)
                    )
                  )
                )
              )
            )
        ).traced(trace)
    ),
    interruptAsFork: Debug.methodWithTrace((trace) =>
      (id) =>
        core.zipRight(
          self.interruptAsFork(id),
          that.interruptAsFork(id)
        ).traced(trace)
    )
  }))
