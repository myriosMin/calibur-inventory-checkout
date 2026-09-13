/**
 * Builds the SME-review / import data set in data/clean/ from the raw
 * inventory sources. See docs/data-cleaning.md for the rules and why.
 *
 *   npx tsx scripts/clean-data/build.ts [--force]
 *
 * Read-only with respect to the database. Refuses to overwrite a non-empty
 * data/clean/ without --force, because that directory is where reviewers
 * make their corrections.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toCsvLine } from "../../src/lib/csv/parse";

import {
  BOM_DESCRIPTIONS,
  BULK_LOAN_MIN_ROWS,
  BULK_LOAN_WINDOW_MINUTES,
  DISPOSED_TAG,
  LEGACY_DROP,
  LEGACY_ONLY,
  LEGACY_TO_MAIN_ROW,
  LOCATIONS,
  MAIN_ROW_OVERRIDES,
  REGISTRY,
  ROBOT_HOLDERS,
  ROLE_PROPOSALS,
  SIDE_ROW_OVERRIDES,
  STORE_TAGS,
  UNASSIGNED_TAGS,
  UNIT_OVERRIDES,
  resolveHolder,
  resolveLocation,
  type Allocation,
  type CuratedFlag,
  type RegistryDef,
  type RowOverride,
} from "./curation";
import {
  CATEGORY,
  categorize,
  cleanName,
  cleanSerial,
  collapse,
  defaultCriticality,
  extractPartNumber,
  extractSpec,
  isE24,
  isFabricatedLegacyTotal,
  nameKey,
  parseBookResistorValue,
  parseQty,
  parseViewCell,
  tierFor,
  unitCondition,
  unitOwnership,
  type Condition,
  type Criticality,
  type ImportAction,
  type Ownership,
  type Qty,
  type Severity,
  type Tier,
} from "./rules";
import {
  SHEET_ELECTRICAL,
  loadSources,
  type ElectricalSideRow,
  type LegacyItem,
  type Sources,
} from "./sources";

export const OUT_DIR = "data/clean";
const STORE = "Store";

interface Flag {
  severity: Severity;
  entity: string;
  key: string;
  name: string;
  issue: string;
}

interface Product {
  key: string;
  action: ImportAction;
  name: string;
  previousNames: Set<string>;
  category: string;
  criticality: Criticality;
  tier: Tier;
  unit: string;
  partNumber: string | null;
  spec: Record<string, string> | null;
  location: string | null;
  ownership: Ownership;
  loanedFrom: string | null;
  qtyTotal: number | null;
  qtyBasis: string;
  qtySheet: string;
  qtyLegacy: string;
  qtyUnits: string;
  robotAllocations: Allocation[];
  /** Units strategy only: units counted in the store. */
  storeFromUnits: number | null;
  seedStore: number;
  seedRobots: number;
  openLoans: number;
  notes: string[];
  sources: string[];
  legacyIds: string[];
}

interface Unit {
  code: string;
  productKey: string;
  serial: string | null;
  condition: Condition;
  ownership: "owned" | "on_loan";
  loanedFrom: string | null;
  /** "Store", a robot holder name, or "" for disposed/missing. */
  holder: string;
  lastSeenLocation: string;
  lastCheckedOn: string;
  labelled: string;
  notes: string[];
  source: string;
}

interface Loan {
  borrowId: string;
  action: ImportAction;
  memberEmail: string;
  memberLegacyName: string;
  productKey: string;
  productName: string;
  movement: "borrow" | "consume";
  qty: number;
  borrowedAt: string;
  notes: string[];
}

interface Balance {
  productKey: string;
  productName: string;
  holderKind: "store" | "robot";
  holderName: string;
  qty: number;
  basis: string;
}

interface BomLine {
  bom: string;
  sourceRow: number;
  partNumber: string;
  description: string;
  qtyPerBuild: string;
  status: string;
  note: string;
}

interface MemberRow {
  fullName: string;
  email: string;
  role: string;
  legacyRole: string;
  note: string;
}

interface GenericInput {
  row: number;
  section: string;
  item: string;
  qtyStorage: string;
  qtyOutside: string;
  location: string;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

class CatalogBuild {
  readonly flags: Flag[] = [];
  readonly products: Product[] = [];
  readonly units: Unit[] = [];
  readonly bom: BomLine[] = [];
  private readonly productByKey = new Map<string, Product>();
  private readonly productByLegacyId = new Map<string, Product>();
  private readonly legacyById: Map<string, LegacyItem>;
  private readonly usedLegacy = new Set<string>();
  private readonly consumedMainRows = new Set<number>();
  private readonly unitCodes = new Set<string>();
  private readonly fabricated: string[] = [];
  private readonly bookUncounted: number[] = [];

  constructor(private readonly src: Sources) {
    this.legacyById = new Map(src.legacy.items.map((item) => [item.id, item]));
  }

  flag(severity: Severity, entity: string, key: string, name: string, issue: string) {
    this.flags.push({ severity, entity, key, name, issue });
  }

  private addProduct(product: Product, curated: CuratedFlag[] = []) {
    if (this.productByKey.has(product.key)) throw new Error(`duplicate product key ${product.key}`);
    this.products.push(product);
    this.productByKey.set(product.key, product);
    for (const id of product.legacyIds) this.productByLegacyId.set(id, product);
    for (const f of curated) this.flag(f.severity, "product", product.key, product.name, f.issue);
  }

