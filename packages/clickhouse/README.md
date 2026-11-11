# @distilled.cloud/clickhouse

Effect-native ClickHouse Cloud management SDK, generated from the
[official OpenAPI document](https://api.clickhouse.cloud/v1).
Includes all 190 management operations across 16 primary tags, including deprecated endpoints.

## Installation

```bash
npm install @distilled.cloud/clickhouse effect
```

## Quick start

Set `CLICKHOUSE_CLOUD_API_KEY`, `CLICKHOUSE_CLOUD_API_SECRET`, and
`CLICKHOUSE_CLOUD_ORGANIZATION_ID` before running this read-only example:

```ts
import { Config, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ClickHouse from "@distilled.cloud/clickhouse";

const program = Effect.gen(function* () {
  const organizationId = yield* Config.String("CLICKHOUSE_CLOUD_ORGANIZATION_ID");
  const organization = yield* ClickHouse.organization.getOrganization({ organizationId });
  yield* Effect.log(organization.result);
});

const Live = Layer.mergeAll(
  FetchHttpClient.layer,
  ClickHouse.CredentialsFromEnv,
  ClickHouse.ClickHouseProtocol,
);

program.pipe(Effect.provide(Live), Effect.runPromise);
```

## Authentication

`CredentialsFromEnv` reads `CLICKHOUSE_CLOUD_API_KEY` and
`CLICKHOUSE_CLOUD_API_SECRET` as redacted values on each request.
Requests use `Authorization: Basic base64(apiKey:apiSecret)`.
The default host is `https://api.clickhouse.cloud`; generated routes include `/v1`.
Override the host with `CLICKHOUSE_CLOUD_API_BASE_URL` or supply a layer directly:

```ts
import { Redacted } from "effect";

const credentials = ClickHouse.credentials({
  apiKey: Redacted.make("your-api-key"),
  apiSecret: Redacted.make("your-api-secret"),
});
```

API keys need the permissions listed on each official endpoint. Organization IDs
remain explicit operation inputs, not credential configuration.

## Services and wire values

The root exports `apiKeys`, `backup`, `billing`, `clickPipes`, `clickStack`,
`notifications`, `organization`, `postgres`, `prometheus`, `queryApiEndpoints`,
`roleManagement`, `savedQueries`, `service`, `snapshot`, `udf`, and `userManagement`.
Individual modules are also available at subpaths such as
`@distilled.cloud/clickhouse/role_management`.

Member names keep their official wire spelling. Responses retain the
`{ status, requestId, result }` envelope where the API declares one.
Prometheus metrics and Postgres PEM certificates return their complete raw strings.
Secrets in generated inputs accept strings or `Redacted` values; sensitive response
members are wrapped in `Redacted`. Prefer redacted inputs to keep credentials out of logs.

## Pagination, retries, and errors

The 12 cursor-based list operations expose `.pages(input)` and `.items(input)`
streams. They pass `nextCursor` back as `cursor` until it is null or absent.
Offset-based endpoints retain their `offset` and `limit` inputs for manual paging.
Retry policy layers use the shared core retry implementation through `ClickHouse.Retry`.
Management operations default to at most eight transient retries. Use `Retry.none`
for writes whose outcome would be ambiguous after a lost reply.

The shared REST protocol maps documented HTTP failures to tagged errors, preserves
ClickHouse's `error` message, and exposes `ClickHouseParseError` for opt-in response
validation. A role-specific 404 message produces `roleManagement.RoleNotFound` on
role GET, PATCH, and DELETE; unrelated 404s remain `NotFound`.

## Regeneration

The production source is `specs/spec-mirror-clickhouse/specs/openapi.json`.
Until the shared mirror is deployed, materialize its local scaffold and generate:

```bash
pnpm specs:local clickhouse
DISTILLED_SPECS_LOCAL=1 pnpm generate clickhouse
```

Smithy patches live in `patches/<service>/`. Do not edit generated service modules.
