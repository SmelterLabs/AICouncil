import { defineConfig } from "@trigger.dev/sdk/v3";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";

// Only forward LLM-related spans to Langfuse (filters out Trigger.dev internal noise)
function createFilteredExporter(inner: OTLPTraceExporter) {
  return {
    export(spans: any[], resultCallback: (result: { code: number }) => void) {
      const filtered = spans.filter((s: any) => {
        const lib: string = s.instrumentationLibrary?.name ?? "";
        return lib === "ai-council" || lib.includes("openinference");
      });
      if (filtered.length > 0) {
        inner.export(filtered, resultCallback);
      } else {
        resultCallback({ code: 0 }); // ExportResultCode.SUCCESS
      }
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush(),
  };
}

export default defineConfig({
  project: "proj_apzdtbbbzumcfgyqcztp",
  runtime: "node",
  logLevel: "log",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  telemetry: {
    instrumentations: [
      new AnthropicInstrumentation(),
      new OpenAIInstrumentation(),
    ],
    exporters: process.env.LANGFUSE_SECRET_KEY
      ? [
          createFilteredExporter(
            new OTLPTraceExporter({
              url: `${process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com"}/api/public/otel/v1/traces`,
              headers: {
                Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`,
              },
            })
          ) as any,
        ]
      : [],
  },
});
