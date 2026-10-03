import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.UI_URL || "http://localhost:8080",
  },
  reporter: [["list"]],
});
