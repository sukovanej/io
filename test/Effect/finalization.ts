import * as Cause from "@effect/io/Cause"
import * as Deferred from "@effect/io/Deferred"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Fiber from "@effect/io/Fiber"
import * as Ref from "@effect/io/Ref"
import * as it from "@effect/io/test/utils/extend"
import * as Duration from "@fp-ts/data/Duration"
import { pipe } from "@fp-ts/data/Function"
import * as List from "@fp-ts/data/List"
import * as Option from "@fp-ts/data/Option"
import { assert, describe } from "vitest"

const ExampleError = new Error("Oh noes!")

const asyncExampleError = <A>(): Effect.Effect<never, unknown, A> => {
  return Effect.async((cb) => {
    cb(Effect.fail(ExampleError))
  })
}

const asyncUnit = <E>(): Effect.Effect<never, E, void> => {
  return Effect.async((cb) => {
    cb(Effect.unit())
  })
}

describe.concurrent("Effect", () => {
  it.effect("fail ensuring", () =>
    Effect.gen(function*() {
      let finalized = false
      const result = yield* pipe(
        Effect.fail(ExampleError),
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true
          })
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.fail(ExampleError))
      assert.isTrue(finalized)
    }))

  it.effect("fail on error", () =>
    Effect.gen(function*() {
      let finalized = false
      const result = yield* pipe(
        Effect.fail(ExampleError),
        Effect.onError(() =>
          Effect.sync(() => {
            finalized = true
          })
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.fail(ExampleError))
      assert.isTrue(finalized)
    }))

  it.effect("finalizer errors not caught", () =>
    Effect.gen(function*() {
      const e2 = new Error("e2")
      const e3 = new Error("e3")
      const result = yield* pipe(
        Effect.fail(ExampleError),
        Effect.ensuring(Effect.die(e2)),
        Effect.ensuring(Effect.die(e3)),
        Effect.sandbox,
        Effect.flip,
        Effect.map((cause) => cause)
      )
      const expected = Cause.sequential(Cause.sequential(Cause.fail(ExampleError), Cause.die(e2)), Cause.die(e3))
      assert.deepStrictEqual(result, expected)
    }))

  it.effect("finalizer errors reported", () =>
    Effect.gen(function*() {
      let reported: Exit.Exit<never, number> | undefined
      const result = yield* pipe(
        Effect.succeed(42),
        Effect.ensuring(Effect.die(ExampleError)),
        Effect.fork,
        Effect.flatMap((fiber) =>
          pipe(
            Fiber.await(fiber),
            Effect.flatMap((e) =>
              Effect.sync(() => {
                reported = e
              })
            )
          )
        )
      )
      assert.isUndefined(result)
      assert.isFalse(reported !== undefined && Exit.isSuccess(reported))
    }))

  it.effect("acquireUseRelease exit.effect() is usage result", () =>
    Effect.gen(function*() {
      const result = yield* Effect.acquireUseRelease(
        Effect.unit(),
        () => Effect.succeed(42),
        () => Effect.unit()
      )
      assert.strictEqual(result, 42)
    }))

  it.effect("error in just acquisition", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.fail(ExampleError),
          () => Effect.unit(),
          () => Effect.unit()
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.fail(ExampleError))
    }))

  it.effect("error in just release", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.unit(),
          () => Effect.unit(),
          () => Effect.die(ExampleError)
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.die(ExampleError))
    }))

  it.effect("error in just usage", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.unit(),
          () => Effect.fail(ExampleError),
          () => Effect.unit()
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.fail(ExampleError))
    }))

  it.effect("rethrown caught error in acquisition", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.fail(ExampleError),
          () => Effect.unit(),
          () => Effect.unit()
        ),
        Effect.either,
        Effect.absolve,
        Effect.flip
      )
      assert.deepEqual(result, ExampleError)
    }))

  it.effect("rethrown caught error in release", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.unit(),
          () => Effect.unit(),
          () => Effect.die(ExampleError)
        ),
        Effect.exit
      )
      assert.deepStrictEqual(result, Exit.die(ExampleError))
    }))

  it.effect("rethrown caught error in usage", () =>
    Effect.gen(function*() {
      const result = yield* pipe(
        Effect.acquireUseRelease(
          Effect.unit(),
          () => Effect.fail(ExampleError),
          () => Effect.unit()
        ),
        Effect.either,
        Effect.absolve,
        Effect.exit
      )
      assert.deepEqual(result, Exit.fail(ExampleError))
    }))

  it.effect("test eval of async fail", () =>
    Effect.gen(function*() {
      const io1 = Effect.acquireUseRelease(
        Effect.unit(),
        () => asyncExampleError<void>(),
        () => asyncUnit<never>()
      )
      const io2 = Effect.acquireUseRelease(
        asyncUnit<never>(),
        () => asyncExampleError<void>(),
        () => asyncUnit<never>()
      )
      const a1 = yield* Effect.exit(io1)
      const a2 = yield* Effect.exit(io2)
      const a3 = yield* pipe(io1, Effect.either, Effect.absolve, Effect.exit)
      const a4 = yield* pipe(io2, Effect.either, Effect.absolve, Effect.exit)
      assert.deepStrictEqual(a1, Exit.fail(ExampleError))
      assert.deepStrictEqual(a2, Exit.fail(ExampleError))
      assert.deepStrictEqual(a3, Exit.fail(ExampleError))
      assert.deepStrictEqual(a4, Exit.fail(ExampleError))
    }))

  it.effect("acquireUseRelease regression 1", () =>
    Effect.gen(function*() {
      const makeLogger = (ref: Ref.Ref<List.List<string>>) => {
        return (line: string): Effect.Effect<never, never, void> => {
          return pipe(ref, Ref.update(List.prepend(line)))
        }
      }
      const ref = yield* Ref.make(List.empty<string>())
      const log = makeLogger(ref)
      const fiber = yield* pipe(
        Effect.acquireUseRelease(
          Effect.acquireUseRelease(
            Effect.unit(),
            () => Effect.unit(),
            () =>
              pipe(
                log("start 1"),
                Effect.zipRight(Effect.sleep(Duration.millis(10))),
                Effect.zipRight(log("release 1"))
              )
          ),
          () => Effect.unit(),
          () =>
            pipe(
              log("start 2"),
              Effect.zipRight(Effect.sleep(Duration.millis(10))),
              Effect.zipRight(log("release 2"))
            )
        ),
        Effect.fork
      )
      yield* pipe(
        Ref.get(ref),
        Effect.zipLeft(Effect.sleep(Duration.millis(1))),
        Effect.repeatUntil((list) => pipe(list, List.findFirst((s) => s === "start 1"), Option.isSome))
      )
      yield* Fiber.interrupt(fiber)
      yield* pipe(
        Ref.get(ref),
        Effect.zipLeft(Effect.sleep(Duration.millis(1))),
        Effect.repeatUntil((list) => pipe(list, List.findFirst((s) => s === "release 2"), Option.isSome))
      )
      const result = yield* Ref.get(ref)
      assert.isTrue(pipe(result, List.findFirst((s) => s === "start 1"), Option.isSome))
      assert.isTrue(pipe(result, List.findFirst((s) => s === "release 1"), Option.isSome))
      assert.isTrue(pipe(result, List.findFirst((s) => s === "start 2"), Option.isSome))
      assert.isTrue(pipe(result, List.findFirst((s) => s === "release 2"), Option.isSome))
    }))

  it.effect("interrupt waits for finalizer", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(false)
      const deferred1 = yield* Deferred.make<never, void>()
      const deferred2 = yield* Deferred.make<never, number>()
      const fiber = yield* pipe(
        deferred1,
        Deferred.succeed<void>(void 0),
        Effect.zipRight(Deferred.await(deferred2)),
        Effect.ensuring(pipe(ref, Ref.set(true), Effect.zipRight(Effect.sleep(Duration.millis(10))))),
        Effect.fork
      )
      yield* Deferred.await(deferred1)
      yield* Fiber.interrupt(fiber)
      const result = yield* Ref.get(ref)
      assert.isTrue(result)
    }))
})