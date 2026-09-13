/**
 * One stocktake walk = one shelf (or one robot), counted standing up, on a
 * phone.
 *
 * There is deliberately NO draft table behind this. It follows the same
 * shape as the Mini App cart (docs/tele-qr/architecture.md): client state
 * until Done, then one atomic RPC. A 157-product resistor-book walk lives
 * entirely in localStorage and commits in a single `admin_commit_stocktake`
 * call -- no TTL, no abandonment handling, no partial commit to reconcile.
 *
 * The one thing the cart does not need and this does: an hour of counting is
 * far too expensive to lose to a backgrounded phone tab, so every keystroke
 * is persisted to localStorage and the walk is restored on return.
 *
 * Everything in this file is pure except the three thin localStorage
 * wrappers at the bottom, which is what makes the serialisation and the
 * validation unit-testable without a browser.
 */

export const WALK_STORAGE_KEY = "calibur.stocktake.walk.v1";
export const WALK_VERSION = 1;

export interface StocktakeWalk {
  version: number;
  /**
   * Minted ONCE per walk, not per request: `admin_commit_stocktake` dedups on
   * it, so an interrupted commit (tab killed mid-request, flaky lift lobby
   * wifi) can be retried with the same token and will never double-correct.
   */
  clientToken: string;
  /**
   * The holder being counted. null = the store, walked one shelf at a time
   * (`locationId` says which). A robot's holder id = everything the ledger
   * says is on that robot, which is how the per-robot allocations imported
   * from the old spreadsheet get corrected.
   */
  holderId: string | null;
  /** null = the "no location set" bucket, for a mid-migration catalog. Always null for a robot walk. */
  locationId: string | null;
  /** The shelf name, or the robot name for a robot walk. */
  locationName: string;
  /**
   * Robot walks only: products added by hand because the ledger doesn't list
   * them on the robot at all (the motor someone bolted on without logging it).
   */
  addedProductIds: string[];
  startedAt: string;
  updatedAt: string;
  /**
   * productId -> the RAW text in the input, not a number. Storing the text
   * means a half-typed "1" on the way to "157" survives a re-render and a
   * restore without being coerced into a committed count of 1.
   */
  counts: Record<string, string>;
}

export type CountParseError =
  | "empty"
  | "not_a_number"
  | "not_an_integer"
  | "negative";

export type CountParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: CountParseError };

/**
 * Mirrors the DB's own guarantees so a bad entry is caught at the shelf
 * rather than as a 23514 after a two-hour walk: `stock_counts_counted_qty_check
 * (counted_qty >= 0)` plus the RPC's own "countedQty must be a non-negative
 * integer". Deliberately stricter than `Number()`: "0x10" and "1e3" are
 * typos on a numeric keypad, not quantities.
 */
export function parseCountInput(raw: string): CountParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (!/^-?\d+$/.test(trimmed)) {
    if (/^-?\d*\.\d+$/.test(trimmed)) {
      return { ok: false, reason: "not_an_integer" };
    }
    return { ok: false, reason: "not_a_number" };
  }
  const value = Number(trimmed);
  if (value < 0) return { ok: false, reason: "negative" };
  return { ok: true, value };
}

export const COUNT_ERROR_MESSAGES: Record<CountParseError, string> = {
  empty: "Enter a number, or leave blank to skip this one.",
  not_a_number: "Numbers only.",
  not_an_integer: "Whole units only — round to the nearest piece.",
  negative: "A count can't be negative.",
};

export function newWalk(params: {
  clientToken: string;
  holderId?: string | null;
  locationId: string | null;
  locationName: string;
  now?: string;
}): StocktakeWalk {
  const now = params.now ?? new Date().toISOString();
  return {
    version: WALK_VERSION,
    clientToken: params.clientToken,
    holderId: params.holderId ?? null,
    locationId: params.locationId,
    locationName: params.locationName,
    addedProductIds: [],
    startedAt: now,
    updatedAt: now,
    counts: {},
  };
}

