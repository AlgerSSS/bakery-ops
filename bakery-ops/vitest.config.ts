import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/e2e/**"],
  },
  resolve: {
    alias: [
      { find: /^@\/modules\/(.*)/, replacement: path.resolve(__dirname, "src/modules/$1") },
      { find: /^@\/app\/(.*)/, replacement: path.resolve(__dirname, "src/app/$1") },
      { find: /^@\/components\/(.*)/, replacement: path.resolve(__dirname, "components/$1") },
      { find: /^@\/hooks\/(.*)/, replacement: path.resolve(__dirname, "hooks/$1") },
      { find: /^@\/constants(.*)/, replacement: path.resolve(__dirname, "constants$1") },
      { find: /^@\/config\/(.*)/, replacement: path.resolve(__dirname, "config/$1") },
      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
});

