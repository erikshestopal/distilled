import * as Config from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export const DEFAULT_API_BASE_URL = "https://api.clickhouse.cloud";

export interface CredentialsConfig {
  readonly apiKey: Redacted.Redacted<string>;
  readonly apiSecret: Redacted.Redacted<string>;
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<CredentialsConfig, ConfigError>
>()("ClickHouseCredentials") {}

export const credentials = (config: {
  readonly apiKey: Redacted.Redacted<string>;
  readonly apiSecret: Redacted.Redacted<string>;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      ...config,
      apiBaseUrl: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  Config.all({
    apiKey: Config.Redacted("CLICKHOUSE_CLOUD_API_KEY"),
    apiSecret: Config.Redacted("CLICKHOUSE_CLOUD_API_SECRET"),
    apiBaseUrl: Config.String("CLICKHOUSE_CLOUD_API_BASE_URL").pipe(
      Config.withDefault(DEFAULT_API_BASE_URL),
    ),
  }).pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "CLICKHOUSE_CLOUD_API_KEY and CLICKHOUSE_CLOUD_API_SECRET environment variables are required",
        }),
    ),
  ),
);

export const formatHeaders = (config: CredentialsConfig): Record<string, string> => ({
  Authorization: `Basic ${btoa(`${Redacted.value(config.apiKey)}:${Redacted.value(config.apiSecret)}`)}`,
});
