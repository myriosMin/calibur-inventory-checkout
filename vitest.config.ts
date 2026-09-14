import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests (tests/integration/**) make real network calls
    // (Supabase + the Telegram Bot API), so the default 5s per-test timeout
    // is too tight.
    testTimeout: 20000,
    // Integration tests share one live remote Supabase project and a small
    // set of fixture rows (one test member, a few named robots/products).
    // Vitest's default per-file parallelism runs multiple test files
    // concurrently, which races those shared rows against each other (e.g.
    // one file's "borrow to Hero" mutates the exact holdings another file is
    // asserting on mid-run). Forcing sequential file execution trades some
    // wall-clock time for tests that are actually deterministic.
    fileParallelism: false,
    // Every test talks to the `test` schema, never `public` (the real
    // inventory). Set here rather than in .env.local so it cannot be
    // forgotten, and process.loadEnvFile() in scripts/_env.ts never
    // overrides a variable that is already set. src/lib/supabase/schema.ts.
    env: {
      NEXT_PUBLIC_SUPABASE_SCHEMA: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
