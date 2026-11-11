/**
 * Effect-native ClickHouse Cloud management API.
 *
 * @example
 * ```ts
 * import { Config, Effect, Layer } from "effect";
 * import * as FetchHttpClient from "effect/http/FetchHttpClient";
 * import * as ClickHouse from "@distilled.cloud/clickhouse";
 *
 * const program = Effect.gen(function* () {
 *   const organizationId = yield* Config.String("CLICKHOUSE_CLOUD_ORGANIZATION_ID");
 *   const organization = yield* ClickHouse.organization.getOrganization({ organizationId });
 *   yield* Effect.log(organization.result);
 * });
 *
 * const Live = Layer.mergeAll(
 *   FetchHttpClient.layer,
 *   ClickHouse.CredentialsFromEnv,
 *   ClickHouse.ClickHouseProtocol,
 * );
 *
 * program.pipe(Effect.provide(Live), Effect.runPromise);
 * ```
 */
export * from "./credentials.ts";
export * from "./errors.ts";
export * as T from "./traits.ts";
export * from "./protocol.ts";
export * from "./pagination.ts";
export * as Retry from "./retry.ts";
export * from "./services/index.ts";
