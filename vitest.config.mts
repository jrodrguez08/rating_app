import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    maxWorkers: 4,
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    exclude: [...configDefaults.exclude, "tests/firebase/**", "tests/e2e/**"],
  },
});
