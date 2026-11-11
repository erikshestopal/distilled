#!/usr/bin/env -S node --conditions=bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/dev/codegen/openapi-cli";
import { resolveSpecPath } from "@distilled.cloud/dev/codegen/spec-path";

const root = path.resolve(import.meta.dirname, "..");
const specPath = "specs/spec-mirror-clickhouse/specs/openapi.json";
const fullSpec = JSON.parse(await fs.readFile(resolveSpecPath(root, specPath), "utf8"));
const manual = JSON.parse(
  await fs.readFile(path.join(root, "manual-specs/click_pipes_ssh.json"), "utf8"),
);
const methods = ["get", "post", "put", "patch", "delete", "head", "options"];

// The Terraform-documented operations supplement, never replace, the official spec.
const operationIds = new Set<string>();
for (const item of Object.values<Record<string, any>>(fullSpec.paths)) {
  for (const method of methods) {
    const id = item[method]?.operationId;
    if (id) operationIds.add(id);
  }
}
for (const [route, addition] of Object.entries<Record<string, any>>(manual.paths)) {
  const existing = fullSpec.paths[route];
  for (const method of methods) {
    const operation = addition[method];
    if (!operation) continue;
    if (existing?.[method]) throw new Error(`Conflicting manual operation: ${method} ${route}`);
    if (!operation.operationId || operationIds.has(operation.operationId)) {
      throw new Error(`Conflicting manual operation ID: ${operation.operationId}`);
    }
    operationIds.add(operation.operationId);
  }
  if (!existing) {
    fullSpec.paths[route] = addition;
    continue;
  }
  // Put new path parameters on manual methods so existing operations stay unchanged.
  const extraParameters = [];
  for (const parameter of addition.parameters ?? []) {
    const current = (existing.parameters ?? []).find(
      (p: any) => p.name === parameter.name && p.in === parameter.in,
    );
    if (current && JSON.stringify(current) !== JSON.stringify(parameter)) {
      throw new Error(`Conflicting manual parameter: ${route} ${parameter.in} ${parameter.name}`);
    }
    if (!current) extraParameters.push(parameter);
  }
  for (const [key, value] of Object.entries(addition)) {
    if (key === "parameters") continue;
    if (!methods.includes(key)) {
      if (key in existing && JSON.stringify(existing[key]) !== JSON.stringify(value)) {
        throw new Error(`Conflicting manual path field: ${route} ${key}`);
      }
      if (!(key in existing)) existing[key] = value;
      continue;
    }
    existing[key] = {
      ...value,
      parameters: [...extraParameters, ...((value as any).parameters ?? [])],
    };
  }
}
for (const [section, entries] of Object.entries<Record<string, any>>(manual.components ?? {})) {
  const target = (fullSpec.components[section] ??= {});
  for (const [name, definition] of Object.entries(entries)) {
    if (name in target && JSON.stringify(target[name]) !== JSON.stringify(definition)) {
      throw new Error(`Conflicting manual component: ${section}/${name}`);
    }
    if (!(name in target)) target[name] = definition;
  }
}
const tags = new Set<string>();
for (const item of Object.values<Record<string, any>>(fullSpec.paths)) {
  for (const method of methods) {
    if (item[method]) tags.add(item[method].tags?.[0] ?? "Misc");
  }
}

const slug = (tag: string) =>
  tag
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

await runOpenApiConvert({
  root,
  specs: [...tags].sort().map((tag) => ({
    name: slug(tag),
    specPath,
    options: { namespace: `com.clickhouse.${slug(tag)}` },
    preprocess: () => {
      const spec = structuredClone(fullSpec);
      for (const [route, item] of Object.entries<Record<string, any>>(spec.paths)) {
        for (const method of methods) {
          if (item[method] && (item[method].tags?.[0] ?? "Misc") !== tag) delete item[method];
        }
        if (!methods.some((method) => item[method])) delete spec.paths[route];
      }
      return spec;
    },
  })),
  options: {
    namespace: "com.clickhouse.api",
    serviceName: "ClickHouse",
    skipDeprecated: false,
    extraHttpMethods: ["head", "options"],
    headerParams: true,
    successStatuses: ["200", "201", "202", "204"],
  },
});