  // -------------------------------------------------------------------------
  // Registry products
  // -------------------------------------------------------------------------

  buildRegistry(def: RegistryDef) {
    const sources: string[] = [];
    const previousNames = new Set<string>();
    const notes = def.notes ? [def.notes] : [];

    const mainRows = (def.electricalRows ?? []).map((rowNumber) => {
      const row = this.src.electrical.main.find((r) => r.row === rowNumber);
      if (!row) throw new Error(`registry ${def.key}: ${SHEET_ELECTRICAL} R${rowNumber} not found`);
      this.consumedMainRows.add(rowNumber);
      sources.push(`${SHEET_ELECTRICAL}!R${rowNumber}`);
      previousNames.add(row.item);
      return row;
    });

    const summaries = (def.summary ?? []).map((name) => {
      const hit = [...this.src.highValue.summary, ...this.src.referee.summary].find((s) => s.name === name);
      if (!hit) throw new Error(`registry ${def.key}: summary row "${name}" not found`);
      sources.push(`${hit.sheet}!R${hit.row}`);
      previousNames.add(hit.name);
      return hit;
    });

    const legacyItems = (def.legacyIds ?? []).map((id) => {
      const item = this.legacyById.get(id);
      if (!item) throw new Error(`registry ${def.key}: legacy item ${id} not found`);
      this.usedLegacy.add(id);
      sources.push(`legacy:${id.slice(0, 8)}`);
      previousNames.add(item.name);
      return item;
    });

    const units = def.unitCategory ? this.buildUnits(def) : [];

    // --- Totals from each source, then pick by precedence ------------------
    const sheetCounts = mainRows
      .map((row) => {
        const storage = parseQty(row.qtyStorage);
        const outside = parseQty(row.qtyOutside);
        if (storage.kind !== "count" && outside.kind !== "count") return null;
        return (storage.kind === "count" ? storage.n : 0) + (outside.kind === "count" ? outside.n : 0);
      })
      .filter((n): n is number => n !== null);
    const sheetTotal = sheetCounts.length ? sum(sheetCounts) : null;

    const summaryCounts = summaries.map((s) => parseQty(s.total)).filter((q) => q.kind === "count");
    const summaryTotal = summaryCounts.length ? sum(summaryCounts.map((q) => q.n)) : null;

    const primary = legacyItems[0];
    const legacyTotal = primary && !isFabricatedLegacyTotal(primary, null) ? primary.total : null;
    for (const dup of legacyItems.slice(1)) {
      notes.push(`Legacy app duplicate "${dup.name}" (total ${dup.total}) merged in.`);
    }

    const unitsTotal = def.unitCategory
      ? units.filter((u) => u.condition !== "disposed" && u.condition !== "missing").length
      : null;

    let total: number | null = null;
    let basis = "unknown";
    if (unitsTotal !== null) {
      total = unitsTotal;
      basis = "unit register (excl. disposed/missing)";
    } else if (legacyTotal !== null) {
      total = legacyTotal;
      basis = "legacy app (Jul-Sep 2026)";
    } else if (summaryTotal !== null) {
      total = summaryTotal;
      basis = `${summaries[0].sheet} summary`;
    } else if (sheetTotal !== null) {
      total = sheetTotal;
      basis = SHEET_ELECTRICAL;
    }

    const known = [
      ["unit register", unitsTotal],
      ["legacy app", legacyTotal],
      ["summary", summaryTotal],
      [SHEET_ELECTRICAL, sheetTotal],
    ].filter((pair): pair is [string, number] => pair[1] !== null);
    if (new Set(known.map(([, n]) => n)).size > 1) {
      this.flag(
        "check",
        "product",
        def.key,
        def.name,
        `Totals disagree: ${known.map(([s, n]) => `${s} ${n}`).join(", ")}. Used ${basis}.`,
      );
    }

    // --- Where it is -------------------------------------------------------
    const robotAllocations: Allocation[] = [];
    let storeFromUnits: number | null = null;

    if (def.unitCategory) {
      const byHolder = new Map<string, number>();
      for (const unit of units) {
        if (unit.holder && unit.holder !== STORE) byHolder.set(unit.holder, (byHolder.get(unit.holder) ?? 0) + 1);
      }
      for (const [holder, qty] of byHolder) {
        robotAllocations.push({ holder, qty, basis: "unit register allocation tags" });
      }
      storeFromUnits = units.filter((u) => u.holder === STORE && u.condition !== "disposed" && u.condition !== "missing").length;
      if (def.viewColumns) throw new Error(`registry ${def.key}: unit register and robot view are exclusive`);
    }

    for (const column of def.viewColumns ?? []) {
      if (!this.src.robotView.columns.includes(column)) {
        throw new Error(`registry ${def.key}: robot view column "${column}" not found`);
      }
    }
    if (def.viewColumns) {
      for (const row of this.src.robotView.rows) {
        const cells = def.viewColumns.map((column) => parseViewCell(row.counts[column] ?? ""));
        const held = sum(cells.map((c) => c.held));
        const need = sum(cells.map((c) => c.need));
        const holder = resolveHolder(row.robot);
        if (!holder) {
          if (held > 0) {
            this.flag("check", "product", def.key, def.name, `Robot view row "${row.robot}" has ${held} but matches no robot.`);
          }
          continue;
        }
        if (held > 0) robotAllocations.push({ holder, qty: held, basis: `Robot-Specific View R${row.row}` });
        if (need > 0) notes.push(`Robot view: ${holder} still needs ${need}.`);
      }
      sources.push(`Robot-Specific View: ${def.viewColumns.join(" + ")}`);
      if (total === null) {
        total = sum(robotAllocations.map((a) => a.qty));
        basis = "sum of Robot-Specific View counts (no stock record)";
      }
    }
    robotAllocations.push(...(def.allocations ?? []));

    for (const allocation of robotAllocations) {
      if (!ROBOT_HOLDERS.some((h) => h.name === allocation.holder)) {
        throw new Error(`registry ${def.key}: unknown holder "${allocation.holder}"`);
      }
    }

    for (const item of legacyItems) {
      if (item.faulty_qty > 0) {
        this.flag(
          "check",
          "product",
          def.key,
          def.name,
          `Legacy app reports ${item.faulty_qty} faulty (after the register was last updated); identify which units.`,
        );
      }
    }

    const storeUnitLocations = units
      .filter((u) => u.holder === STORE && u.lastSeenLocation && u.lastSeenLocation.toLowerCase() !== "storage")
      .map((u) => u.lastSeenLocation)
      .filter((loc) => LOCATIONS.some((l) => l.name === loc));
    const location =
      def.location ?? mostCommon(storeUnitLocations) ?? (mainRows[0] ? resolveLocation(mainRows[0].location) : null);

    const lenders = [...new Set(units.filter((u) => u.ownership === "on_loan").map((u) => u.loanedFrom ?? "unknown"))];
    const onLoanCount = units.filter((u) => u.ownership === "on_loan").length;
    const ownership: Ownership = onLoanCount === 0 ? "owned" : onLoanCount === units.length ? "on_loan" : "mixed";

    previousNames.delete(def.name);
    this.addProduct(
      {
        key: def.key,
        action: def.action ?? "import",
        name: def.name,
        previousNames,
        category: def.category,
        criticality: def.criticality,
        tier: tierFor(def.criticality, null),
        unit: def.unit ?? "pcs",
        partNumber: null,
        spec: null,
        location,
        ownership,
        loanedFrom: lenders.length ? lenders.join("; ") : null,
        qtyTotal: total,
        qtyBasis: basis,
        qtySheet: sheetTotal === null ? "" : String(sheetTotal),
        qtyLegacy: legacyItems.map((i) => i.total).join(" + "),
        qtyUnits: def.unitCategory ? `${units.length} (${unitsTotal} not disposed/missing)` : "",
        robotAllocations,
        storeFromUnits,
        seedStore: 0,
        seedRobots: 0,
        openLoans: 0,
        notes,
        sources,
        legacyIds: def.legacyIds ?? [],
      },
      def.flags,
    );
  }

