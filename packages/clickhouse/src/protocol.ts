import type * as API from "@distilled.cloud/core/api";
import type { API_ERRORS, ConfigError, InvalidInput } from "@distilled.cloud/core/errors";
import { makeRestProtocol } from "@distilled.cloud/core/protocol-rest";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as Layer from "effect/Layer";
import { Credentials, formatHeaders, type CredentialsConfig } from "./credentials.ts";
import { ClickHouseParseError, UnknownClickHouseError } from "./errors.ts";

export type ClickHouseOpContext = Credentials | HttpClient.HttpClient;
export type ClickHouseOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | ConfigError
  | InvalidInput
  | HttpClientError.HttpClientError
  | ClickHouseParseError
  | UnknownClickHouseError;

export const ClickHouseProtocol: Layer.Layer<API.Protocol> = makeRestProtocol<CredentialsConfig>({
  credentials: Credentials,
  baseUrl: (config) => config.apiBaseUrl,
  headers: formatHeaders,
  errorEnvelope: (body) => {
    if (typeof body !== "object" || body === null) return undefined;
    const envelope = body as { error?: unknown };
    return typeof envelope.error === "string" ? { message: envelope.error } : undefined;
  },
  unknownError: ({ code, message, body }) =>
    new UnknownClickHouseError({
      code: code === undefined ? undefined : String(code),
      message,
      body,
    }),
  parseError: ({ body, cause }) => new ClickHouseParseError({ body, cause }),
});
