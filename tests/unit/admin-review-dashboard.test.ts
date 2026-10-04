import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_GROUPS, NAV_ITEMS, activeTabHref, isActive, navItemFor, visibleNavGroups } from "@/app/admin/nav";
import {
  criticalityDefaults,
  EMPTY_PRODUCT_FORM,
  formExpenseBasis,
  formToRow,
  unitCostPatch,
} from "@/app/admin/products/product-form";
import {
  DEFAULT_PRODUCT_FILTERS,
  filterProducts,
  stockBucket,
  type ProductListFilters,
  type ProductListRow,
} from "@/app/admin/products/product-list";
import { EMPTY_UNIT_FORM, unitFormToRow } from "@/app/admin/products/[id]/unit-form";
import {
  DEFAULT_REVIEW_FILTERS,
  expensiveIds,
  filterReviewItems,
  openCountsByPriority,
  openCountsBySeverity,
} from "@/app/admin/review/review-filters";
import { addWalkProduct, deserializeWalk, newWalk, serializeWalk } from "@/app/admin/stocktake/walk";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { buildImport } from "../../scripts/import-clean-data";

/**
 * The pure pieces behind the SME review dashboard: role-aware nav, the
 * product and unit forms, list filters, robot stocktake walks, row-cap
 * paging, and the importer's review-queue / held-product handling.
 */

describe("admin nav", () => {
  const labels = (isAdmin: boolean) =>
    visibleNavGroups(isAdmin).flatMap((group) => group.items.map((item) => item.label));

  it("shows admins everything", () => {
    expect(visibleNavGroups(true)).toEqual(NAV_GROUPS);
  });

  it("hides people, labels and holders from procurement", () => {
    expect(labels(false)).toEqual(expect.arrayContaining(["Review", "Products", "Restock", "Stocktake", "Stock"]));
    for (const hidden of ["People", "Holders", "Labels"]) {
      expect(labels(false)).not.toContain(hidden);
    }
    // The emptied "Admin" group goes with its heading.
    expect(visibleNavGroups(false).map((group) => group.label)).not.toContain("Admin");
  });

  it("keeps every admin page reachable from the sidebar", () => {
    const reachable = NAV_ITEMS.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]);
    for (const href of [
      "/admin", "/admin/review", "/admin/products", "/admin/holders", "/admin/members",
      "/admin/join-codes", "/admin/scan-codes", "/admin/bind-queue", "/admin/restock",
      "/admin/movements", "/admin/holdings", "/admin/stocktake", "/admin/stocktake/variance", "/admin/labels",
    ]) {
      expect(reachable).toContain(href);
    }
  });

  it("matches detail routes by prefix without cross-matching neighbours", () => {
    expect(isActive("/admin", "/admin")).toBe(true);
    expect(isActive("/admin/products/abc", "/admin")).toBe(false);
    expect(isActive("/admin/products/abc", "/admin/products")).toBe(true);
    expect(isActive("/admin/holdings", "/admin/holders")).toBe(false);
  });

  it("finds the entry that owns a tabbed page", () => {
    expect(navItemFor("/admin/bind-queue")?.label).toBe("People");
    expect(navItemFor("/admin/members/123")?.label).toBe("People");
    expect(navItemFor("/admin/movements")?.label).toBe("Stock");
    expect(navItemFor("/admin/holders")?.label).toBe("Holders");
    expect(navItemFor("/admin")?.label).toBe("Dashboard");
  });

  it("picks the longest matching tab", () => {
    const tabs = navItemFor("/admin/stocktake")!.tabs!;
    expect(activeTabHref("/admin/stocktake", tabs)).toBe("/admin/stocktake");
    expect(activeTabHref("/admin/stocktake/variance", tabs)).toBe("/admin/stocktake/variance");
  });
});

describe("product stock buckets", () => {
  it("uses the alert's own low / negative verdicts", () => {
    expect(stockBucket({ qtyInStore: 2, min_stock: 5, tier: "bulk" })).toBe("low");
    expect(stockBucket({ qtyInStore: -1, min_stock: null, tier: "bulk" })).toBe("negative");
    expect(stockBucket({ qtyInStore: 9, min_stock: 5, tier: "bulk" })).toBe("ok");
  });

  it("calls zero empty, except for loose stock, where zero means 'level'", () => {
    expect(stockBucket({ qtyInStore: 0, min_stock: null, tier: "asset" })).toBe("empty");
    expect(stockBucket({ qtyInStore: 0, min_stock: null, tier: "loose" })).toBe("ok");
    expect(stockBucket({ qtyInStore: null, min_stock: 3, tier: "bulk" })).toBe("ok");
  });
});

