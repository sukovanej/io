import * as Effect from "@effect/io/Effect"
import * as Ref from "@effect/io/Ref"
import * as it from "@effect/io/test/extend"
import { pipe } from "@fp-ts/data/Function"
import * as Option from "@fp-ts/data/Option"
import { assert } from "vitest"

const current = "value"
const update = "new value"

type State = Active | Changed | Closed

interface Active {
  readonly _tag: "Active"
}

interface Changed {
  readonly _tag: "Changed"
}

interface Closed {
  readonly _tag: "Closed"
}

export const Active: State = { _tag: "Active" }
export const Changed: State = { _tag: "Changed" }
export const Closed: State = { _tag: "Closed" }

const isActive = (self: State): boolean => self._tag === "Active"
const isChanged = (self: State): boolean => self._tag === "Changed"
const isClosed = (self: State): boolean => self._tag === "Closed"

describe.concurrent("Ref", () => {
  it.effect("get", () =>
    Effect.gen(function*() {
      const result = yield* pipe(Ref.make(current), Effect.flatMap(Ref.get))
      assert.strictEqual(result, current)
    }))

  it.effect("getAndSet", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      const result1 = yield* pipe(ref, Ref.getAndSet(update))
      const result2 = yield* Ref.get(ref)
      assert.strictEqual(result1, current)
      assert.strictEqual(result2, update)
    }))

  it.effect("getAndUpdate", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      const result1 = yield* pipe(ref, Ref.getAndUpdate(() => update))
      const result2 = yield* Ref.get(ref)
      assert.strictEqual(result1, current)
      assert.strictEqual(result2, update)
    }))

  it.effect("getAndUpdateSome - once", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result1 = yield* pipe(
        ref,
        Ref.getAndUpdateSome((state) => isClosed(state) ? Option.some(Changed) : Option.none)
      )
      const result2 = yield* Ref.get(ref)
      assert.strictEqual(result1, Active)
      assert.strictEqual(result2, Active)
    }))

  it.effect("getAndUpdateSome - twice", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result1 = yield* pipe(
        ref,
        Ref.getAndUpdateSome((state) => isActive(state) ? Option.some(Changed) : Option.none)
      )
      const result2 = yield* pipe(
        ref,
        Ref.getAndUpdateSome((state) =>
          isActive(state) ?
            Option.some(Changed) :
            isChanged(state) ?
            Option.some(Closed) :
            Option.none
        )
      )
      const result3 = yield* Ref.get(ref)
      assert.strictEqual(result1, Active)
      assert.strictEqual(result2, Changed)
      assert.strictEqual(result3, Closed)
    }))

  it.effect("set", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      yield* pipe(ref, Ref.set(update))
      const result = yield* Ref.get(ref)
      assert.strictEqual(result, update)
    }))

  it.effect("update", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      yield* pipe(ref, Ref.update(() => update))
      const result = yield* Ref.get(ref)
      assert.strictEqual(result, update)
    }))

  it.effect("updateAndGet", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      const result = yield* pipe(ref, Ref.updateAndGet(() => update))
      assert.strictEqual(result, update)
    }))

  it.effect("updateSome - once", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      yield* pipe(ref, Ref.updateSome((state) => isClosed(state) ? Option.some(Changed) : Option.none))
      const result = yield* Ref.get(ref)
      assert.deepEqual(result, Active)
    }))

  it.effect("updateSome - twice", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      yield* pipe(ref, Ref.updateSome((state) => isActive(state) ? Option.some(Changed) : Option.none))
      const result1 = yield* Ref.get(ref)
      yield* pipe(
        ref,
        Ref.updateSome((state) =>
          isActive(state) ?
            Option.some(Changed) :
            isChanged(state) ?
            Option.some(Closed) :
            Option.none
        )
      )
      const result2 = yield* Ref.get(ref)
      assert.deepEqual(result1, Changed)
      assert.deepEqual(result2, Closed)
    }))

  it.effect("updateSomeAndGet - once", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result = yield* pipe(
        ref,
        Ref.updateSomeAndGet((state) => isClosed(state) ? Option.some(Changed) : Option.none)
      )
      assert.strictEqual(result, Active)
    }))

  it.effect("updateSomeAndGet - twice", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result1 = yield* pipe(
        ref,
        Ref.updateSomeAndGet((state) => isActive(state) ? Option.some(Changed) : Option.none)
      )
      const result2 = yield* pipe(
        ref,
        Ref.updateSomeAndGet((state): Option.Option<State> => {
          return isActive(state) ?
            Option.some(Changed) :
            isChanged(state) ?
            Option.some(Closed) :
            Option.none
        })
      )
      assert.deepEqual(result1, Changed)
      assert.deepEqual(result2, Closed)
    }))

  it.effect("modify", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make(current)
      const result1 = yield* pipe(ref, Ref.modify(() => ["hello", update]))
      const result2 = yield* Ref.get(ref)
      assert.strictEqual(result1, "hello")
      assert.strictEqual(result2, update)
    }))

  it.effect("modifySome - once", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result = yield* pipe(
        ref,
        Ref.modifySome(
          "state does not change",
          (state) =>
            isClosed(state) ?
              Option.some(["active", Active]) :
              Option.none
        )
      )
      assert.strictEqual(result, "state does not change")
    }))

  it.effect("modifySome - twice", () =>
    Effect.gen(function*() {
      const ref = yield* Ref.make<State>(Active)
      const result1 = yield* pipe(
        ref,
        Ref.modifySome(
          "state does not change",
          (state) =>
            isActive(state) ?
              Option.some(["changed", Changed]) :
              Option.none
        )
      )
      const result2 = yield* pipe(
        ref,
        Ref.modifySome(
          "state does not change",
          (state) =>
            isActive(state) ?
              Option.some(["changed", Changed]) :
              isChanged(state) ?
              Option.some(["closed", Closed]) :
              Option.none
        )
      )
      assert.strictEqual(result1, "changed")
      assert.strictEqual(result2, "closed")
    }))
})