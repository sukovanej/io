/**
 * @since 1.0.0
 */
import type * as Context from "@effect/data/Context"
import type { FiberRef } from "@effect/io/FiberRef"
import * as _RequestBlock from "@effect/io/internal_effect_untraced/blockedRequests"
import * as core from "@effect/io/internal_effect_untraced/core"
import * as _dataSource from "@effect/io/internal_effect_untraced/dataSource"
import type * as Request from "@effect/io/Request"
import type * as RequestResolver from "@effect/io/RequestResolver"

/**
 * `RequestBlock` captures a collection of blocked requests as a data
 * structure. By doing this the library is able to preserve information about
 * which requests must be performed sequentially and which can be performed in
 * parallel, allowing for maximum possible batching and pipelining while
 * preserving ordering guarantees.
 *
 * @since 1.0.0
 * @category models
 */
export type RequestBlock<R> = Empty | Par<R> | Seq<R> | Single<R>

/**
 * @since 1.0.0
 * @category models
 */
export declare namespace RequestBlock {
  /**
   * @since 1.0.0
   * @category models
   */
  export interface Reducer<R, Z> {
    readonly emptyCase: () => Z
    readonly parCase: (left: Z, right: Z) => Z
    readonly singleCase: (
      dataSource: RequestResolver.RequestResolver<unknown, R>,
      blockedRequest: Request.Entry<unknown>
    ) => Z
    readonly seqCase: (left: Z, right: Z) => Z
  }
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Empty {
  readonly _tag: "Empty"
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Par<R> {
  readonly _tag: "Par"
  readonly left: RequestBlock<R>
  readonly right: RequestBlock<R>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Seq<R> {
  readonly _tag: "Seq"
  readonly left: RequestBlock<R>
  readonly right: RequestBlock<R>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Single<R> {
  readonly _tag: "Single"
  readonly dataSource: RequestResolver.RequestResolver<unknown, R>
  readonly blockedRequest: Request.Entry<unknown>
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const single: <R, A>(
  dataSource: RequestResolver.RequestResolver<A, R>,
  blockedRequest: Request.Entry<A>
) => RequestBlock<R> = _RequestBlock.single

/**
 * @since 1.0.0
 * @category constructors
 */
export const empty: RequestBlock<never> = _RequestBlock.empty

/**
 * @since 1.0.0
 * @category constructors
 */
export const mapRequestResolvers: <R, A, R2>(
  self: RequestBlock<R>,
  f: (dataSource: RequestResolver.RequestResolver<A, R>) => RequestResolver.RequestResolver<A, R2>
) => RequestBlock<R | R2> = _RequestBlock.mapRequestResolvers

/**
 * @since 1.0.0
 * @category constructors
 */
export const parallel: <R, R2>(self: RequestBlock<R>, that: RequestBlock<R2>) => RequestBlock<R | R2> =
  _RequestBlock.par

/**
 * @since 1.0.0
 * @category constructors
 */
export const reduce: <R, Z>(self: RequestBlock<R>, reducer: RequestBlock.Reducer<R, Z>) => Z = _RequestBlock.reduce

/**
 * @since 1.0.0
 * @category constructors
 */
export const sequential: <R, R2>(self: RequestBlock<R>, that: RequestBlock<R2>) => RequestBlock<R | R2> =
  _RequestBlock.seq

/**
 * Provides each data source with part of its required environment.
 *
 * @since 1.0.0
 * @category utils
 */
export const contramapContext = <R0, R>(
  self: RequestBlock<R>,
  f: (context: Context.Context<R0>) => Context.Context<R>
): RequestBlock<R0> => reduce(self, ContramapContextReducer(f))

const ContramapContextReducer = <R0, R>(
  f: (context: Context.Context<R0>) => Context.Context<R>
): RequestBlock.Reducer<R, RequestBlock<R0>> => ({
  emptyCase: () => empty,
  parCase: (left, right) => parallel(left, right),
  seqCase: (left, right) => sequential(left, right),
  singleCase: (dataSource, blockedRequest) =>
    single(
      _dataSource.contramapContext(dataSource, f),
      blockedRequest
    )
})

/**
 * Provides each data source with a fiber ref value.
 *
 * @since 1.0.0
 * @category utils
 */
export const locally: <R, A>(self: RequestBlock<R>, ref: FiberRef<A>, value: A) => RequestBlock<R> =
  core.requestBlockLocally
