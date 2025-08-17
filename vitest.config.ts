import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: ["./tsconfig.json"]
    })
  ],
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["json"],
      extension: [".ts"],
      include: ["./src/**/*.ts"],
      exclude: ["**/*.test.ts", "tmp/**"],
      enabled: true,
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
      ignoreEmptyLines: true,
      reportsDirectory: "./coverage",
      processingConcurrency: 10,
      watermarks: {
        branches: [80, 100],
        functions: [80, 100],
        lines: [80, 100],
        statements: [80, 100]
      },
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