  private nextFreeCode(code: string): string {
    const match = /^(.*-)(\d+)$/.exec(code);
    if (!match) return `${code}-DUP`;
    const width = match[2].length;
    let n = Number(match[2]);
    let candidate = code;
    while (this.unitCodes.has(candidate)) {
      n += 1;
      candidate = `${match[1]}${String(n).padStart(width, "0")}`;
    }
    return candidate;
  }

  private buildUnits(def: RegistryDef): Unit[] {
    const rows = [...this.src.highValue.units, ...this.src.referee.units].filter((u) => u.category === def.unitCategory);
    const out: Unit[] = [];

    for (const row of rows) {
      const source = `${row.sheet}!R${row.row}`;
      let code = collapse(row.componentId);
      if (!code || /^nil$/i.test(code)) {
        this.flag("check", "unit", source, def.name, "Register row has no component ID; not imported as a unit.");
        continue;
      }
      if (this.unitCodes.has(code)) {
        const renamed = this.nextFreeCode(code);
        this.flag(
          "check",
          "unit",
          renamed,
          def.name,
          `Component ID ${code} appears twice (second at ${source}); the second was renamed ${renamed}. Relabel that unit.`,
        );
        code = renamed;
      }
      this.unitCodes.add(code);

      const notes: string[] = [];
      let condition = unitCondition(row);
      const override = UNIT_OVERRIDES[code];
      if (override) {
        condition = override.condition ?? condition;
        notes.push(override.note);
      }
      const { ownership, loanedFrom } = unitOwnership(row.remarks);

      const tag = row.allocationTag.trim().toLowerCase();
      let holder: string;
      if (tag === DISPOSED_TAG) {
        holder = "";
      } else if (STORE_TAGS.has(tag)) {
        holder = STORE;
      } else if (UNASSIGNED_TAGS.has(tag)) {
        holder = STORE;
        notes.push("Location unknown ('Other / Unassigned'): counted in the store until audited.");
      } else {
        const robot = resolveHolder(row.allocationTag);
        if (robot) {
          holder = robot;
        } else {
          holder = STORE;
          this.flag("check", "unit", code, def.name, `Allocation tag "${row.allocationTag}" matches no holder; counted in the store.`);
        }
      }

      const locationHolder = resolveHolder(row.location);
      if (locationHolder && holder && locationHolder !== holder) {
        this.flag(
          "info",
          "unit",
          code,
          def.name,
          `Location says "${row.location}" but allocation tag says "${row.allocationTag}"; used the tag.`,
        );
      }

      const serial = cleanSerial(row.serial);
      if (serial.note) notes.push(serial.note);
      if (row.remarks) notes.push(collapse(row.remarks));
      if (row.poc) notes.push(`POC: ${collapse(row.poc)}`);

      out.push({
        code,
        productKey: def.key,
        serial: serial.serial,
        condition,
        ownership,
        loanedFrom,
        holder,
        lastSeenLocation: resolveLocation(row.location) ?? collapse(row.location),
        lastCheckedOn: row.lastChecked,
        labelled: /^yes$/i.test(row.labelled) ? "true" : /^no$/i.test(row.labelled) ? "false" : "",
        notes,
        source,
      });
    }

    this.units.push(...out);
    return out;
  }

