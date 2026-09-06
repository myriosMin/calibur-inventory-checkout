import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";

// Every script under scripts/ runs standalone via `npx tsx scripts/x.ts`,
// outside Next.js's own env loading -- import this first (before anything
// that reads process.env) to load .env.local the same way `next dev`/`next
// build` would.
const envPath = path.resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}
