import { observe } from '@langfuse/tracing';

/**
 * Wrap an LLM call with Langfuse tracing.
 * Creates an OpenTelemetry span that gets exported to Langfuse
 * via the OTLPTraceExporter configured in trigger.config.ts.
 */
export function traceLLM<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const traced = observe(fn, { name });
  return traced();
}