  // -------------------------------------------------------------------------
  // Electrical Parts, generic path
  // -------------------------------------------------------------------------

  private matchLegacy(item: string, row: number | null, qty: Qty): LegacyItem | null {
    if (row !== null) {
      const crosswalked = Object.entries(LEGACY_TO_MAIN_ROW).find(
        ([id, mainRow]) => mainRow === row && !this.usedLegacy.has(id),
      );
      if (crosswalked) {
        this.usedLegacy.add(crosswalked[0]);
        return this.legacyById.get(crosswalked[0]) ?? null;
      }
    }
    const key = nameKey(item);
    let candidates = this.src.legacy.items.filter((i) => !this.usedLegacy.has(i.id) && nameKey(i.name) === key);
    if (!candidates.length) {
      // Resistor book: the sheet writes "110k" / "1M", the legacy app "110kΩ" / "1MΩ".
      const value = parseBookResistorValue(item);
      candidates = value
        ? this.src.legacy.items.filter(
            (i) => !this.usedLegacy.has(i.id) && /\[Loc: book\]/i.test(i.notes) && parseBookResistorValue(i.name) === value,
          )
        : [];
    }
    if (!candidates.length) return null;
    const sheetCount = qty.kind === "count" ? qty.n : null;
    const pick = candidates.find((i) => i.total === sheetCount) ?? candidates[0];
    this.usedLegacy.add(pick.id);
    return pick;
  }

  private buildGeneric(input: GenericInput, ov: RowOverride, key: string, isMain: boolean, extraNote?: string) {
    const flags: CuratedFlag[] = [...(ov.flags ?? [])];
    const notes: string[] = [];
    if (ov.notes) notes.push(ov.notes);
    if (extraNote) notes.push(extraNote);

    const isBook = input.location.trim().toLowerCase() === "book";
    const storage = parseQty(input.qtyStorage);
    const outside = parseQty(input.qtyOutside);
    const qty: Qty =
      storage.kind === "level"
        ? storage
        : outside.kind === "count" && outside.n > 0
          ? { kind: "count", n: (storage.kind === "count" ? storage.n : 0) + outside.n }
          : storage;
    if (outside.kind === "count" && outside.n > 0) {
      flags.push({ severity: "check", issue: `Sheet has ${outside.n} 'outside' with no robot named; counted in the store.` });
    }

    let name: string;
    let category: string;
    let spec: Record<string, string> | null;
    if (isBook) {
      const value = ov.bookValue ?? parseBookResistorValue(input.item);
      category = CATEGORY.resistors;
      if (value) {
        name = value === "0" ? "Resistor 0Ω jumper 0402" : `Resistor ${value}Ω 0402`;
        spec = { type: "resistor", value, package: "0402", series: "E24" };
        if (!ov.bookValue && !isE24(value)) {
          flags.push({ severity: "check", issue: `${value}Ω is not an E24 value; check the book pocket.` });
        }
      } else {
        name = cleanName(input.item);
        spec = null;
        flags.push({ severity: "blocker", issue: `Resistor book value "${input.item}" did not parse.` });
      }
    } else {
      const thtResistor = /^Resistor\s+(\d+(?:\.\d+)?)\s*([kM])?\s*Ω$/.exec(input.item.normalize("NFKC").trim());
      name =
        ov.name ??
        (thtResistor && input.section.toLowerCase().startsWith("components through hole")
          ? `Resistor ${thtResistor[1]}${thtResistor[2] ?? ""}Ω, through-hole`
          : cleanName(input.item));
      category = ov.category ?? categorize(input.item, input.section);
      spec = extractSpec(name, category);
    }
    if (category === CATEGORY.unsorted && ov.action !== "hold") {
      flags.push({ severity: "check", issue: `Could not categorise "${input.item}".` });
    }

    const criticality = ov.criticality ?? defaultCriticality(category);

    // --- Quantity ----------------------------------------------------------
    const legacy = this.matchLegacy(input.item, isMain ? input.row : null, qty);
    const legacyUsable = legacy && !isFabricatedLegacyTotal(legacy, qty) ? legacy : null;
    if (legacy && !legacyUsable) this.fabricated.push(`${legacy.name} (${key})`);

    const sheetCount = qty.kind === "count" ? qty.n : null;
    let total: number | null = null;
    let basis: string;
    if (qty.kind === "level") {
      basis = `stock level only: "${qty.raw}"`;
      notes.push(`Sheet stock level: "${qty.raw}".`);
    } else if (legacyUsable) {
      total = legacyUsable.total;
      if (sheetCount === null) {
        basis = "legacy app (sheet blank)";
      } else if (sheetCount === total) {
        basis = "sheet = legacy app";
      } else {
        basis = "legacy app (newer than sheet)";
        flags.push({
          severity: "check",
          issue: `Sheet says ${sheetCount}, legacy app says ${total} (Jul-Sep 2026). Took the app's figure as newer (restock or use since the sheet?); verify on the shelf.`,
        });
      }
    } else if (sheetCount !== null) {
      total = sheetCount;
      basis = "sheet";
    } else {
      basis = "not counted";
      if (isBook) this.bookUncounted.push(input.row);
      else flags.push({ severity: "check", issue: "No quantity in any source; count it before go-live." });
    }

    const resolvedLocation = input.location ? resolveLocation(input.location) : null;
    if (input.location && !resolvedLocation) {
      flags.push({ severity: "info", issue: `Unrecognised location "${input.location}".` });
    }

    const previousNames = new Set([input.item, ...(legacy ? [legacy.name] : [])]);
    previousNames.delete(name);

    this.addProduct(
      {
        key,
        action: ov.action ?? "import",
        name,
        previousNames,
        category,
        criticality,
        tier: tierFor(criticality, qty),
        unit: ov.unit ?? "pcs",
        partNumber: isBook ? null : extractPartNumber(input.item),
        spec,
        location: resolvedLocation ?? (input.location ? cleanName(input.location) : null),
        ownership: "owned",
        loanedFrom: null,
        qtyTotal: total,
        qtyBasis: basis,
        qtySheet: qty.kind === "count" ? String(qty.n) : qty.kind === "level" ? qty.raw : "",
        qtyLegacy: legacy ? `${legacy.total}${legacyUsable ? "" : " (invented, ignored)"}` : "",
        qtyUnits: "",
        robotAllocations: [],
        storeFromUnits: null,
        seedStore: 0,
        seedRobots: 0,
        openLoans: 0,
        notes,
        sources: [`${SHEET_ELECTRICAL}!${isMain ? "" : "side "}R${input.row}`, ...(legacy ? [`legacy:${legacy.id.slice(0, 8)}`] : [])],
        legacyIds: legacy ? [legacy.id] : [],
      },
      flags,
    );
  }

