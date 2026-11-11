import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** SQL credentials are separate from Cloud management API keys. */
export interface SqlCredentials {
  readonly url: string;
  readonly username: string;
  readonly password: Redacted.Redacted<string>;
  readonly database?: string;
}

/** Values for ClickHouse's `{name:Type}` query parameters. */
export type SqlParameter = string | number | bigint | boolean | null;
export type SqlParameters = Readonly<Record<string, SqlParameter>>;

export interface Statement {
  readonly sql: string;
  readonly parameters?: SqlParameters;
}

export type InsertFormat = "JSONEachRow" | "CSV" | "TabSeparated" | "RowBinary";

export interface Insert {
  readonly database: string;
  readonly table: string;
  readonly format: InsertFormat;
  readonly values: Uint8Array;
}

/** A ClickHouse server response or an invalid SQL endpoint/request. */
export class SqlError extends Data.TaggedError("ClickHouseSqlError")<{
  readonly message: string;
  readonly status?: number;
  readonly code?: number;
  readonly detail?: Redacted.Redacted<string>;
}> {}

/** The request's outcome is unknown; the server may still execute it. */
export class SqlTransportError extends Data.TaggedError("ClickHouseSqlTransportError")<{
  readonly message: string;
}> {}

const escapeParameter = (value: SqlParameter): string => {
  if (value === null) return "\\N";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\0", "\\0")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
};

const serverError = (detail: string, status: number, codeHeader?: string): SqlError => {
  const code = codeHeader && /^\d+$/.test(codeHeader) ? Number(codeHeader) : undefined;
  return new SqlError({
    message: "ClickHouse SQL request failed",
    status,
    code,
    detail: Redacted.make(detail),
  });
};

const JsonResult = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  exception: Schema.optional(Schema.String),
});

/**
 * Uses the calling fiber's HttpClient, like generated distilled operations.
 * No retry or redirect combinators are installed; FetchHttpClient requests use
 * manual redirects. A substituted transport must not retry writes or follow
 * redirects with credentials. Disconnected requests may still finish server-side.
 * Responses are buffered; streaming and session state are unsupported.
 */
export const makeSqlClient = (credentials: SqlCredentials) => {
  const execute = Effect.fnUntraced(function* (input: {
    readonly statement: Statement;
    readonly body?: Uint8Array;
    readonly format?: "JSON";
  }) {
    const url = yield* Effect.try({
      try: () => new URL(credentials.url),
      catch: () => new SqlError({ message: "Invalid ClickHouse SQL endpoint" }),
    });
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      credentials.username.includes(":")
    ) {
      return yield* new SqlError({
        message: "ClickHouse SQL endpoint must be HTTPS without credentials, query, or fragment",
      });
    }
    const parameters = input.statement.parameters ?? {};
    for (const [name, value] of Object.entries(parameters)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return yield* new SqlError({ message: "Invalid ClickHouse parameter name" });
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        return yield* new SqlError({ message: "ClickHouse numeric parameters must be finite" });
      }
    }
    const auth = yield* Effect.sync(() => {
      const bytes = new TextEncoder().encode(
        `${credentials.username}:${Redacted.value(credentials.password)}`,
      );
      return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
    });
    const request = yield* Effect.sync(() => {
      let request = HttpClientRequest.post(url.toString()).pipe(
        HttpClientRequest.setHeader("authorization", auth),
        HttpClientRequest.setUrlParam("wait_end_of_query", "1"),
      );
      if (credentials.database !== undefined) {
        request = HttpClientRequest.setUrlParam(request, "database", credentials.database);
      }
      if (input.format)
        request = HttpClientRequest.setUrlParam(request, "default_format", input.format);
      if (input.body !== undefined) {
        request = HttpClientRequest.setUrlParam(request, "query", input.statement.sql);
        for (const [name, value] of Object.entries(parameters)) {
          request = HttpClientRequest.setUrlParam(request, `param_${name}`, escapeParameter(value));
        }
        return HttpClientRequest.bodyUint8Array(request, input.body);
      }
      const form = new FormData();
      form.set("query", input.statement.sql);
      for (const [name, value] of Object.entries(parameters)) {
        form.set(`param_${name}`, escapeParameter(value));
      }
      return HttpClientRequest.bodyFormData(request, form);
    });
    const { response, body } = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* HttpClient.withScope(client).execute(request);
      const body = yield* response.text;
      return { response, body };
    }).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.scoped,
      Effect.mapError(
        () =>
          new SqlTransportError({
            message: "ClickHouse SQL response was lost; the outcome is unknown",
          }),
      ),
    );
    const tag = response.headers["x-clickhouse-exception-tag"];
    if (response.status < 200 || response.status >= 300) {
      return yield* serverError(
        body,
        response.status,
        response.headers["x-clickhouse-exception-code"],
      );
    }
    if (tag && /^[A-Za-z0-9]{16}$/.test(tag)) {
      const marker = `\r\n__exception__\r\n${tag}\r\n`;
      const start = body.lastIndexOf(marker);
      if (start >= 0 && body.endsWith(`${tag}\r\n__exception__\r\n`)) {
        return yield* serverError(body.slice(start + marker.length), response.status);
      }
    }
    return body;
  });

  return {
    /** Query data as JSON. SQL remains subject to the user's grants. */
    query: (statement: Statement) =>
      execute({ statement, format: "JSON" }).pipe(
        Effect.flatMap((body) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(JsonResult))(body).pipe(
            Effect.mapError(() => new SqlError({ message: "Invalid ClickHouse JSON response" })),
          ),
        ),
        Effect.flatMap((result) =>
          result.exception !== undefined
            ? Effect.fail(serverError(result.exception, 200))
            : Effect.succeed(result.data),
        ),
      ),
    /** Execute one statement, without automatically retrying a lost response. */
    command: (statement: Statement) =>
      execute({ statement }).pipe(
        Effect.flatMap((body) =>
          body.trim() === ""
            ? Effect.void
            : Effect.fail(
                new SqlError({
                  message: "Unexpected ClickHouse command response",
                  detail: Redacted.make(body),
                }),
              ),
        ),
      ),
    /** Insert a complete payload in one of the explicitly supported formats. */
    insert: (input: Insert) =>
      Effect.suspend(() => {
        if (
          !(
            input.format === "JSONEachRow" ||
            input.format === "CSV" ||
            input.format === "TabSeparated" ||
            input.format === "RowBinary"
          )
        ) {
          return Effect.fail(new SqlError({ message: "Unsupported ClickHouse insert format" }));
        }
        return execute({
          statement: {
            sql: `INSERT INTO {database:Identifier}.{table:Identifier} SETTINGS async_insert = 0 FORMAT ${input.format}`,
            parameters: { database: input.database, table: input.table },
          },
          body: input.values,
        }).pipe(
          Effect.flatMap((body) =>
            body.trim() === ""
              ? Effect.void
              : Effect.fail(
                  new SqlError({
                    message: "Unexpected ClickHouse insert response",
                    detail: Redacted.make(body),
                  }),
                ),
          ),
        );
      }),
  };
};
