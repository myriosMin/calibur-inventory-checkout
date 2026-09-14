// Import FIRST in any script that must only ever touch the `test` schema,
// before "./_env" or anything that creates a Supabase client. Forces the
// schema rather than trusting the shell: process.loadEnvFile() never
// overrides a variable that is already set, so this wins over .env.local.
process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = "test";
