#!/usr/bin/env -S node --conditions=bun
import { runGeneratorCli } from "@distilled.cloud/dev/codegen/cli";
import type { SdkSpec } from "@distilled.cloud/dev/codegen/generator";
import {
  ERROR_MATCHERS_TRAIT,
  NULLABLE_TRAIT,
  RAW_RESPONSE_TRAIT,
} from "@distilled.cloud/dev/codegen/openapi";

const sensitive = "smithy.api#sensitive";
const spec: SdkSpec = {
  nullableTrait: NULLABLE_TRAIT,
  errorMatchersTrait: ERROR_MATCHERS_TRAIT,
  unionStyle: "untagged",
  extraBindings: [
    {
      trait: RAW_RESPONSE_TRAIT,
      binding: "rawResponse",
      pipe: "T.RawResponse()",
      rootPipe: "T.RawResponseRoot()",
    },
  ],
  memberTraitPipes: { [sensitive]: "T.SensitiveValue" },
  memberSchema: (member, ref) =>
    sensitive in member.traits
      ? `S.Union([${ref(member.target)}, S.Redacted(${ref(member.target)}, { disallowJsonEncode: true })])`
      : undefined,
  memberTsType: (member, ref) =>
    sensitive in member.traits
      ? `${ref(member.target)} | Redacted.Redacted<${ref(member.target)}>${member.nullable ? " | null" : ""}`
      : undefined,
  paginationProfiles: {
    cursor: { strategy: "paginateCursor", itemsFallback: "result" },
  },
  operationDecl: {
    contextType: "ClickHouseOpContext",
    commonErrorType: "ClickHouseOpError",
    commonErrorClasses: ["UnknownClickHouseError"],
    protocol: "ClickHouseProtocol",
    retry: "Retry.Retry",
  },
  sourceNote: "specs/spec-mirror-clickhouse/specs/openapi.json",
  postProcess: (code) =>
    code.includes("Redacted.Redacted<")
      ? code.replace(
          `import * as S from "@distilled.cloud/core/schema-lite";`,
          `import * as S from "@distilled.cloud/core/schema-lite";\nimport * as Redacted from "effect/Redacted";`,
        )
      : code,
};

runGeneratorCli({
  description: "Generate the ClickHouse Cloud Effect SDK",
  root: `${import.meta.dirname}/..`,
  convert: () => import("./convert.ts"),
  spec: () => spec,
  barrelExportName: (name) =>
    name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
});
