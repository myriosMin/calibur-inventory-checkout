import { generateScanCode } from "@/lib/codes/generate";
import type { getBrowserClient } from "@/lib/supabase/browser";
import type { Tables, TablesInsert } from "@/lib/types/database";

export type ScanCodeRow = Tables<"scan_codes">;
/** Payload for a new code with the code itself left to this module. */
export type ScanCodePayload = Omit<TablesInsert<"scan_codes">, "code">;

type CodesClient = ReturnType<typeof getBrowserClient>;

/** PostgREST/Postgres error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = "23505";
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Rows per insert round-trip when bulk-generating. Kept well under the
 * ~500-label print run so a single collision or a transient failure retries
 * a chunk rather than the whole shelf, and so the UI can report progress.
 */
export const BULK_CHUNK_SIZE = 50;

/** Shape PostgREST errors arrive in. Not an `Error` instance. */
interface PostgrestLikeError {
  message: string;
  code?: string;
}

function isUniqueViolation(error: PostgrestLikeError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * Draws `count` codes that are distinct from each other *and* from anything
 * already handed out during this run. Intra-batch duplicates would trip the
 * same 23505 as a real collision but would never resolve on retry if the
 * generator happened to be reused naively, so they are excluded up front.
 */
function drawCodes(count: number, used: Set<string>): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    const code = generateScanCode();
    if (used.has(code)) continue;
    used.add(code);
    codes.push(code);
  }
  return codes;
}

/**
 * Inserts a new scan_codes row, generating a fresh code client-side each
 * attempt. `code` is the table's primary key, so a collision surfaces as a
 * unique-violation on insert -- astronomically unlikely at 7 chars, but the
 * plan requires handling it gracefully rather than assuming it can't happen.
 */
export async function insertScanCodeWithRetry(
  supabase: CodesClient,
  payload: ScanCodePayload,
): Promise<ScanCodeRow> {
  let lastError: PostgrestLikeError | null = null;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateScanCode();
    const { data, error } = await supabase
      .from("scan_codes")
      .insert({ ...payload, code })
      .select("*")
      .single();

    if (!error) return data;

    lastError = error;
    if (!isUniqueViolation(error)) {
      // Any other error (e.g. the code_target CHECK constraint) won't be
      // fixed by retrying with a different code -- fail immediately.
      throw error;
    }
    // Unique violation on `code`: loop and try a freshly generated one.
  }

  throw new Error(
    `Could not generate a unique scan code after ${MAX_CODE_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

export interface BulkInsertOptions {
  chunkSize?: number;
  /** Called after each chunk lands, for a "142 of 380" style readout. */
  onProgress?: (inserted: number, total: number) => void;
}

/**
 * Bulk variant for the label print run: one insert per chunk instead of one
 * per product. Creating ~360-500 codes a row at a time means ~500 sequential
 * round-trips to Singapore, which is minutes of spinner and a half-finished
 * shelf if the tab is closed halfway.
 *
 * Collision handling matches the single-row path: a 23505 anywhere in the
 * chunk fails the *whole* chunk (an insert is atomic), so the retry redraws
 * every code in that chunk. Earlier chunks that already committed are kept
 * and returned -- re-running the bulk generate is idempotent at the level
 * that matters, because the caller recomputes "which products still have no
 * active code" from the database each time.
 */
export async function insertScanCodesWithRetry(
  supabase: CodesClient,
  payloads: ScanCodePayload[],
  options: BulkInsertOptions = {},
): Promise<ScanCodeRow[]> {
  const chunkSize = options.chunkSize ?? BULK_CHUNK_SIZE;
  const used = new Set<string>();
  const inserted: ScanCodeRow[] = [];

  for (let start = 0; start < payloads.length; start += chunkSize) {
    const chunk = payloads.slice(start, start + chunkSize);
    let lastError: PostgrestLikeError | null = null;
    let landed = false;

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !landed; attempt++) {
      const codes = drawCodes(chunk.length, used);
      const { data, error } = await supabase
        .from("scan_codes")
        .insert(chunk.map((payload, i) => ({ ...payload, code: codes[i] })))
        .select("*");

      if (!error) {
        inserted.push(...(data ?? []));
        landed = true;
        break;
      }

      lastError = error;
      if (!isUniqueViolation(error)) throw error;
    }

    if (!landed) {
      throw new Error(
        `Could not generate unique scan codes after ${MAX_CODE_ATTEMPTS} attempts (${inserted.length} of ${payloads.length} codes were created before this): ${lastError?.message ?? "unknown error"}`,
      );
    }

    options.onProgress?.(inserted.length, payloads.length);
  }

  return inserted;
}