  private mergeRow(item: string, row: number, qtyStorage: string, targetKey: string, ov: RowOverride, label: string) {
    const target = this.productByKey.get(targetKey);
    if (!target) throw new Error(`merge target ${targetKey} not found for ${label}`);
    const legacy = this.matchLegacy(item, null, parseQty(qtyStorage));
    target.sources.push(label);
    target.previousNames.add(item);
    if (legacy) {
      target.sources.push(`legacy:${legacy.id.slice(0, 8)}`);
      target.legacyIds.push(legacy.id);
      this.productByLegacyId.set(legacy.id, target);
    }
    for (const f of ov.flags ?? []) this.flag(f.severity, "product", target.key, target.name, f.issue);
    void row;
  }

  buildElectrical() {
    const merges: { row: number; item: string; qtyStorage: string; ov: RowOverride }[] = [];
    for (const row of this.src.electrical.main) {
      if (this.consumedMainRows.has(row.row)) continue;
      const ov = MAIN_ROW_OVERRIDES[row.row] ?? {};
      if (ov.mergeInto) {
        merges.push({ row: row.row, item: row.item, qtyStorage: row.qtyStorage, ov });
        continue;
      }
      this.buildGeneric(row, ov, `ep-r${row.row}`, true);
    }
    for (const m of merges) {
      this.mergeRow(m.item, m.row, m.qtyStorage, `ep-r${m.ov.mergeInto}`, m.ov, `${SHEET_ELECTRICAL}!R${m.row} (duplicate)`);
    }

    for (const row of this.src.electrical.side) {
      const ov = SIDE_ROW_OVERRIDES[row.row] ?? {};
      if (ov.mergeInto) {
        this.mergeRow(row.item, row.row, row.qtyStorage, `ep-r${ov.mergeInto}`, ov, `${SHEET_ELECTRICAL}!side R${row.row} (duplicate)`);
        continue;
      }
      if (row.qtyStorage === "") {
        this.buildBomLine(row);
        continue;
      }
      const version = /old supercap/i.test(row.remarks)
        ? "Spare stock for the old (v1) supercap controller."
        : /new supercap/i.test(row.remarks)
          ? "Stock for the new (v2) supercap controller."
          : undefined;
      this.buildGeneric(
        { row: row.row, section: "SMD", item: row.item, qtyStorage: row.qtyStorage, qtyOutside: "", location: row.location },
        ov,
        `ep-side-r${row.row}`,
        false,
        version,
      );
    }

    if (this.bookUncounted.length) {
      this.flag(
        "check",
        "product",
        `ep-r${this.bookUncounted[0]}..ep-r${this.bookUncounted.at(-1)}`,
        "Resistor book (0402)",
        `${this.bookUncounted.length} resistor-book values have no count in the sheet (the legacy app's 100 each was invented). Imported with no stock; count the pockets.`,
      );
    }
  }

