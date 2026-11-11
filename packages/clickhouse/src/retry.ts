import { type Policy, throttlingFactory, transientFactory } from "@distilled.cloud/core/retry";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
export * from "@distilled.cloud/core/retry";

export class Retry extends Context.Service<Retry, Policy>()("ClickHouseRetry") {}
export const policy = (value: Policy) => Effect.provide(Layer.succeed(Retry, value));
export const none = policy({ while: () => false });
export const throttling = policy(throttlingFactory);
export const transient = policy(transientFactory);