/**
 * Blanking an input REMOVES the entry rather than storing "". A product with
 * no entry was not counted, which is a different fact from "counted, found
 * zero" -- and only the latter may reach the ledger.
 */
export function setWalkCount(
  walk: StocktakeWalk,
  productId: string,
  raw: string,
  now?: string,
): StocktakeWalk {
  const counts = { ...walk.counts };
  if (raw.trim() === "") {
    delete counts[productId];
  } else {
    counts[productId] = raw;
  }
  return { ...walk, counts, updatedAt: now ?? new Date().toISOString() };
}

/** Adds a product to a robot walk. Adding one already listed is a no-op. */
export function addWalkProduct(walk: StocktakeWalk, productId: string, now?: string): StocktakeWalk {
  if (walk.addedProductIds.includes(productId)) return walk;
  return {
    ...walk,
    addedProductIds: [...walk.addedProductIds, productId],
    updatedAt: now ?? new Date().toISOString(),
  };
}

export function enteredCount(walk: StocktakeWalk): number {
  return Object.values(walk.counts).filter((raw) => raw.trim() !== "").length;
}

// ---------------------------------------------------------------------------
// Variance -> movement direction.
//
// This mirrors admin_commit_stocktake's own branching so the pre-commit
// summary can say what will happen. It is a PREVIEW ONLY: the server
// recomputes `expected` from the ledger at commit time and ignores whatever
// the client had on screen, because the admin's view may be an hour stale.
// Never present these numbers as the outcome.
// ---------------------------------------------------------------------------

export type VarianceDirection = "gain" | "loss" | "match";

export function varianceOf(countedQty: number, expectedQty: number): number {
  return countedQty - expectedQty;
}

export function varianceDirection(variance: number): VarianceDirection {
  if (variance > 0) return "gain";
  if (variance < 0) return "loss";
  return "match";
}

export interface PlannedMovement {
  reason: "stocktake_gain" | "stocktake_loss";
  fromHolderId: string;
  toHolderId: string;
  qty: number;
}

/**
 * Returns null for zero variance, and that is the whole point: a matched
 * count writes a `stock_counts` row with `movement_id IS NULL` and NO
 * movement at all. Both `qty > 0` and `no_self_move` forbid a zero-quantity
 * self-transfer, so "write a movement of 0" is not an option that exists.
 */
export function planMovement(
  variance: number,
  holders: { holderId: string; adjustmentHolderId: string },
): PlannedMovement | null {
  if (variance > 0) {
    // Found more than the ledger knew about: stock appears from the
    // adjustment pseudo-holder.
    return {
      reason: "stocktake_gain",
      fromHolderId: holders.adjustmentHolderId,
      toHolderId: holders.holderId,
      qty: variance,
    };
  }
  if (variance < 0) {
    // Found less: the shortfall is written off to the adjustment holder.
    return {
      reason: "stocktake_loss",
      fromHolderId: holders.holderId,
      toHolderId: holders.adjustmentHolderId,
      qty: -variance,
    };
  }
  return null;
}

/** "+3" / "−2" (U+2212, not a hyphen) / "0". */
export function formatVariance(variance: number): string {
  if (variance > 0) return `+${variance}`;
  if (variance < 0) return `−${Math.abs(variance)}`;
  return "0";
}

// ---------------------------------------------------------------------------
// Commit payload
// ---------------------------------------------------------------------------

/**
 * The exact shape `admin_commit_stocktake(p_counts jsonb)` expects.
 *
 * A `type` alias rather than an `interface` on purpose: TypeScript gives
 * aliases an implicit index signature, so `StocktakeCountLine[]` is directly
 * assignable to the generated `Json` parameter type. An interface is not,
 * and would force an `as unknown as Json` cast at the call site.
 */
export type StocktakeCountLine = {
  productId: string;
  countedQty: number;
};

export type BuildCommitResult =
  | { ok: true; counts: StocktakeCountLine[] }
  | { ok: false; invalid: { productId: string; reason: CountParseError }[] };

/**
 * Entries that are blank are skipped (not counted, not an error). Anything
 * present but unparseable fails the whole build -- the RPC is atomic, so
 * there is no value in submitting a partial payload and hoping.
 */
