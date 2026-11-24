import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    env: { VITE_API_BASE_URL: "http://api.test" },
  },
});
