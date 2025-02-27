---
title: Config/Provider.ts
nav_order: 6
parent: Modules
---

## Provider overview

Added in v1.0.0

---

<h2 class="text-delta">Table of contents</h2>

- [combinators](#combinators)
  - [constantCase](#constantcase)
  - [kebabCase](#kebabcase)
  - [lowerCase](#lowercase)
  - [snakeCase](#snakecase)
  - [upperCase](#uppercase)
  - [within](#within)
- [constructors](#constructors)
  - [fromEnv](#fromenv)
  - [fromFlat](#fromflat)
  - [fromMap](#frommap)
  - [make](#make)
  - [makeFlat](#makeflat)
- [context](#context)
  - [ConfigProvider](#configprovider)
- [models](#models)
  - [ConfigProvider (interface)](#configprovider-interface)
- [symbols](#symbols)
  - [ConfigProviderTypeId](#configprovidertypeid)
  - [ConfigProviderTypeId (type alias)](#configprovidertypeid-type-alias)
  - [FlatConfigProviderTypeId](#flatconfigprovidertypeid)
  - [FlatConfigProviderTypeId (type alias)](#flatconfigprovidertypeid-type-alias)
- [utils](#utils)
  - [contramapPath](#contramappath)
  - [nested](#nested)
  - [orElse](#orelse)
  - [unnested](#unnested)

---

# combinators

## constantCase

Returns a new config provider that will automatically convert all property
names to constant case. This can be utilized to adapt the names of
configuration properties from the default naming convention of camel case
to the naming convention of a config provider.

**Signature**

```ts
export declare const constantCase: (self: ConfigProvider) => ConfigProvider
```

Added in v1.0.0

## kebabCase

Returns a new config provider that will automatically convert all property
names to kebab case. This can be utilized to adapt the names of
configuration properties from the default naming convention of camel case
to the naming convention of a config provider.

**Signature**

```ts
export declare const kebabCase: (self: ConfigProvider) => ConfigProvider
```

Added in v1.0.0

## lowerCase

Returns a new config provider that will automatically convert all property
names to lower case. This can be utilized to adapt the names of
configuration properties from the default naming convention of camel case
to the naming convention of a config provider.

**Signature**

```ts
export declare const lowerCase: (self: ConfigProvider) => ConfigProvider
```

Added in v1.0.0

## snakeCase

Returns a new config provider that will automatically convert all property
names to upper case. This can be utilized to adapt the names of
configuration properties from the default naming convention of camel case
to the naming convention of a config provider.

**Signature**

```ts
export declare const snakeCase: (self: ConfigProvider) => ConfigProvider
```

Added in v1.0.0

## upperCase

Returns a new config provider that will automatically convert all property
names to upper case. This can be utilized to adapt the names of
configuration properties from the default naming convention of camel case
to the naming convention of a config provider.

**Signature**

```ts
export declare const upperCase: (self: ConfigProvider) => ConfigProvider
```

Added in v1.0.0

## within

Returns a new config provider that transforms the config provider with the
specified function within the specified path.

**Signature**

```ts
export declare const within: {
  (path: Array<string>, f: (self: ConfigProvider) => ConfigProvider): (self: ConfigProvider) => ConfigProvider
  (self: ConfigProvider, path: Array<string>, f: (self: ConfigProvider) => ConfigProvider): ConfigProvider
}
```

Added in v1.0.0

# constructors

## fromEnv

A config provider that loads configuration from context variables,
using the default System service.

**Signature**

```ts
export declare const fromEnv: (config?: ConfigProvider.FromEnvConfig | undefined) => ConfigProvider
```

Added in v1.0.0

## fromFlat

Constructs a new `ConfigProvider` from a key/value (flat) provider, where
nesting is embedded into the string keys.

**Signature**

```ts
export declare const fromFlat: (flat: ConfigProvider.Flat) => ConfigProvider
```

Added in v1.0.0

## fromMap

Constructs a ConfigProvider using a map and the specified delimiter string,
which determines how to split the keys in the map into path segments.

**Signature**

```ts
export declare const fromMap: (
  map: Map<string, string>,
  config?: Partial<ConfigProvider.FromMapConfig> | undefined
) => ConfigProvider
```

Added in v1.0.0

## make

Creates a new config provider.

**Signature**

```ts
export declare const make: (
  load: <A>(config: Config.Config<A>) => Effect.Effect<never, ConfigError.ConfigError, A>,
  flattened: ConfigProvider.Flat
) => ConfigProvider
```

Added in v1.0.0

## makeFlat

Creates a new flat config provider.

**Signature**

```ts
export declare const makeFlat: (
  load: <A>(
    path: Array<string>,
    config: Config.Config.Primitive<A>
  ) => Effect.Effect<never, ConfigError.ConfigError, A[]>,
  enumerateChildren: (path: Array<string>) => Effect.Effect<never, ConfigError.ConfigError, HashSet.HashSet<string>>,
  patch: PathPatch.PathPatch
) => ConfigProvider.Flat
```

Added in v1.0.0

# context

## ConfigProvider

The service tag for `ConfigProvider`.

**Signature**

```ts
export declare const ConfigProvider: Context.Tag<ConfigProvider, ConfigProvider>
```

Added in v1.0.0

# models

## ConfigProvider (interface)

A ConfigProvider is a service that provides configuration given a description
of the structure of that configuration.

**Signature**

```ts
export interface ConfigProvider extends ConfigProvider.Proto {
  /**
   * Loads the specified configuration, or fails with a config error.
   */
  load<A>(config: Config.Config<A>): Effect.Effect<never, ConfigError.ConfigError, A>
  /**
   * Flattens this config provider into a simplified config provider that knows
   * only how to deal with flat (key/value) properties.
   */
  flattened: ConfigProvider.Flat
}
```

Added in v1.0.0

# symbols

## ConfigProviderTypeId

**Signature**

```ts
export declare const ConfigProviderTypeId: typeof ConfigProviderTypeId
```

Added in v1.0.0

## ConfigProviderTypeId (type alias)

**Signature**

```ts
export type ConfigProviderTypeId = typeof ConfigProviderTypeId
```

Added in v1.0.0

## FlatConfigProviderTypeId

**Signature**

```ts
export declare const FlatConfigProviderTypeId: typeof FlatConfigProviderTypeId
```

Added in v1.0.0

## FlatConfigProviderTypeId (type alias)

**Signature**

```ts
export type FlatConfigProviderTypeId = typeof FlatConfigProviderTypeId
```

Added in v1.0.0

# utils

## contramapPath

Returns a new config provider that will automatically tranform all path
configuration names with the specified function. This can be utilized to
adapt the names of configuration properties from one naming convention to
another.

**Signature**

```ts
export declare const contramapPath: {
  (f: (path: string) => string): (self: ConfigProvider) => ConfigProvider
  (self: ConfigProvider, f: (path: string) => string): ConfigProvider
}
```

Added in v1.0.0

## nested

Returns a new config provider that will automatically nest all
configuration under the specified property name. This can be utilized to
aggregate separate configuration sources that are all required to load a
single configuration value.

**Signature**

```ts
export declare const nested: {
  (name: string): (self: ConfigProvider) => ConfigProvider
  (self: ConfigProvider, name: string): ConfigProvider
}
```

Added in v1.0.0

## orElse

Returns a new config provider that preferentially loads configuration data
from this one, but which will fall back to the specified alternate provider
if there are any issues loading the configuration from this provider.

**Signature**

```ts
export declare const orElse: {
  (that: LazyArg<ConfigProvider>): (self: ConfigProvider) => ConfigProvider
  (self: ConfigProvider, that: LazyArg<ConfigProvider>): ConfigProvider
}
```

Added in v1.0.0

## unnested

Returns a new config provider that will automatically un-nest all
configuration under the specified property name. This can be utilized to
de-aggregate separate configuration sources that are all required to load a
single configuration value.

**Signature**

```ts
export declare const unnested: {
  (name: string): (self: ConfigProvider) => ConfigProvider
  (self: ConfigProvider, name: string): ConfigProvider
}
```

Added in v1.0.0
