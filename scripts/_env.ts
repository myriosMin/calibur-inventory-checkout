import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";

// Every script under scripts/ runs standalone via `npx tsx scripts/x.ts`,
// outside Next.js's own env loading -- import this first (before anything
// that reads process.env) to load .env.local the same way `next dev`/`next
// build` would.
//
// ENV_FILE points a script at a different project without touching
// .env.local, e.g. `ENV_FILE=.env.production.local npx tsx scripts/bootstrap-admin.ts`.
// A named file that doesn't exist is an error: silently falling back to the
// dev project is exactly how real data ends up in the wrong database.
const envFile = process.env.ENV_FILE;
const envPath = path.resolve(process.cwd(), envFile ?? ".env.local");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
} else if (envFile) {
  throw new Error(`ENV_FILE=${envFile} not found at ${envPath}`);
}
