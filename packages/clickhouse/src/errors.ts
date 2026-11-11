export * from "@distilled.cloud/core/errors";
import * as Category from "@distilled.cloud/core/category";
import * as Schema from "@distilled.cloud/core/schema-lite-typed";

export class UnknownClickHouseError extends Schema.TaggedError<UnknownClickHouseError>()(
  "UnknownClickHouseError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

export class ClickHouseParseError extends Schema.TaggedError<ClickHouseParseError>()(
  "ClickHouseParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}