describe("product form", () => {
  const valid = { ...EMPTY_PRODUCT_FORM, name: "DJI M3508 motor" };

  it("requires a name and validates numbers", () => {
    expect(formToRow({ ...valid, name: "  " })).toEqual({ ok: false, error: "Name is required." });
    expect(formToRow({ ...valid, min_stock: "2.5" }).ok).toBe(false);
    expect(formToRow({ ...valid, unit_cost_sgd: "-1" }).ok).toBe(false);
    const result = formToRow({ ...valid, unit_cost_sgd: "149.999", returnable: true });
    expect(result.ok && result.row.unit_cost_sgd).toBe(150);
  });

  it("refuses an expensive item that is not returnable, as products_expensive_returnable would (0028)", () => {
    const priced = formToRow({ ...valid, unit_cost_sgd: "20", returnable: false });
    expect(priced.ok).toBe(false);
    expect(!priced.ok && priced.error).toMatch(/must be returnable/);
    expect(formToRow({ ...valid, unit_cost_sgd: "19.99", returnable: false }).ok).toBe(true);
    expect(formToRow({ ...valid, criticality: "critical", returnable: false }).ok).toBe(false);
    expect(formToRow({ ...valid, criticality: "critical", unit_cost_sgd: "5", returnable: false }).ok).toBe(true);
  });

  it("switches returnable on when a price makes the item expensive", () => {
    expect(unitCostPatch("25", "expendable")).toEqual({ unit_cost_sgd: "25", returnable: true });
    expect(unitCostPatch("2", "expendable")).toEqual({ unit_cost_sgd: "2" });
    expect(formExpenseBasis({ unit_cost_sgd: "", criticality: "critical" })).toBe("assumed");
    expect(formExpenseBasis({ unit_cost_sgd: "abc", criticality: "standard" })).toBe("unpriced");
  });

  it("requires a lender for on-loan stock and clears it when switched back to owned", () => {
    expect(formToRow({ ...valid, ownership: "on_loan" }).ok).toBe(false);
    const onLoan = formToRow({ ...valid, ownership: "on_loan", loaned_from: "Advantech", loan_due: "2026-12-01" });
    expect(onLoan.ok && [onLoan.row.loaned_from, onLoan.row.loan_due]).toEqual(["Advantech", "2026-12-01"]);
    const owned = formToRow({ ...valid, ownership: "owned", loaned_from: "Advantech", loan_due: "2026-12-01" });
    expect(owned.ok && [owned.row.loaned_from, owned.row.loan_due]).toEqual([null, null]);
  });

  it("derives tier and returnable from criticality", () => {
    expect(criticalityDefaults("critical", "bulk")).toEqual({ criticality: "critical", tier: "asset", returnable: true });
    expect(criticalityDefaults("expendable", "asset")).toEqual({ criticality: "expendable", tier: "bulk", returnable: false });
    expect(criticalityDefaults("expendable", "loose").tier).toBe("loose");
    // An S$30 expendable is still expensive, so it stays returnable.
    expect(criticalityDefaults("expendable", "asset", "30").returnable).toBe(true);
  });
});

describe("unit form", () => {
  it("uppercases component IDs and mirrors the lender constraint", () => {
    expect(unitFormToRow(EMPTY_UNIT_FORM).ok).toBe(false);
    const row = unitFormToRow({ ...EMPTY_UNIT_FORM, unit_code: " am02-01 ", labelled: "true" });
    expect(row.ok && [row.row.unit_code, row.row.labelled]).toEqual(["AM02-01", true]);
    expect(unitFormToRow({ ...EMPTY_UNIT_FORM, unit_code: "X-1", ownership: "on_loan" }).ok).toBe(false);
  });
});