  private buildBomLine(row: ElectricalSideRow) {
    const item = collapse(row.item);
    const bom = row.section.toLowerCase().startsWith("capacitor bank") ? "capacitor-bank" : "supercap-controller-v2";
    if (item) {
      const legacy = this.matchLegacy(item, null, { kind: "blank" });
      if (legacy) this.fabricated.push(`${legacy.name} (BOM line)`);
    }
    const needed = parseQty(row.needed);
    this.bom.push({
      bom,
      sourceRow: row.row,
      partNumber: item ? (extractPartNumber(item) ?? item.replace(/\s*\(.*\)\s*$/, "")) : "",
      description: item ? (BOM_DESCRIPTIONS[item] ?? "") : "",
      qtyPerBuild: needed.kind === "count" ? String(needed.n) : "",
      status: item ? "to_purchase" : "part_number_missing",
      note: item ? "" : "Sheet lists a quantity needed but no part number.",
    });
    if (item && !BOM_DESCRIPTIONS[item]) this.flag("info", "bom", `R${row.row}`, item, "No description curated for this part number.");
  }

  // -------------------------------------------------------------------------
  // Legacy leftovers, members, loans, balances
  // -------------------------------------------------------------------------

  buildLegacyLeftovers() {
    for (const item of this.src.legacy.items) {
      if (this.usedLegacy.has(item.id)) continue;
      this.usedLegacy.add(item.id);
      const drop = LEGACY_DROP[item.id];
      if (drop) {
        this.flag("info", "legacy", item.id.slice(0, 8), item.name, `Dropped: ${drop}`);
        continue;
      }
      const only = LEGACY_ONLY[item.id];
      const category = only?.category ?? categorize(item.name, item.category);
      const criticality = only?.criticality ?? defaultCriticality(category);
      const name = only?.name ?? cleanName(item.name);
      this.addProduct(
        {
          key: only?.key ?? `legacy-${item.id.slice(0, 8)}`,
          action: only ? "import" : "hold",
          name,
          previousNames: new Set(item.name === name ? [] : [item.name]),
          category,
          criticality,
          tier: tierFor(criticality, null),
          unit: "pcs",
          partNumber: extractPartNumber(item.name),
          spec: extractSpec(name, category),
          location: null,
          ownership: "owned",
          loanedFrom: null,
          qtyTotal: item.total,
          qtyBasis: "legacy app only",
          qtySheet: "",
          qtyLegacy: String(item.total),
          qtyUnits: "",
          robotAllocations: [],
          storeFromUnits: null,
          seedStore: 0,
          seedRobots: 0,
          openLoans: 0,
          notes: [`Added in the legacy app on ${item.created_at.slice(0, 10)}.`],
          sources: [`legacy:${item.id.slice(0, 8)}`],
          legacyIds: [item.id],
        },
        only
          ? []
          : [{ severity: "check", issue: `Legacy item "${item.name}" (total ${item.total}) matches no sheet row. Held.` }],
      );
    }

    if (this.fabricated.length) {
      this.flag(
        "info",
        "legacy",
        "-",
        "Legacy app quantities",
        `The legacy app invented a quantity of 100 for ${this.fabricated.length} rows (non-numeric/blank sheet quantities and to-be-purchased BOM lines). All ignored. E.g. ${this.fabricated.slice(0, 5).join("; ")}.`,
      );
    }
  }

  buildMembers(): MemberRow[] {
    const rows = [...this.src.legacy.profiles]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((profile) => {
        const email = profile.email.trim().toLowerCase();
        const proposal = ROLE_PROPOSALS[email];
        const notes: string[] = [];
        if (proposal) notes.push(proposal.reason);
        else if (profile.role === "admin") notes.push("Was 'admin' in the legacy app: decide member / procurement / admin.");
        notes.push("Real name and Telegram handle needed.");
        return {
          fullName: profile.name,
          email,
          role: proposal?.role ?? "member",
          legacyRole: profile.role,
          note: notes.join(" "),
        };
      });

    this.flag(
      "check",
      "member",
      "-",
      "All members",
      `${rows.length} legacy accounts carry only an email: full_name is the email handle and there is no Telegram handle, so nobody can bind until the club roster supplies them.`,
    );
    const legacyAdmins = rows.filter((r) => r.legacyRole === "admin" && !ROLE_PROPOSALS[r.email]);
    this.flag(
      "check",
      "member",
      "-",
      "Roles",
      `${legacyAdmins.length} people were 'admin' in the legacy app; all proposed as 'member' until someone decides who is procurement and who is a developer (admin): ${legacyAdmins.map((r) => r.fullName).join(", ")}.`,
    );
    return rows;
  }

