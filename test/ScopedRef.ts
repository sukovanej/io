import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as ScopedRef from "@effect/io/ScopedRef"
import * as Counter from "@effect/io/test/utils/counter"
import * as it from "@effect/io/test/utils/extend"
import { assert, describe } from "vitest"

describe.concurrent("ScopedRef", () => {
  it.scoped("single set", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Counter.make())
      const ref = yield* $(ScopedRef.make(() => 0))
      yield* $(ScopedRef.set(ref, counter.acquire()))
      const result = yield* $(ScopedRef.get(ref))
      assert.strictEqual(result, 1)
    }))
  it.scoped("dual set", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Counter.make())
      const ref = yield* $(ScopedRef.make(() => 0))
      yield* $(
        ScopedRef.set(ref, counter.acquire()),
        Effect.zipRight(ScopedRef.set(ref, counter.acquire()))
      )
      const result = yield* $(ScopedRef.get(ref))
      assert.strictEqual(result, 2)
    }))
  it.scoped("release on swap", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Counter.make())
      const ref = yield* $(ScopedRef.make(() => 0))
      yield* $(
        ScopedRef.set(ref, counter.acquire()),
        Effect.zipRight(ScopedRef.set(ref, counter.acquire()))
      )

      const acquired = yield* $(counter.acquired())
      const released = yield* $(counter.released())
      assert.strictEqual(acquired, 2)
      assert.strictEqual(released, 1)
    }))
  it.scoped("double release on double swap", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Counter.make())
      const ref = yield* $(ScopedRef.make(() => 0))
      yield* $(
        pipe(
          ScopedRef.set(ref, counter.acquire()),
          Effect.zipRight(ScopedRef.set(ref, counter.acquire())),
          Effect.zipRight(ScopedRef.set(ref, counter.acquire()))
        )
      )
      const acquired = yield* $(counter.acquired())
      const released = yield* $(counter.released())
      assert.strictEqual(acquired, 3)
      assert.strictEqual(released, 2)
    }))
  it.effect("full release", () =>
    Effect.gen(function*($) {
      const counter = yield* $(Counter.make())
      yield* $(
        ScopedRef.make(() => 0),
        Effect.flatMap((ref) =>
          pipe(
            ScopedRef.set(ref, counter.acquire()),
            Effect.zipRight(ScopedRef.set(ref, counter.acquire())),
            Effect.zipRight(ScopedRef.set(ref, counter.acquire()))
          )
        ),
        Effect.scoped
      )
      const acquired = yield* $(counter.acquired())
      const released = yield* $(counter.released())
      assert.strictEqual(acquired, 3)
      assert.strictEqual(released, 3)
    }))
})
