import { defineConfig } from "@trigger.dev/sdk/v3";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";

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
  },
});