  buildLoans(): Loan[] {
    const profiles = new Map(this.src.legacy.profiles.map((p) => [p.id, p]));
    const windowMs = BULK_LOAN_WINDOW_MINUTES * 60_000;

    // Bursts: >= BULK_LOAN_MIN_ROWS checkouts by one person inside the window.
    const bulk = new Map<string, number>();
    const byPerson = new Map<string, typeof this.src.legacy.borrows>();
    for (const b of this.src.legacy.borrows) byPerson.set(b.person_id, [...(byPerson.get(b.person_id) ?? []), b]);
    for (const [, list] of byPerson) {
      const sorted = [...list].sort((a, b) => Date.parse(a.checked_out_at) - Date.parse(b.checked_out_at));
      for (let i = 0; i < sorted.length; i++) {
        let j = i;
        while (j < sorted.length && Date.parse(sorted[j].checked_out_at) - Date.parse(sorted[i].checked_out_at) <= windowMs) j++;
        if (j - i >= BULK_LOAN_MIN_ROWS) for (let k = i; k < j; k++) bulk.set(sorted[k].id, j - i);
      }
    }

    const loans: Loan[] = [];
    const bulkPeople = new Map<string, number>();
    for (const b of this.src.legacy.borrows) {
      const qty = b.qty_out - b.qty_returned;
      if (b.status !== "open" || qty <= 0) continue;
      const product = this.productByLegacyId.get(b.item_id);
      const profile = profiles.get(b.person_id);
      if (!product || !profile) {
        this.flag("check", "loan", b.id.slice(0, 8), b.item_name, `Open legacy loan could not be mapped (${!product ? "item" : "member"} unknown).`);
        continue;
      }
      const notes: string[] = [];
      let action: ImportAction = "import";
      const burst = bulk.get(b.id);
      if (burst) {
        action = "hold";
        notes.push(`One of ${burst}+ checkouts by the same account within ${BULK_LOAN_WINDOW_MINUTES} min: probably a pack-out or a test, not personal loans.`);
        bulkPeople.set(b.person_name, (bulkPeople.get(b.person_name) ?? 0) + 1);
      }
      if (product.action !== "import") {
        action = "hold";
        notes.push("Product is held.");
      }
      const movement = product.criticality === "expendable" ? "consume" : "borrow";
      if (movement === "consume") notes.push("Expendable part: imported as consumed, not as a loan.");
      if (movement === "borrow" && product.criticality === "critical" && qty >= 3 && action === "import") {
        action = "hold";
        notes.push("3+ critical parts on one person: more likely allocated to a robot. Held.");
        this.flag(
          "check",
          "loan",
          b.id.slice(0, 8),
          product.name,
          `${b.person_name} has ${qty} out since ${b.checked_out_at.slice(0, 10)}. Personal loan, or on a robot? Held so the overdue nudges don't chase the wrong thing.`,
        );
      }
      loans.push({
        borrowId: b.id,
        action,
        memberEmail: profile.email.trim().toLowerCase(),
        memberLegacyName: b.person_name,
        productKey: product.key,
        productName: product.name,
        movement,
        qty,
        borrowedAt: b.checked_out_at,
        notes,
      });
    }

    for (const [person, count] of bulkPeople) {
      this.flag(
        "check",
        "loan",
        person,
        "Bulk checkout",
        `${count} open loans by ${person} were entered in a burst of checkouts minutes apart (probably a competition pack-out or a test of the old app). Held: confirm with them before importing as personal loans, or the overdue nudges will chase them.`,
      );
    }
    return loans;
  }

  buildBalances(loans: Loan[]): Balance[] {
    const balances: Balance[] = [];
    for (const product of this.products) {
      if (product.action !== "import" || product.qtyTotal === null) continue;
      const robots = sum(product.robotAllocations.map((a) => a.qty));
      const loanQty = sum(loans.filter((l) => l.productKey === product.key && l.action === "import").map((l) => l.qty));
      let store = product.storeFromUnits ?? product.qtyTotal - robots;

      if (store < loanQty) {
        this.flag(
          "check",
          "product",
          product.key,
          product.name,
          `Recorded total ${product.qtyTotal}, but robots hold ${robots} and members have ${loanQty} out: over by ${loanQty - store}. Store seeded with ${Math.max(loanQty, 0)} so nothing goes negative, which makes the ledger total ${robots + Math.max(loanQty, 0)}. Stocktake per robot before go-live.`,
        );
        store = Math.max(loanQty, 0);
      }

      product.seedStore = store;
      product.seedRobots = robots;
      product.openLoans = loanQty;
      if (store > 0) {
        balances.push({ productKey: product.key, productName: product.name, holderKind: "store", holderName: STORE, qty: store, basis: product.qtyBasis });
      }
      for (const a of product.robotAllocations) {
        balances.push({ productKey: product.key, productName: product.name, holderKind: "robot", holderName: a.holder, qty: a.qty, basis: a.basis });
      }
    }
    return balances;
  }

