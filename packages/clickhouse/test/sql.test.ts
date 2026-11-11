import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { expect, test } from "vitest";
import { makeSqlClient } from "../src/sql.ts";

const testEffect = (
  name: string,
  body: () => Effect.Effect<void, unknown, HttpClient.HttpClient>,
) => test(name, () => Effect.runPromise(body().pipe(Effect.provide(FetchHttpClient.layer))));
const sql = makeSqlClient({
  url: "https://sql.example.invalid",
  username: "reader",
  password: Redacted.make("test-password"),
  database: "analytics",
});

testEffect("sends SQL values in multipart fields and redacts credentials from the URL", () =>
  Effect.gen(function* () {
    const fetch = (input: string | URL | Request, init?: RequestInit) =>
      Effect.runPromise(
        Effect.sync(() => {
          expect(init?.method).toBe("POST");
          expect(String(input)).not.toContain("test-password");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            `Basic ${btoa("reader:test-password")}`,
          );
          expect(init?.redirect).toBe("manual");
          expect(init?.body instanceof FormData).toBe(true);
          if (init?.body instanceof FormData) {
            expect(init.body.get("query")).toBe("SELECT {value:String}");
            expect(init.body.get("param_value")).toBe("a\\tb\\n\\\\c");
          }
          return new Response('{"data":[{"value":"ok"}]}');
        }),
      );
    const rows = yield* sql
      .query({ sql: "SELECT {value:String}", parameters: { value: "a\tb\n\\c" } })
      .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));
    expect(rows).toEqual([{ value: "ok" }]);
  }),
);

testEffect("passes quoted identifiers as parameters for inserts", () =>
  Effect.gen(function* () {
    const fetch = (input: string | URL | Request, init?: RequestInit) =>
      Effect.runPromise(
        Effect.sync(() => {
          const params = new URL(String(input)).searchParams;
          expect(params.get("query")).toBe(
            "INSERT INTO {database:Identifier}.{table:Identifier} SETTINGS async_insert = 0 FORMAT JSONEachRow",
          );
          expect(params.get("param_database")).toBe("db`; DROP DATABASE other;--");
          expect(params.get("param_table")).toBe("events` DROP TABLE x");
          expect(init?.body instanceof Uint8Array).toBe(true);
          return new Response("");
        }),
      );
    yield* sql
      .insert({
        database: "db`; DROP DATABASE other;--",
        table: "events` DROP TABLE x",
        format: "JSONEachRow",
        values: new TextEncoder().encode('{"value":1}\n'),
      })
      .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));
  }),
);

testEffect("reports server errors including errors after a 200 response", () =>
  Effect.gen(function* () {
    for (const response of [
      new Response("Code: 497. DB::Exception: denied", {
        status: 403,
        headers: { "x-clickhouse-exception-code": "497" },
      }),
      new Response(
        '{"data":[]}\r\n__exception__\r\nabcdefghijklmnop\r\nCode: 395. DB::Exception: failed\r\n31 abcdefghijklmnop\r\n__exception__\r\n',
        {
          headers: { "x-clickhouse-exception-tag": "abcdefghijklmnop" },
        },
      ),
      new Response('{"data":[],"exception":"Code: 395. failed"}'),
      new Response('{"data":[],"exception":""}'),
      new Response("not-json"),
    ]) {
      const fetch = (_input: string | URL | Request, _init?: RequestInit) =>
        Effect.runPromise(Effect.succeed(response));
      const result = yield* Effect.result(
        sql.query({ sql: "SELECT 1" }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("ClickHouseSqlError");
        expect(String(result.failure)).not.toContain("DB::Exception");
      }
    }
  }),
);

testEffect("does not resend commands or inserts after a lost reply", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const fetch = Object.assign(
      (_input: string | URL | Request, _init?: RequestInit) => {
        attempts++;
        return Effect.runPromise(Effect.fail(new Error("reply lost")));
      },
      { preconnect: () => {} },
    );
    const command = yield* Effect.result(
      sql
        .command({ sql: "CREATE TABLE t (x UInt8)" })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    );
    const insert = yield* Effect.result(
      sql
        .insert({ database: "db", table: "t", format: "CSV", values: new Uint8Array([49]) })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    );
    expect(Result.isFailure(command)).toBe(true);
    expect(Result.isFailure(insert)).toBe(true);
    if (Result.isFailure(command)) {
      expect(command.failure._tag).toBe("ClickHouseSqlTransportError");
      expect(JSON.stringify(command.failure)).not.toContain("test-password");
      expect(JSON.stringify(command.failure)).not.toContain("reply lost");
    }
    expect(attempts).toBe(2);
  }),
);

testEffect("rejects unsafe endpoints and redirects without forwarding credentials", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const fetch = (_input: string | URL | Request, init?: RequestInit) => {
      attempts++;
      expect(init?.redirect).toBe("manual");
      return Effect.runPromise(
        Effect.succeed(
          new Response("", {
            status: 302,
            headers: { location: "https://attacker.example.invalid/" },
          }),
        ),
      );
    };
    for (const url of [
      "http://sql.example.invalid",
      "https://user:pass@sql.example.invalid",
      "https://sql.example.invalid/?secret=value",
    ]) {
      const client = makeSqlClient({
        url,
        username: "reader",
        password: Redacted.make("test-password"),
      });
      const result = yield* Effect.result(
        client.query({ sql: "SELECT 1" }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
      );
      expect(Result.isFailure(result)).toBe(true);
    }
    expect(attempts).toBe(0);
    const redirected = yield* Effect.result(
      sql
        .command({ sql: "CREATE DATABASE x" })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
    );
    expect(Result.isFailure(redirected)).toBe(true);
    expect(attempts).toBe(1);
  }),
);

test("uses the supplied HttpClient and closes each response scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const signals: AbortSignal[] = [];
      const client = HttpClient.make((request, _url, signal) =>
        Effect.sync(() => {
          signals.push(signal);
          return HttpClientResponse.fromWeb(request, new Response('{"data":[{"value":7}]}'));
        }),
      );
      for (let index = 0; index < 2; index++) {
        expect(
          yield* sql
            .query({ sql: "SELECT 7 AS value" })
            .pipe(Effect.provideService(HttpClient.HttpClient, client)),
        ).toEqual([{ value: 7 }]);
        expect(signals[index]?.aborted).toBe(true);
      }
      expect(signals[0]).not.toBe(signals[1]);
    }),
  ));