describe("product list filters", () => {
  const row = (overrides: Partial<ProductListRow>): ProductListRow =>
    ({ id: "p", name: "x", category: null, criticality: "standard", active: true, part_number: null, supplier: null, openReviews: 0, ...overrides }) as ProductListRow;
  const rows = [
    row({ id: "1", name: "Zeta motor", criticality: "critical", openReviews: 2, category: "Motors & ESCs" }),
    row({ id: "2", name: "Alpha resistor", part_number: "RC0603FR-0710RL", criticality: "expendable" }),
    row({ id: "3", name: "Held thing", active: false }),
  ];

  it("filters by review need, criticality, status and part number, sorted by name", () => {
    expect(filterProducts(rows, { ...DEFAULT_PRODUCT_FILTERS, onlyNeedsReview: true }).map((r) => r.id)).toEqual(["1"]);
    expect(filterProducts(rows, { ...DEFAULT_PRODUCT_FILTERS, criticality: "critical" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterProducts(rows, { ...DEFAULT_PRODUCT_FILTERS, status: "inactive" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterProducts(rows, { ...DEFAULT_PRODUCT_FILTERS, query: "0710" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterProducts(rows, DEFAULT_PRODUCT_FILTERS).map((r) => r.id)).toEqual(["2", "3", "1"]);
  });

  it("filters by the expensive flag (0028), and finds active reusable kit with no price", () => {
    const priced = [
      row({ id: "a", name: "A motor", criticality: "critical", expensive: true, unit_cost_sgd: null }),
      row({ id: "b", name: "B board", criticality: "standard", expensive: true, unit_cost_sgd: 40 }),
      row({ id: "c", name: "C tool", criticality: "standard", expensive: false, unit_cost_sgd: null }),
      row({ id: "d", name: "D held tool", criticality: "standard", expensive: false, unit_cost_sgd: null, active: false }),
      row({ id: "e", name: "E resistor", criticality: "expendable", expensive: false, unit_cost_sgd: null }),
    ];
    const ids = (expense: ProductListFilters["expense"]) =>
      filterProducts(priced, { ...DEFAULT_PRODUCT_FILTERS, expense }).map((r) => r.id);
    expect(ids("expensive")).toEqual(["a", "b"]);
    expect(ids("not_expensive")).toEqual(["c", "d", "e"]);
    expect(ids("needs_price")).toEqual(["c"]);
  });
});

describe("review queue filters", () => {
  const item = (id: number, severity: string, status = "open", productId: string | null = null, aboutExpensive = false) => ({
    id,
    severity,
    status,
    entity: "product",
    subject: `s${id}`,
    issue: "totals disagree",
    product_id: productId,
    about_expensive: aboutExpensive,
  });

  it("puts blockers first and hides closed items by default", () => {
    const items = [item(1, "info"), item(2, "check"), item(3, "blocker"), item(4, "check", "resolved")];
    expect(filterReviewItems(items, DEFAULT_REVIEW_FILTERS).map((i) => i.id)).toEqual([3, 2, 1]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, status: "closed" }).map((i) => i.id)).toEqual([4]);
    expect(openCountsBySeverity(items)).toEqual({ blocker: 1, check: 1, info: 1 });
  });

  it("puts items about expensive products (or marked as such) ahead of any severity", () => {
    const expensive = expensiveIds([
      { id: "gm6020", expensive: true },
      { id: "resistor", expensive: false },
      { id: "unknown", expensive: null },
    ]);
    const items = [
      item(1, "blocker", "open", "resistor"),
      item(2, "info", "open", "gm6020"),
      item(3, "check", "open", null, true),
      item(4, "check", "resolved", "gm6020"),
      item(5, "check"),
    ];
    expect(filterReviewItems(items, DEFAULT_REVIEW_FILTERS, expensive).map((i) => i.id)).toEqual([3, 2, 1, 5]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, priority: "high" }, expensive).map((i) => i.id)).toEqual([3, 2]);
    expect(filterReviewItems(items, { ...DEFAULT_REVIEW_FILTERS, priority: "normal" }, expensive).map((i) => i.id)).toEqual([1, 5]);
    expect(openCountsByPriority(items, expensive)).toEqual({ high: 2, normal: 2 });
  });
});

describe("robot stocktake walks", () => {
  const base = { clientToken: "33333333-3333-4333-8333-333333333333", now: "2026-09-13T00:00:00.000Z" };

  it("round-trips a robot walk with added products, and adding twice is a no-op", () => {
    const walk = addWalkProduct(
      newWalk({ ...base, holderId: "robot-hero", locationId: null, locationName: "Hero" }),
      "p-m3508",
      base.now,
    );
    expect(addWalkProduct(walk, "p-m3508")).toBe(walk);
    expect(deserializeWalk(serializeWalk(walk))).toEqual(walk);
  });

  it("restores a walk saved before robot counting existed as a store walk", () => {
    const legacy = {
      version: 1,
      clientToken: base.clientToken,
      locationId: "loc",
      locationName: "Table shelf",
      startedAt: base.now,
      updatedAt: base.now,
      counts: { p1: "3" },
    };
    const restored = deserializeWalk(JSON.stringify(legacy));
    expect(restored?.holderId).toBeNull();
    expect(restored?.addedProductIds).toEqual([]);
  });

  it("rejects a wrongly typed holder or added-products list", () => {
    const walk = newWalk({ ...base, locationId: null, locationName: "x" });
    expect(deserializeWalk(JSON.stringify({ ...walk, holderId: 5 }))).toBeNull();
    expect(deserializeWalk(JSON.stringify({ ...walk, addedProductIds: [1] }))).toBeNull();
  });
});

describe("fetchAllRows", () => {
  it("pages past the PostgREST row cap and stops on a short page", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await fetchAllRows(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toEqual(all);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("throws instead of returning a partial list", async () => {
    await expect(fetchAllRows(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});

describe("importer: held products and the review queue", () => {
  function fixture(overrides: Record<string, string> = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "clean-import-"));
    const files: Record<string, string> = {
      "products.csv": [
        "key,action,name,category,criticality,tier,returnable,unit,qty_total,location,ownership,loaned_from,part_number,spec_json,notes,sources",
        "live,import,Live motor,Motors & ESCs,critical,asset,true,pcs,7,Blue rack,owned,,,,,Electrical Parts!R1",
        "held,hold,Battery 'old',Batteries & power,critical,asset,true,pcs,17,,owned,,,,,Electrical Parts!R2",
        "gone,drop,Tools header,,expendable,bulk,false,pcs,,,owned,,,,,legacy:x",
      ].join("\n"),
      "asset_units.csv": [
        "unit_code,product_key,serial_number,condition,ownership,loaned_from,labelled,last_seen_location,last_checked_on,notes,source",
        "LM-01,live,S1,ok,owned,,true,,2025-06-09,,HV!R3",
      ].join("\n"),
      "opening_balances.csv": ["product_key,holder_kind,holder_name,qty", "live,store,Store,5", "live,robot,Hero,2"].join("\n"),
      "open_loans.csv": [
        "legacy_borrow_id,action,member_email,member_legacy_name,product_key,product_name,movement,qty,borrowed_at,notes",
        "aaaaaaaa-1,import,a@example.com,alice,live,Live motor,borrow,1,2026-08-07 08:44:22+00,",
        "bbbbbbbb-2,hold,a@example.com,alice,live,Live motor,borrow,4,2026-08-31 18:00:00+00,Burst.",
      ].join("\n"),
      "holders.csv": ["name,kind", "Hero,robot"].join("\n"),
      "locations.csv": ["name", "Blue rack"].join("\n"),
      "members.csv": ["full_name,display_name,nus_email,telegram_username,role", "alice,,a@example.com,,member"].join("\n"),
      "review_flags.csv": [
        "severity,entity,key,name,issue",
        "check,product,held,Battery 'old',Probably double-counts the register.",
        "check,unit,LM-01,Live motor,Serial appears twice.",
        "info,member,-,All members,No names.",
      ].join("\n"),
      ...overrides,
    };
    for (const [file, content] of Object.entries(files)) writeFileSync(path.join(dir, file), `${content}\n`);
    return dir;
  }

  it("imports held products inactive and turns flags and held loans into review items", () => {
    const plan = buildImport(fixture(), { rehearse: false, migrationSqls: [] });
    expect(plan.errors).toEqual([]);
    expect(plan.counts).toMatchObject({ products: 2, heldProducts: 1, assetUnits: 1, openingBalances: 2, loans: 1, reviewItems: 4 });
    expect(plan.sql).toMatch(/'Battery ''old''', .*'Held during the catalog clean-up[^']*', 'critical', 'owned', null, false,/);
    expect(plan.sql).not.toContain("Tools header");
    expect(plan.sql).toContain("insert into review_items");
    expect(plan.sql).toContain("alice has 4 out since 2026-08-31");
    expect(plan.sql.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses loans that would drive the store negative", () => {
    const dir = fixture({
      "opening_balances.csv": ["product_key,holder_kind,holder_name,qty", "live,robot,Hero,2"].join("\n"),
    });
    const plan = buildImport(dir, { rehearse: true, migrationSqls: [] });
    expect(plan.errors.some((e) => e.includes("holdings would go negative"))).toBe(true);
  });
});
