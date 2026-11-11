# spec-mirror-clickhouse

Snapshots the official [ClickHouse Cloud OpenAPI document](https://api.clickhouse.cloud/v1)
in `specs/openapi.json`, including deprecated operations. The daily mirror job
validates the document and commits changes.

From `.meta/`, run `pnpm install` and `pnpm run fetch-specs` to refresh it.

This repository is managed by the `distilled-submodules` stack in
[alchemy-run/distilled](https://github.com/alchemy-run/distilled).
Edit its scaffold there, not in the generated mirror repository.
