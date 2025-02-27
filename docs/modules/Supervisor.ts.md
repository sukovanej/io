---
title: Supervisor.ts
nav_order: 56
parent: Modules
---

## Supervisor overview

A `Supervisor<T>` is allowed to supervise the launching and termination of
fibers, producing some visible value of type `T` from the supervision.

Added in v1.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [constructors](#constructors)
  - [fibersIn](#fibersin)
  - [fromEffect](#fromeffect)
  - [none](#none)
  - [track](#track)
- [context](#context)
  - [addSupervisor](#addsupervisor)
- [models](#models)
  - [Supervisor (interface)](#supervisor-interface)
- [symbols](#symbols)
  - [SupervisorTypeId](#supervisortypeid)
  - [SupervisorTypeId (type alias)](#supervisortypeid-type-alias)
- [unsafe](#unsafe)
  - [unsafeTrack](#unsafetrack)

---

# constructors

## fibersIn

Creates a new supervisor that tracks children in a set.

**Signature**

```ts
export declare const fibersIn: (
  ref: MutableRef.MutableRef<SortedSet.SortedSet<Fiber.RuntimeFiber<any, any>>>
) => Effect.Effect<never, never, Supervisor<SortedSet.SortedSet<Fiber.RuntimeFiber<any, any>>>>
```

Added in v1.0.0

## fromEffect

Creates a new supervisor that constantly yields effect when polled

**Signature**

```ts
export declare const fromEffect: <A>(effect: Effect.Effect<never, never, A>) => Supervisor<A>
```

Added in v1.0.0

## none

A supervisor that doesn't do anything in response to supervision events.

**Signature**

```ts
export declare const none: Supervisor<void>
```

Added in v1.0.0

## track

Creates a new supervisor that tracks children in a set.

**Signature**

```ts
export declare const track: (_: void) => Effect.Effect<never, never, Supervisor<Array<Fiber.RuntimeFiber<any, any>>>>
```

Added in v1.0.0

# context

## addSupervisor

**Signature**

```ts
export declare const addSupervisor: <A>(supervisor: Supervisor<A>) => Layer.Layer<never, never, never>
```

Added in v1.0.0

# models

## Supervisor (interface)

**Signature**

```ts
export interface Supervisor<T> extends Supervisor.Variance<T> {
  /**
   * Returns an `Effect` that succeeds with the value produced by this
   * supervisor. This value may change over time, reflecting what the supervisor
   * produces as it supervises fibers.
   */
  value(): Effect.Effect<never, never, T>

  /**
   * Supervises the start of a `Fiber`.
   */
  onStart<R, E, A>(
    context: Context.Context<R>,
    effect: Effect.Effect<R, E, A>,
    parent: Option.Option<Fiber.RuntimeFiber<any, any>>,
    fiber: Fiber.RuntimeFiber<E, A>
  ): void

  /**
   * Supervises the end of a `Fiber`.
   */
  onEnd<E, A>(value: Exit.Exit<E, A>, fiber: Fiber.RuntimeFiber<E, A>): void

  /**
   * Supervises the execution of an `Effect` by a `Fiber`.
   */
  onEffect<E, A>(fiber: Fiber.RuntimeFiber<E, A>, effect: Effect.Effect<any, any, any>): void

  /**
   * Supervises the suspension of a computation running within a `Fiber`.
   */
  onSuspend<E, A>(fiber: Fiber.RuntimeFiber<E, A>): void

  /**
   * Supervises the resumption of a computation running within a `Fiber`.
   */
  onResume<E, A>(fiber: Fiber.RuntimeFiber<E, A>): void

  /**
   * Maps this supervisor to another one, which has the same effect, but whose
   * value has been transformed by the specified function.
   */
  map<B>(f: (a: T) => B): Supervisor<B>

  /**
   * Returns a new supervisor that performs the function of this supervisor, and
   * the function of the specified supervisor, producing a tuple of the outputs
   * produced by both supervisors.
   */
  zip<A>(right: Supervisor<A>): Supervisor<readonly [T, A]>
}
```

Added in v1.0.0

# symbols

## SupervisorTypeId

**Signature**

```ts
export declare const SupervisorTypeId: typeof SupervisorTypeId
```

Added in v1.0.0

## SupervisorTypeId (type alias)

**Signature**

```ts
export type SupervisorTypeId = typeof SupervisorTypeId
```

Added in v1.0.0

# unsafe

## unsafeTrack

Unsafely creates a new supervisor that tracks children in a set.

**Signature**

```ts
export declare const unsafeTrack: () => Supervisor<Array<Fiber.RuntimeFiber<any, any>>>
```

Added in v1.0.0
