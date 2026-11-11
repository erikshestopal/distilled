#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";

const url = "https://api.clickhouse.cloud/v1";
const response = await fetch(url, {
  headers: { accept: "application/json", "user-agent": "distilled.cloud-clickhouse-spec-mirror" },
});
if (!response.ok) throw new Error(`ClickHouse spec fetch failed: ${response.status}`);
const spec = (await response.json()) as Record<string, unknown>;
if (
  typeof spec.openapi !== "string" ||
  typeof spec.paths !== "object" ||
  spec.paths === null ||
  Object.keys(spec.paths).length === 0
) {
  throw new Error("ClickHouse returned an empty or invalid OpenAPI document");
}
await mkdir("../specs", { recursive: true });
await writeFile("../specs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log(`OpenAPI ${spec.openapi}: ${Object.keys(spec.paths).length} paths`);
