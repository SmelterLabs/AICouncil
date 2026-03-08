import { trace, SpanStatusCode } from "@opentelemetry/api";
import { LLMResponse } from "../../lib/llm-client";

const tracer = trace.getTracer("ai-council");

/**
 * Wrap an LLM call with OpenTelemetry tracing.
 * Sets gen_ai + OpenInference attributes so Langfuse displays each call
 * as an LLM generation with model, tokens, input, and output.
 */
export async function traceLLM(
  name: string,
  fn: () => Promise<LLMResponse>,
  input?: string,
): Promise<LLMResponse> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (input) span.setAttribute("input.value", input);

      const result = await fn();

      // Gen AI semantic conventions (Langfuse maps these natively)
      span.setAttribute("gen_ai.request.model", result.modelId);
      span.setAttribute("gen_ai.response.model", result.modelId);
      if (result.inputTokens != null)
        span.setAttribute("gen_ai.usage.input_tokens", result.inputTokens);
      if (result.outputTokens != null)
        span.setAttribute("gen_ai.usage.output_tokens", result.outputTokens);

      // OpenInference conventions (content display)
      span.setAttribute("output.value", result.response);

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  });
}
