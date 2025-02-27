import * as Chunk from "@effect/data/Chunk"
import * as Context from "@effect/data/Context"
import * as Duration from "@effect/data/Duration"
import { identity, pipe } from "@effect/data/Function"
import * as Deferred from "@effect/io/Deferred"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Fiber from "@effect/io/Fiber"
import * as FiberRef from "@effect/io/FiberRef"
import * as Layer from "@effect/io/Layer"
import * as Ref from "@effect/io/Ref"
import * as Schedule from "@effect/io/Schedule"
import * as it from "@effect/io/test/utils/extend"
import { assert, describe } from "vitest"

export const acquire1 = "Acquiring Module 1"
export const acquire2 = "Acquiring Module 2"
export const acquire3 = "Acquiring Module 3"
export const release1 = "Releasing Module 1"
export const release2 = "Releasing Module 2"
export const release3 = "Releasing Module 3"

describe.concurrent("Layer", () => {
  it.effect("layers can be acquired in parallel", () =>
    Effect.gen(function*($) {
      const BoolTag = Context.Tag<boolean>()
      const deferred = yield* $(Deferred.make<never, void>())
      const layer1 = Layer.effectContext<never, never, never>(Effect.never())
      const layer2 = Layer.scopedContext(
        Effect.acquireRelease(
          pipe(
            Deferred.succeed(deferred, void 0),
            Effect.map((bool) => Context.make(BoolTag, bool))
          ),
          () => Effect.unit()
        )
      )
      const env = pipe(layer1, Layer.merge(layer2), Layer.build)
      const fiber = yield* $(Effect.scoped(env), Effect.forkDaemon)
      yield* $(Deferred.await(deferred))
      const result = yield* $(Fiber.interrupt(fiber), Effect.asUnit)
      assert.isUndefined(result)
    }))
  it.effect("preserves identity of acquired resources", () =>
    Effect.gen(function*($) {
      const ChunkTag = Context.Tag<Ref.Ref<Chunk.Chunk<string>>>()
      const testRef = yield* $(Ref.make<Chunk.Chunk<string>>(Chunk.empty()))
      const layer = Layer.scoped(
        ChunkTag,
        pipe(
          Effect.acquireRelease(Ref.make<Chunk.Chunk<string>>(Chunk.empty()), (ref) =>
            pipe(
              Ref.get(ref),
              Effect.flatMap((chunk) => Ref.set(testRef, chunk))
            )),
          Effect.tap(() => Effect.unit())
        )
      )
      yield* $(
        Layer.build(layer),
        Effect.flatMap((context) =>
          Ref.update(
            pipe(context, Context.get(ChunkTag)),
            Chunk.append("test")
          )
        ),
        Effect.scoped
      )
      const result = yield* $(Ref.get(testRef))
      assert.deepStrictEqual(Array.from(result), ["test"])
    }))
  it.effect("sharing with merge", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer = makeLayer1(ref)
      const env = pipe(layer, Layer.merge(layer), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, release1])
    }))
  it.scoped("sharing itself with merge", () =>
    Effect.gen(function*($) {
      const service1 = new Service1()
      const layer = Layer.succeed(Service1Tag, service1)
      const env = pipe(layer, Layer.merge(layer), Layer.merge(layer), Layer.build)
      const result = yield* $(
        pipe(env, Effect.flatMap((context) => Effect.try(() => pipe(context, Context.get(Service1Tag)))))
      )
      assert.strictEqual(result, service1)
    }))
  it.effect("finalizers", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const env = pipe(layer1, Layer.merge(layer2), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.isDefined(Array.from(result).slice(0, 2).find((s) => s === acquire1))
      assert.isDefined(Array.from(result).slice(0, 2).find((s) => s === acquire2))
      assert.isDefined(Array.from(result).slice(2, 4).find((s) => s === release1))
      assert.isDefined(Array.from(result).slice(2, 4).find((s) => s === release2))
    }))
  it.effect("caching values in dependencies", () =>
    Effect.gen(function*($) {
      class Config {
        constructor(readonly value: number) {}
      }
      const ConfigTag = Context.Tag<Config>()
      class A {
        constructor(readonly value: number) {}
      }
      const ATag = Context.Tag<A>()
      const aLayer = Layer.function(ConfigTag, ATag, (config) => new A(config.value))
      class B {
        constructor(readonly value: number) {}
      }
      const BTag = Context.Tag<B>()
      const bLayer = Layer.function(ATag, BTag, (_: A) => new B(_.value))
      class C {
        constructor(readonly value: number) {}
      }
      const CTag = Context.Tag<C>()
      const cLayer = Layer.function(ATag, CTag, (_: A) => new C(_.value))
      const fedB = pipe(
        Layer.succeed(ConfigTag, new Config(1)),
        Layer.provideMerge(aLayer),
        Layer.provideMerge(bLayer)
      )
      const fedC = pipe(
        cLayer,
        Layer.useMerge(aLayer),
        Layer.use(Layer.succeed(ConfigTag, new Config(2)))
      )
      const result = yield* $(
        fedB,
        Layer.merge(fedC),
        Layer.build,
        Effect.map((context) =>
          [
            pipe(context, Context.get(BTag)),
            pipe(context, Context.get(CTag))
          ] as const
        ),
        Effect.scoped
      )
      assert.strictEqual(result[0].value, 1)
      assert.strictEqual(result[1].value, 1)
    }))
  it.effect("orElse - uses an alternative layer", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const env = pipe(layer1, Layer.provideMerge(Layer.fail("failed!")), Layer.orElse(() => layer2), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, release1, acquire2, release2])
    }))
  it.effect("handles errors gracefully", () =>
    Effect.gen(function*($) {
      interface Bar {
        readonly bar: string
      }
      const BarTag = Context.Tag<Bar>()
      interface Baz {
        readonly baz: string
      }
      const BazTag = Context.Tag<Baz>()
      const ScopedTag = Context.Tag<void>()
      const sleep = Effect.sleep(Duration.millis(100))
      const layer1 = Layer.fail("foo")
      const layer2 = Layer.succeed(BarTag, { bar: "bar" })
      const layer3 = Layer.succeed(BazTag, { baz: "baz" })
      const layer4 = Layer.scoped(ScopedTag, Effect.scoped(Effect.acquireRelease(sleep, () => sleep)))
      const layer = pipe(layer1, Layer.merge(pipe(layer2, Layer.merge(layer3), Layer.provide(layer4))))
      const result = yield* $(Effect.unit(), Effect.provideLayer(layer), Effect.exit)
      assert.isTrue(Exit.isFailure(result))
    }))
  it.effect("fresh with merge", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer = makeLayer1(ref)
      const env = pipe(layer, Layer.merge(Layer.fresh(layer)), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, acquire1, release1, release1])
    }))
  it.effect("fresh with to provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer = makeLayer1(ref)
      const env = pipe(layer, Layer.provide(Layer.fresh(layer)), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, acquire1, release1, release1])
    }))
  it.effect("with multiple layers", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer = makeLayer1(ref)
      const env = pipe(
        layer,
        Layer.merge(layer),
        Layer.merge(pipe(layer, Layer.merge(layer), Layer.fresh)),
        Layer.build
      )
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, acquire1, release1, release1])
    }))
  it.effect("with identical fresh layers", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(
        Layer.fresh(layer1),
        Layer.provide(pipe(layer2, Layer.merge(pipe(layer1, Layer.provide(layer3), Layer.fresh)))),
        Layer.build
      )
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [
        acquire1,
        acquire2,
        acquire1,
        acquire3,
        release3,
        release1,
        release2,
        release1
      ])
    }))
  it.effect("interruption with merge", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const env = pipe(layer1, Layer.merge(layer2), Layer.build)
      const fiber = yield* $(Effect.scoped(env), Effect.fork)
      yield* $(Fiber.interrupt(fiber))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      if (result.find((s) => s === acquire1) !== undefined) {
        assert.isTrue(result.some((s) => s === release1))
      }
      if (result.find((s) => s === acquire2) !== undefined) {
        assert.isTrue(result.some((s) => s === release2))
      }
    }))
  it.effect("interruption with provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const env = pipe(layer1, Layer.provide(layer2), Layer.build)
      const fiber = yield* $(Effect.scoped(env), Effect.fork)
      yield* $(Fiber.interrupt(fiber))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      if (result.find((s) => s === acquire1) !== undefined) {
        assert.isTrue(result.some((s) => s === release1))
      }
      if (result.find((s) => s === acquire2) !== undefined) {
        assert.isTrue(result.some((s) => s === release2))
      }
    }))
  it.effect("interruption with multiple layers", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(
        layer1,
        Layer.provide(pipe(layer2, Layer.merge(pipe(layer1, Layer.provide(layer3))))),
        Layer.build
      )
      const fiber = yield* $(Effect.scoped(env), Effect.fork)
      yield* $(Fiber.interrupt(fiber))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      if (result.find((s) => s === acquire1) !== undefined) {
        assert.isTrue(result.some((s) => s === release1))
      }
      if (result.find((s) => s === acquire2) !== undefined) {
        assert.isTrue(result.some((s) => s === release2))
      }
      if (result.find((s) => s === acquire3) !== undefined) {
        assert.isTrue(result.some((s) => s === release3))
      }
    }))
  it.effect("can map a layer to an unrelated type", () =>
    Effect.gen(function*($) {
      interface ServiceA {
        readonly name: string
        readonly value: number
      }
      const ServiceATag = Context.Tag<ServiceA>()
      interface ServiceB {
        readonly name: string
      }
      const ServiceBTag = Context.Tag<ServiceB>()
      const StringTag = Context.Tag<string>()
      const layer1 = Layer.succeed(ServiceATag, { name: "name", value: 1 })
      const layer2 = Layer.function(StringTag, ServiceBTag, (name) => ({ name }))
      const live = pipe(
        layer1,
        Layer.map((context) => Context.make(StringTag, Context.get(context, ServiceATag).name)),
        Layer.provide(layer2)
      )
      const result = yield* $(ServiceBTag, Effect.provideLayer(live))
      assert.strictEqual(result.name, "name")
    }))
  it.effect("memoizes acquisition of resources", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const memoized = Layer.memoize(makeLayer1(ref))
      yield* $(
        memoized,
        Effect.flatMap((layer) =>
          pipe(
            Effect.context<Service1>(),
            Effect.provideLayer(layer),
            Effect.flatMap(() => pipe(Effect.context<Service1>(), Effect.provideLayer(layer)))
          )
        ),
        Effect.scoped
      )
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, release1])
    }))
  it.scoped("fiberRef changes are memoized", () =>
    Effect.gen(function*($) {
      const fiberRef = yield* $(FiberRef.make<boolean>(false))
      const tag = Context.Tag<boolean>()
      const layer1 = Layer.scopedDiscard(Effect.locallyScoped(fiberRef, true))
      const layer2 = Layer.effect(tag, FiberRef.get(fiberRef))
      const layer3 = pipe(layer1, Layer.merge(pipe(layer1, Layer.provide(layer2))))
      const result = yield* $(Layer.build(layer3))
      assert.equal(pipe(result, Context.unsafeGet(tag)), true)
    }))
  it.effect("provides a partial environment to an effect", () =>
    Effect.gen(function*($) {
      const NumberTag = Context.Tag<number>()
      const StringTag = Context.Tag<string>()
      const needsNumberAndString = Effect.all(NumberTag, StringTag)
      const providesNumber = Layer.succeed(NumberTag, 10)
      const providesString = Layer.succeed(StringTag, "hi")
      const needsString = pipe(needsNumberAndString, Effect.provideSomeLayer(providesNumber))
      const result = yield* $(needsString, Effect.provideLayer(providesString))
      assert.strictEqual(result[0], 10)
      assert.strictEqual(result[1], "hi")
    }))
  it.effect("to provides a partial environment to another layer", () =>
    Effect.gen(function*($) {
      const StringTag = Context.Tag<string>()
      const NumberRefTag = Context.Tag<Ref.Ref<number>>()
      interface FooService {
        readonly ref: Ref.Ref<number>
        readonly string: string
        readonly get: Effect.Effect<
          never,
          never,
          readonly [
            number,
            string
          ]
        >
      }
      const FooTag = Context.Tag<FooService>()
      const fooBuilder = pipe(
        Layer.context<string | Ref.Ref<number>>(),
        Layer.map((context) => {
          const s = Context.get(context, StringTag)
          const ref = Context.get(context, NumberRefTag)
          return Context.make(FooTag, {
            ref,
            string: s,
            get: pipe(Ref.get(ref), Effect.map((i) => [i, s] as const))
          })
        })
      )
      const provideNumberRef = Layer.effect(NumberRefTag, Ref.make(10))
      const provideString = Layer.succeed(StringTag, "hi")
      const needsString = pipe(provideNumberRef, Layer.provide(fooBuilder))
      const layer = pipe(provideString, Layer.provide(needsString))
      const result = yield* $(Effect.flatMap(FooTag, (_) => _.get), Effect.provideLayer(layer))
      assert.strictEqual(result[0], 10)
      assert.strictEqual(result[1], "hi")
    }))
  it.effect("andTo provides a partial environment to another layer", () =>
    Effect.gen(function*($) {
      const StringTag = Context.Tag<string>()
      const NumberRefTag = Context.Tag<Ref.Ref<number>>()
      interface FooService {
        readonly ref: Ref.Ref<number>
        readonly string: string
        readonly get: Effect.Effect<
          never,
          never,
          readonly [
            number,
            string
          ]
        >
      }
      const FooTag = Context.Tag<FooService>()
      const fooBuilder = pipe(
        Layer.context<string | Ref.Ref<number>>(),
        Layer.map((context) => {
          const s = Context.get(context, StringTag)
          const ref = Context.get(context, NumberRefTag)
          return Context.make(FooTag, {
            ref,
            string: s,
            get: pipe(Ref.get(ref), Effect.map((i) => [i, s] as const))
          })
        })
      )
      const provideNumberRef = Layer.effect(NumberRefTag, Ref.make(10))
      const provideString = Layer.succeed(StringTag, "hi")
      const needsString = pipe(provideNumberRef, Layer.provideMerge(fooBuilder))
      const layer = pipe(provideString, Layer.provideMerge(needsString))
      const result = yield* $(
        Effect.flatMap(FooTag, (foo) => foo.get),
        Effect.flatMap(([i1, s]) =>
          pipe(Effect.flatMap(NumberRefTag, Ref.get), Effect.map((i2) => [i1, i2, s] as const))
        ),
        Effect.provideLayer(layer)
      )
      assert.strictEqual(result[0], 10)
      assert.strictEqual(result[1], 10)
      assert.strictEqual(result[2], "hi")
    }))
  it.effect("passthrough passes the inputs through to the next layer", () =>
    Effect.gen(function*($) {
      interface NumberService {
        readonly value: number
      }
      const NumberTag = Context.Tag<NumberService>()
      interface ToStringService {
        readonly value: string
      }
      const ToStringTag = Context.Tag<ToStringService>()
      const layer = Layer.function(NumberTag, ToStringTag, (numberService) => ({
        value: numberService.value.toString()
      }))
      const live = pipe(Layer.succeed(NumberTag, { value: 1 }), Layer.provide(Layer.passthrough(layer)))
      const { i, s } = yield* $(
        Effect.all({
          i: NumberTag,
          s: ToStringTag
        }),
        Effect.provideLayer(live)
      )
      assert.strictEqual(i.value, 1)
      assert.strictEqual(s.value, "1")
    }))
  it.effect("project", () =>
    Effect.gen(function*($) {
      interface PersonService {
        readonly name: string
        readonly age: number
      }
      interface AgeService extends Pick<PersonService, "age"> {
      }
      const PersonTag = Context.Tag<PersonService>()
      const AgeTag = Context.Tag<AgeService>()
      const personLayer = Layer.succeed(PersonTag, { name: "User", age: 42 })
      const ageLayer = pipe(personLayer, Layer.project(PersonTag, AgeTag, (_) => ({ age: _.age })))
      const { age } = yield* $(AgeTag, Effect.provideLayer(ageLayer))
      assert.strictEqual(age, 42)
    }))
  it.effect("sharing with provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer = makeLayer1(ref)
      const env = pipe(layer, Layer.provide(layer), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, release1])
    }))
  it.effect("sharing with multiple layers with provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(layer1, Layer.provide(layer2), Layer.merge(pipe(layer1, Layer.provide(layer3))), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      assert.strictEqual(result[0], acquire1)
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire2))
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release2))
      assert.strictEqual(result[5], release1)
    }))
  it.effect("finalizers with provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const env = pipe(layer1, Layer.provide(layer2), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, acquire2, release2, release1])
    }))
  it.effect("finalizers with multiple layers with provideTo", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(layer1, Layer.provide(layer2), Layer.provide(layer3), Layer.build)
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref))
      assert.deepStrictEqual(Array.from(result), [acquire1, acquire2, acquire3, release3, release2, release1])
    }))
  it.effect("retry", () =>
    Effect.gen(function*($) {
      const ref = yield* $(Ref.make(0))
      const effect = pipe(Ref.update(ref, (n) => n + 1), Effect.zipRight(Effect.fail("fail")))
      const layer = pipe(Layer.effectContext(effect), Layer.retry(Schedule.recurs(3)))
      yield* $(Effect.ignore(Effect.scoped(Layer.build(layer))))
      const result = yield* $(Ref.get(ref))
      assert.strictEqual(result, 4)
    }))
  it.effect("map does not interfere with sharing", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(
        layer1,
        Layer.map(identity),
        Layer.provide(layer2),
        Layer.provide(pipe(layer1, Layer.provide(layer3))),
        Layer.build
      )
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      assert.strictEqual(result[0], acquire1)
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire2))
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release2))
      assert.strictEqual(result[5], release1)
    }))
  it.effect("mapError does not interfere with sharing", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(
        layer1,
        Layer.mapError(identity),
        Layer.provide(layer2),
        Layer.provide(pipe(layer1, Layer.provide(layer3))),
        Layer.build
      )
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      assert.strictEqual(result[0], acquire1)
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire2))
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release2))
      assert.strictEqual(result[5], release1)
    }))
  it.effect("orDie does not interfere with sharing", () =>
    Effect.gen(function*($) {
      const ref = yield* $(makeRef())
      const layer1 = makeLayer1(ref)
      const layer2 = makeLayer2(ref)
      const layer3 = makeLayer3(ref)
      const env = pipe(
        Layer.orDie(layer1),
        Layer.provide(layer2),
        Layer.provide(pipe(layer1, Layer.provide(layer3))),
        Layer.build
      )
      yield* $(Effect.scoped(env))
      const result = yield* $(Ref.get(ref), Effect.map((chunk) => Array.from(chunk)))
      assert.strictEqual(result[0], acquire1)
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire2))
      assert.isTrue(result.slice(1, 3).some((s) => s === acquire3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release3))
      assert.isTrue(result.slice(3, 5).some((s) => s === release2))
      assert.strictEqual(result[5], release1)
    }))
  it.effect("tap peeks at an acquired resource", () =>
    Effect.gen(function*($) {
      interface BarService {
        readonly bar: string
      }
      const BarTag = Context.Tag<BarService>()
      const ref: Ref.Ref<string> = yield* $(Ref.make("foo"))
      const layer = pipe(
        Layer.succeed(BarTag, { bar: "bar" }),
        Layer.tap((context) => Ref.set(ref, pipe(context, Context.get(BarTag)).bar))
      )
      yield* $(Effect.scoped(Layer.build(layer)))
      const result = yield* $(Ref.get(ref))
      assert.strictEqual(result, "bar")
    }))
  it.effect("locally", () =>
    Effect.gen(function*($) {
      interface BarService {
        readonly bar: string
      }
      const BarTag = Context.Tag<BarService>()
      const fiberRef = FiberRef.unsafeMake(0)
      const layer = Layer.locally(fiberRef, 100)(
        Layer.effect(
          BarTag,
          Effect.map(
            FiberRef.get(fiberRef),
            (n): BarService => ({ bar: `bar: ${n}` })
          )
        )
      )
      const env = yield* $(Effect.scoped(Layer.build(layer)))
      const result = Context.get(env, BarTag)
      assert.strictEqual(result.bar, "bar: 100")
    }))
  it.effect("locallyWith", () =>
    Effect.gen(function*($) {
      interface BarService {
        readonly bar: string
      }
      const BarTag = Context.Tag<BarService>()
      const fiberRef = FiberRef.unsafeMake(0)
      const layer = Layer.locallyWith(fiberRef, (n) => n + 1)(
        Layer.effect(
          BarTag,
          Effect.map(
            FiberRef.get(fiberRef),
            (n): BarService => ({ bar: `bar: ${n}` })
          )
        )
      )
      const env = yield* $(Effect.scoped(Layer.build(layer)))
      const result = Context.get(env, BarTag)
      assert.strictEqual(result.bar, "bar: 1")
    }))
})
export const makeRef = (): Effect.Effect<never, never, Ref.Ref<Chunk.Chunk<string>>> => {
  return Ref.make(Chunk.empty())
}
export class Service1 {
  one(): Effect.Effect<never, never, number> {
    return Effect.succeed(1)
  }
}
export const Service1Tag = Context.Tag<Service1>()
export const makeLayer1 = (ref: Ref.Ref<Chunk.Chunk<string>>): Layer.Layer<never, never, Service1> => {
  return Layer.scoped(
    Service1Tag,
    Effect.acquireRelease(
      pipe(Ref.update(ref, Chunk.append(acquire1)), Effect.as(new Service1())),
      () => Ref.update(ref, Chunk.append(release1))
    )
  )
}
export class Service2 {
  two(): Effect.Effect<never, never, number> {
    return Effect.succeed(2)
  }
}
export const Service2Tag = Context.Tag<Service2>()
export const makeLayer2 = (ref: Ref.Ref<Chunk.Chunk<string>>): Layer.Layer<never, never, Service2> => {
  return Layer.scoped(
    Service2Tag,
    Effect.acquireRelease(
      pipe(Ref.update(ref, Chunk.append(acquire2)), Effect.as(new Service2())),
      () => Ref.update(ref, Chunk.append(release2))
    )
  )
}
export class Service3 {
  three(): Effect.Effect<never, never, number> {
    return Effect.succeed(3)
  }
}
export const Service3Tag = Context.Tag<Service3>()
export const makeLayer3 = (ref: Ref.Ref<Chunk.Chunk<string>>): Layer.Layer<never, never, Service3> => {
  return Layer.scoped(
    Service3Tag,
    Effect.acquireRelease(
      pipe(Ref.update(ref, Chunk.append(acquire3)), Effect.as(new Service3())),
      () => Ref.update(ref, Chunk.append(release3))
    )
  )
}
