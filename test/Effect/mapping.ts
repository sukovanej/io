import * as Either from "@effect/data/Either"
import { identity, pipe } from "@effect/data/Function"
import * as Cause from "@effect/io/Cause"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Ref from "@effect/io/Ref"
import * as it from "@effect/io/test/utils/extend"
import { assert, describe } from "vitest"

const ExampleError = new Error("Oh noes!")

const parseInt = (s: string): number => {
  const n = Number.parseInt(s)
  if (Number.isNaN(n)) {
    throw Cause.IllegalArgumentException()
  }
  return n
}

const fib = (n: number): number => {
  if (n <= 1) {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

describe.concurrent("Effect", () => {
  it.effect("flip must make error into value", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.flip(Effect.fail(ExampleError)))
      assert.deepStrictEqual(result, ExampleError)
    }))
  it.effect("flip must make value into error", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.either(Effect.flip(Effect.succeed(42))))
      assert.deepStrictEqual(result, Either.left(42))
    }))
  it.effect("flipping twice returns the identical value", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.flip(Effect.flip(Effect.succeed(42))))
      assert.strictEqual(result, 42)
    }))
  it.effect("mapBoth - maps over both error and value channels", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.fail(10), Effect.mapBoth((n) => n.toString(), identity), Effect.either)
      assert.deepStrictEqual(result, Either.left("10"))
    }))
  it.effect("mapTryCatch - returns an effect whose success is mapped by the specified side effecting function", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.succeed("123"), Effect.mapTryCatch(parseInt, identity))
      assert.strictEqual(result, 123)
    }))
  it.effect("mapTryCatch - translates any thrown exceptions into typed failed effects", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.succeed("hello"), Effect.mapTryCatch(parseInt, identity), Effect.exit)
      assert.deepStrictEqual(Exit.unannotate(result), Exit.fail(Cause.IllegalArgumentException()))
    }))
  it.effect("negate - on true returns false", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.negate(Effect.succeed(true)))
      assert.isFalse(result)
    }))
  it.effect("negate - on false returns true", () =>
    Effect.gen(function*($) {
      const result = yield* $(Effect.negate(Effect.succeed(false)))
      assert.isTrue(result)
    }))
  it.effect("summarized - returns summary and value", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Ref.make(0))
      const increment = Ref.updateAndGet(counter, (n) => n + 1)
      const [[start, end], value] = yield* $(
        pipe(increment, Effect.summarized(increment, (start, end) => [start, end] as const))
      )
      assert.strictEqual(start, 1)
      assert.strictEqual(value, 2)
      assert.strictEqual(end, 3)
    }))
  it.effect("point, bind, map", () =>
    Effect.gen(function*($) {
      const fibEffect = (n: number): Effect.Effect<never, never, number> => {
        if (n <= 1) {
          return Effect.succeed(n)
        }
        return pipe(fibEffect(n - 1), Effect.zipWith(fibEffect(n - 2), (a, b) => a + b))
      }
      const result = yield* $(fibEffect(10))
      assert.strictEqual(result, fib(10))
    }))
  it.effect("effect, bind, map", () =>
    Effect.gen(function*($) {
      const fibEffect = (n: number): Effect.Effect<never, unknown, number> => {
        if (n <= 1) {
          return Effect.try(() => n)
        }
        return pipe(fibEffect(n - 1), Effect.zipWith(fibEffect(n - 2), (a, b) => a + b))
      }
      const result = yield* $(fibEffect(10))
      assert.strictEqual(result, fib(10))
    }))
  it.effect("effect, bind, map, redeem", () =>
    Effect.gen(function*($) {
      const fibEffect = (n: number): Effect.Effect<never, unknown, number> => {
        if (n <= 1) {
          return pipe(
            Effect.try(() => {
              throw ExampleError
            }),
            Effect.catchAll(() => Effect.try(() => n))
          )
        }
        return pipe(fibEffect(n - 1), Effect.zipWith(fibEffect(n - 2), (a, b) => a + b))
      }
      const result = yield* $(fibEffect(10))
      assert.strictEqual(result, fib(10))
    }))
})
