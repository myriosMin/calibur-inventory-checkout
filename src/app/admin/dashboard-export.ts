import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildCatalogCsv,
  buildHoldingsCsv,
  buildMovementsCsv,
  exportFilename,
  type CatalogExportRow,
  type HoldingsExportRow,
  type MovementsExportRow,
} from "@/lib/reports/export";
import type { ProductRef, ScanCodeRef } from "@/lib/reports/queries";
import { dateInZone } from "@/lib/reports/schedule";
import type { StockLevelRow } from "@/lib/reports/stock";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Database } from "@/lib/types/database";

/**
 * The dashboard's three CSVs: what parts exist, where they are right now,
 * and how they got there. For backups and committee handover -- a successor
 * should be able to read the club's inventory without an account on
 * anything.
 *
 * The catalog comes from lists the dashboard already has cached. Holdings
 * and the ledger are fetched on demand, paged, so an export is never
 * silently cut at PostgREST's 1000-row cap.
 */

export type ExportKind = "catalog" | "holdings" | "movements";

export interface ExportContext {
  supabase: SupabaseClient<Database>;
  products: ProductRef[];
  levels: StockLevelRow[];
  codes: ScanCodeRef[];
  locations: { id: string; name: string }[];
}

/**
 * Browser-side file download. The data is assembled from rows this session
 * already has RLS-authorised access to, so a Blob and an object URL is the
 * whole mechanism.
 */
function downloadCsv(filename: string, csv: string): void {
  // The BOM is for Excel: without it, Excel on Windows reads UTF-8 as the
  // local codepage and mangles the Ω in half the resistor names.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function fetchHolders(supabase: SupabaseClient<Database>) {
  return fetchAllRows((from, to) =>
    supabase.from("holders").select("id, name, kind").order("id").range(from, to),
  );
}

/** Builds and downloads one export. Returns the filename. */
export async function runExport(kind: ExportKind, ctx: ExportContext): Promise<string> {
  const filename = exportFilename(kind, dateInZone(new Date()));
  const productById = new Map(ctx.products.map((product) => [product.id, product]));

  if (kind === "catalog") {
    const locationById = new Map(ctx.locations.map((location) => [location.id, location.name]));
    const levelById = new Map(ctx.levels.map((level) => [level.productId, level]));
    const codeByProduct = new Map<string, string>();
    for (const code of ctx.codes) {
      if (code.active && code.kind === "product" && code.productId && !codeByProduct.has(code.productId)) {
        codeByProduct.set(code.productId, code.code);
      }
    }
    const rows: CatalogExportRow[] = ctx.products.map((product) => ({
      id: product.id,
      name: product.name,
      tier: product.tier,
      category: product.category,
      unit: product.unit,
      partNumber: product.partNumber,
      locationName: product.locationId ? (locationById.get(product.locationId) ?? null) : null,
      minStock: product.minStock,
      returnable: product.returnable,
      active: product.active,
      qtyInStore: levelById.get(product.id)?.qtyInStore ?? null,
      qtyOut: levelById.get(product.id)?.qtyOut ?? null,
      code: codeByProduct.get(product.id) ?? null,
      unitCostSgd: product.unitCostSgd ?? null,
      expensive: product.expensive === true,
    }));
    downloadCsv(filename, buildCatalogCsv(rows));
    return filename;
  }

  if (kind === "holdings") {
    const [holdings, holders] = await Promise.all([
      fetchAllRows((from, to) =>
        ctx.supabase
          .from("holdings")
          .select("product_id, holder_id, qty")
          .order("product_id")
          .order("holder_id")
          .range(from, to),
      ),
      fetchHolders(ctx.supabase),
    ]);
    const holderById = new Map(holders.map((holder) => [holder.id, holder]));

    const rows: HoldingsExportRow[] = holdings
      .filter((row) => row.product_id !== null && row.holder_id !== null)
      .map((row) => {
        const holder = holderById.get(row.holder_id!);
        const product = productById.get(row.product_id!);
        return {
          holderKind: holder?.kind ?? "unknown",
          holderName: holder?.name ?? "Unknown holder",
          productId: row.product_id!,
          productName: product?.name ?? "Unknown product",
          qty: Number(row.qty ?? 0),
          unit: product?.unit ?? "",
          expensive: product?.expensive === true,
        };
      })
      .sort(
        (a, b) =>
          a.holderKind.localeCompare(b.holderKind) ||
          a.holderName.localeCompare(b.holderName) ||
          a.productName.localeCompare(b.productName),
      );
    downloadCsv(filename, buildHoldingsCsv(rows));
    return filename;
  }

  const [movements, holders, members] = await Promise.all([
    fetchAllRows((from, to) =>
      ctx.supabase
        .from("stock_movements")
        .select(
          "id, created_at, product_id, qty, from_holder_id, to_holder_id, reason, entry_method, scan_code, actor_member_id, session_id",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchHolders(ctx.supabase),
    fetchAllRows((from, to) =>
      ctx.supabase.from("members").select("id, full_name, display_name").order("id").range(from, to),
    ),
  ]);
  const holderById = new Map(holders.map((holder) => [holder.id, holder]));
  const memberById = new Map(members.map((member) => [member.id, member]));

  const rows: MovementsExportRow[] = movements.map((row) => {
    const product = productById.get(row.product_id);
    const actor = row.actor_member_id ? memberById.get(row.actor_member_id) : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      productId: row.product_id,
      productName: product?.name ?? "Unknown product",
      qty: row.qty,
      unit: product?.unit ?? "",
      fromHolderName: holderById.get(row.from_holder_id)?.name ?? "Unknown holder",
      toHolderName: holderById.get(row.to_holder_id)?.name ?? "Unknown holder",
      reason: row.reason,
      entryMethod: row.entry_method,
      scanCode: row.scan_code,
      actorName: actor ? (actor.display_name ?? actor.full_name) : null,
      sessionId: row.session_id,
    };
  });
  downloadCsv(filename, buildMovementsCsv(rows));
  return filename;
}
