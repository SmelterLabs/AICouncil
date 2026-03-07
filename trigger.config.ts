import { defineConfig } from "@trigger.dev/sdk/v3";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";

export default defineConfig({
  project: "proj_apzdtbbbzumcfgyqcztp",
  runtime: "node",
  logLevel: "log",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  telemetry: {
    instrumentations: [new AnthropicInstrumentation()],
    exporters: process.env.LANGFUSE_SECRET_KEY
      ? [
          new OTLPTraceExporter({
            url: `${process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com"}/api/public/otel/v1/traces`,
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`,
            },
          }),
        ]
      : [],
  },
});
