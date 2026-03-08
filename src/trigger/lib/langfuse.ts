import { Langfuse } from "langfuse";
import { LLMResponse } from "../../lib/llm-client";

// Singleton — auto-reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASEURL env vars
let langfuse: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
  if (langfuse) return langfuse;
  if (!process.env.LANGFUSE_SECRET_KEY) return null;
  langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASEURL ?? process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com",
  });
  return langfuse;
}

/**
 * Wrap an LLM call with Langfuse tracing.
 * Creates a trace + generation with model, tokens, input, and output.
 * Falls back to a no-op wrapper if Langfuse isn't configured.
 */
export async function traceLLM(
  name: string,
  fn: () => Promise<LLMResponse>,
  input?: string,
): Promise<LLMResponse> {
  const lf = getLangfuse();
  if (!lf) return fn();

  const trace = lf.trace({ name });
  const generation = trace.generation({
    name,
    input: input ? input.slice(0, 10_000) : undefined, // cap to avoid huge payloads
  });

  try {
    const result = await fn();

    generation.end({
      output: result.response.slice(0, 10_000),
      model: result.modelId,
      usage: {
        input: result.inputTokens ?? undefined,
        output: result.outputTokens ?? undefined,
      },
    });

    await lf.flushAsync();
    return result;
  } catch (error) {
    generation.end({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
    });
    await lf.flushAsync();
    throw error;
  }
}
