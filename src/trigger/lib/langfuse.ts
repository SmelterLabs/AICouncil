import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { AnthropicInstrumentation } from '@arizeai/openinference-instrumentation-anthropic';
import { observe } from '@langfuse/tracing';

let langfuseProcessor: LangfuseSpanProcessor | null = null;

/**
 * Initialize Langfuse + OpenTelemetry. Called once from trigger.config.ts init().
 * MUST run before any Anthropic instances are created.
 */
export function initLangfuse() {
  if (!process.env.LANGFUSE_SECRET_KEY) return;

  langfuseProcessor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com',
  });

  const sdk = new NodeSDK({
    spanProcessors: [langfuseProcessor],
    instrumentations: [new AnthropicInstrumentation()],
  });

  sdk.start();
}

/**
 * Flush all pending spans. Call at the end of every Trigger.dev task run.
 */
export async function flushLangfuse(): Promise<void> {
  if (langfuseProcessor) {
    await langfuseProcessor.forceFlush();
  }
}

/**
 * Wrap an LLM call with Langfuse tracing.
 */
export function traceLLM<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const traced = observe(fn, { name });
  return traced();
}
