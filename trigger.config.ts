import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_apzdtbbbzumcfgyqcztp",
  runtime: "node",
  logLevel: "log",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  init: async () => {
    const { initLangfuse } = await import("./src/trigger/lib/langfuse");
    initLangfuse();
  },
});
