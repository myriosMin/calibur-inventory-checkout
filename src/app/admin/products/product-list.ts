import { classifyStockLevel } from "@/lib/reports/stock";
import type { Database } from "@/lib/types/database";

/** The products list's rows and filters. Pure, so the filtering is tested. */

type Product = Database["public"]["Tables"]["products"]["Row"];

export interface ProductListRow extends Product {
  /** null for inactive products, which stock_summary leaves out. */
  qtyInStore: number | null;
  qtyOut: number | null;
  openReviews: number;
}

export interface ProductListFilters {
  query: string;
  /** "" = any category. */
  category: string;
  criticality: "all" | "critical" | "standard" | "expendable";
  status: "all" | "active" | "inactive";
  onlyNeedsReview: boolean;
  /** Stock health, from the same classifier the low-stock alert uses. */
  stock: StockFilter;
}

export type StockFilter = "all" | "low" | "empty" | "negative";

/**
 * Which stock bucket a row falls in. "low" and "negative" are
 * src/lib/reports/stock's own verdicts, so this list, the dashboard and the
 * bot's alert agree. "empty" is none in the store with no threshold set;
 * loose items (wire, solder) read 0 as "level", not empty.
 */
export function stockBucket(row: Pick<ProductListRow, "qtyInStore" | "min_stock" | "tier">): Exclude<StockFilter, "all"> | "ok" {
  if (row.qtyInStore === null) return "ok";
  const flag = classifyStockLevel({ minStock: row.min_stock, qtyInStore: row.qtyInStore });
  if (flag !== "ok") return flag;
  if (row.qtyInStore === 0 && row.tier !== "loose") return "empty";
  return "ok";
}

export const DEFAULT_PRODUCT_FILTERS: ProductListFilters = {
  query: "",
  category: "",
  criticality: "all",
  status: "all",
  onlyNeedsReview: false,
  stock: "all",
};

export function filterProducts(rows: ProductListRow[], filters: ProductListFilters): ProductListRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filters.category && row.category !== filters.category) return false;
      if (filters.criticality !== "all" && row.criticality !== filters.criticality) return false;
      if (filters.status === "active" && !row.active) return false;
      if (filters.status === "inactive" && row.active) return false;
      if (filters.onlyNeedsReview && row.openReviews === 0) return false;
      if (filters.stock !== "all" && stockBucket(row) !== filters.stock) return false;
      if (!needle) return true;
      return [row.name, row.part_number, row.category, row.supplier]
        .some((field) => field?.toLowerCase().includes(needle));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function distinctCategories(rows: { category: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
}
