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
}

export const DEFAULT_PRODUCT_FILTERS: ProductListFilters = {
  query: "",
  category: "",
  criticality: "all",
  status: "all",
  onlyNeedsReview: false,
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
      if (!needle) return true;
      return [row.name, row.part_number, row.category, row.supplier]
        .some((field) => field?.toLowerCase().includes(needle));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function distinctCategories(rows: { category: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
}
