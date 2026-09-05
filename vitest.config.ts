import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: ["unit", "contract", "integration", "privacy"].map((name) => ({
      test: {
        name,
        environment: "node",
        include: [`tests/${name}/**/*.test.ts`],
        passWithNoTests: false,
      },
    })),
  },
});