export function buildCommitPayload(walk: StocktakeWalk): BuildCommitResult {
  const counts: StocktakeCountLine[] = [];
  const invalid: { productId: string; reason: CountParseError }[] = [];

  for (const productId of Object.keys(walk.counts).sort()) {
    const parsed = parseCountInput(walk.counts[productId]);
    if (parsed.ok) {
      counts.push({ productId, countedQty: parsed.value });
    } else if (parsed.reason !== "empty") {
      invalid.push({ productId, reason: parsed.reason });
    }
  }

  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, counts };
}

export interface WalkSummary {
  entered: number;
  matched: number;
  gains: number;
  losses: number;
  /** Sum of |variance| across entered products. */
  absVariance: number;
}

/** Provisional summary for the confirm step. See the PREVIEW ONLY note above. */
export function summariseWalk(
  walk: StocktakeWalk,
  expectedByProduct: Record<string, number>,
): WalkSummary {
  const summary: WalkSummary = {
    entered: 0,
    matched: 0,
    gains: 0,
    losses: 0,
    absVariance: 0,
  };
  for (const [productId, raw] of Object.entries(walk.counts)) {
    const parsed = parseCountInput(raw);
    if (!parsed.ok) continue;
    summary.entered += 1;
    const variance = varianceOf(parsed.value, expectedByProduct[productId] ?? 0);
    summary.absVariance += Math.abs(variance);
    const direction = varianceDirection(variance);
    if (direction === "gain") summary.gains += 1;
    else if (direction === "loss") summary.losses += 1;
    else summary.matched += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function serializeWalk(walk: StocktakeWalk): string {
  return JSON.stringify(walk);
}

function isCountsRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === "string");
}

/**
 * Returns null for anything that isn't a walk of this version. A restore is
 * a convenience; a half-understood restore that silently drops or invents
 * counts is worse than starting over, so the bar for accepting one is
 * "every field is the right type".
 *
 * `holderId` and `addedProductIds` arrived with robot counting. A walk saved
 * before that has neither and is a store walk, so their absence is accepted;
 * a present-but-wrong-typed value is not.
 */
export function deserializeWalk(raw: string | null): StocktakeWalk | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as Partial<StocktakeWalk>;
  if (candidate.version !== WALK_VERSION) return null;
  if (typeof candidate.clientToken !== "string" || candidate.clientToken === "") {
    return null;
  }
  if (
    candidate.holderId !== undefined &&
    typeof candidate.holderId !== "string" &&
    candidate.holderId !== null
  ) {
    return null;
  }
  if (
    typeof candidate.locationId !== "string" &&
    candidate.locationId !== null
  ) {
    return null;
  }
  if (typeof candidate.locationName !== "string") return null;
  if (
    candidate.addedProductIds !== undefined &&
    !(Array.isArray(candidate.addedProductIds) && candidate.addedProductIds.every((id) => typeof id === "string"))
  ) {
    return null;
  }
  if (typeof candidate.startedAt !== "string") return null;
  if (typeof candidate.updatedAt !== "string") return null;
  if (!isCountsRecord(candidate.counts)) return null;

  return {
    version: WALK_VERSION,
    clientToken: candidate.clientToken,
    holderId: candidate.holderId ?? null,
    locationId: candidate.locationId,
    locationName: candidate.locationName,
    addedProductIds: candidate.addedProductIds ?? [],
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    counts: candidate.counts,
  };
}

// --- the only impure part: localStorage access ------------------------------
// Wrapped in try/catch because Safari private mode throws on setItem, and
// losing the persistence is survivable; losing the page is not.

export function loadStoredWalk(): StocktakeWalk | null {
  if (typeof window === "undefined") return null;
  try {
    return deserializeWalk(window.localStorage.getItem(WALK_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeWalk(walk: StocktakeWalk): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALK_STORAGE_KEY, serializeWalk(walk));
  } catch {
    /* quota or private mode -- the walk stays in memory */
  }
}

export function clearStoredWalk(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(WALK_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