  checkDuplicateSerials() {
    const bySerial = new Map<string, string[]>();
    for (const unit of this.units) {
      if (unit.serial) bySerial.set(unit.serial, [...(bySerial.get(unit.serial) ?? []), unit.code]);
    }
    for (const [serial, codes] of bySerial) {
      if (codes.length > 1) {
        this.flag("check", "unit", codes.join(", "), serial, `Serial ${serial} is recorded on ${codes.length} units; at least one is a transcription error.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function writeCsv(file: string, header: string[], rows: (string | number | boolean | null)[][]) {
  const lines = [toCsvLine(header), ...rows.map((row) => toCsvLine(row.map((v) => (v === null ? "" : String(v)))))];
  writeFileSync(path.join(OUT_DIR, file), lines.join("\n") + "\n", "utf-8");
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, check: 1, info: 2 };

function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

export async function run(root: string, force: boolean) {
  const outDir = path.join(root, OUT_DIR);
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !force) {
    throw new Error(`${OUT_DIR}/ already has files (reviewer edits?). Re-run with --force to overwrite.`);
  }

  const src = await loadSources(root);
  const build = new CatalogBuild(src);

  for (const def of REGISTRY) build.buildRegistry(def);
  build.buildElectrical();
  build.buildLegacyLeftovers();
  build.checkDuplicateSerials();
  const members = build.buildMembers();
  const loans = build.buildLoans();
  const balances = build.buildBalances(loans);

  mkdirSync(outDir, { recursive: true });
  process.chdir(root);

  const products = [...build.products].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  writeCsv(
    "products.csv",
    [
      "key", "action", "name", "category", "criticality", "tier", "returnable", "unit",
      "qty_total", "qty_basis", "seed_store", "seed_robots", "open_loans",
      "qty_sheet", "qty_legacy_app", "qty_unit_register",
      "location", "ownership", "loaned_from", "part_number", "spec_json",
      "previous_names", "notes", "sources",
    ],
    products.map((p) => [
      p.key, p.action, p.name, p.category, p.criticality, p.tier, p.criticality !== "expendable", p.unit,
      p.qtyTotal, p.qtyBasis, p.action === "import" && p.qtyTotal !== null ? p.seedStore : "", p.seedRobots || "", p.openLoans || "",
      p.qtySheet, p.qtyLegacy, p.qtyUnits,
      p.location, p.ownership, p.loanedFrom, p.partNumber, p.spec ? JSON.stringify(p.spec) : "",
      [...p.previousNames].join(" | "), p.notes.join(" "), p.sources.join("; "),
    ]),
  );

  const productName = new Map(build.products.map((p) => [p.key, p.name]));
  writeCsv(
    "asset_units.csv",
    ["unit_code", "product_key", "product_name", "serial_number", "condition", "ownership", "loaned_from", "holder", "last_seen_location", "last_checked_on", "labelled", "notes", "source"],
    build.units.map((u) => [
      u.code, u.productKey, productName.get(u.productKey) ?? "", u.serial, u.condition, u.ownership, u.loanedFrom,
      u.holder, u.lastSeenLocation, u.lastCheckedOn, u.labelled, u.notes.join(" | "), u.source,
    ]),
  );

  writeCsv(
    "opening_balances.csv",
    ["product_key", "product_name", "holder_kind", "holder_name", "qty", "basis"],
    balances.map((b) => [b.productKey, b.productName, b.holderKind, b.holderName, b.qty, b.basis]),
  );

  writeCsv(
    "open_loans.csv",
    ["legacy_borrow_id", "action", "member_email", "member_legacy_name", "product_key", "product_name", "movement", "qty", "borrowed_at", "notes"],
    loans.map((l) => [l.borrowId, l.action, l.memberEmail, l.memberLegacyName, l.productKey, l.productName, l.movement, l.qty, l.borrowedAt, l.notes.join(" ")]),
  );

  writeCsv(
    "holders.csv",
    ["name", "kind", "aliases", "note"],
    ROBOT_HOLDERS.map((h) => [h.name, "robot", h.aliases.join(" | "), h.note ?? ""]),
  );

  writeCsv("locations.csv", ["name", "aliases"], LOCATIONS.map((l) => [l.name, l.aliases.join(" | ")]));

  // Same header as the /admin/members roster import, plus two review columns it ignores.
  writeCsv(
    "members.csv",
    ["full_name", "display_name", "nus_email", "telegram_username", "role", "joined_at", "legacy_role", "review_note"],
    members.map((m) => [m.fullName, "", m.email, "", m.role, "", m.legacyRole, m.note]),
  );

  writeCsv(
    "bom_lines.csv",
    ["bom", "source_row", "part_number", "description", "qty_per_build", "status", "note"],
    build.bom.map((b) => [b.bom, b.sourceRow, b.partNumber, b.description, b.qtyPerBuild, b.status, b.note]),
  );

  const flags = [...build.flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.entity.localeCompare(b.entity) || a.name.localeCompare(b.name),
  );
  writeCsv("review_flags.csv", ["severity", "entity", "key", "name", "issue"], flags.map((f) => [f.severity, f.entity, f.key, f.name, f.issue]));

  const imported = build.products.filter((p) => p.action === "import");
  const summary = {
    products: build.products.length,
    imported: imported.length,
    held: build.products.filter((p) => p.action === "hold").length,
    byCriticality: countBy(imported, (p) => p.criticality),
    byTier: countBy(imported, (p) => p.tier),
    byCategory: countBy(imported, (p) => p.category),
    ownership: countBy(imported, (p) => p.ownership),
    units: build.units.length,
    unitConditions: countBy(build.units, (u) => u.condition),
    balances: balances.length,
    loansImported: loans.filter((l) => l.action === "import").length,
    loansHeld: loans.filter((l) => l.action === "hold").length,
    members: members.length,
    bomLines: build.bom.length,
    flags: countBy(flags, (f) => f.severity),
  };
  return summary;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  run(process.cwd(), process.argv.includes("--force"))
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      console.log(`\nWrote ${OUT_DIR}/. Nothing was written to the database.`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
