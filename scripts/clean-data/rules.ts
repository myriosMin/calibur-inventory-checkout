/**
 * Pure normalisation and classification rules for the catalog clean-up.
 * Generic heuristics only -- anything that is a judgement about ONE specific
 * row lives in curation.ts instead, so it can be reviewed row by row.
 */

import type { LegacyItem } from "./sources";

export type Tier = "asset" | "bulk" | "loose";
export type Criticality = "critical" | "standard" | "expendable";
export type Ownership = "owned" | "on_loan" | "mixed";
export type Condition = "ok" | "faulty" | "disposed" | "missing" | "unknown";
export type Severity = "blocker" | "check" | "info";
export type ImportAction = "import" | "hold" | "drop";

export const CATEGORY = {
  motors: "Motors & ESCs",
  referee: "Referee system",
  compute: "Compute & vision",
  rc: "Remote control",
  batteries: "Batteries & power",
  devboards: "Dev boards & modules",
  assemblies: "Custom PCBs & assemblies",
  mechanical: "Mechanical",
  connectors: "Connectors",
  cables: "Cables & wires",
  resistors: "Passives – resistors",
  capacitors: "Passives – capacitors",
  inductors: "Passives – inductors",
  semis: "Semiconductors & ICs",
  switches: "Switches & electromechanical",
  fuses: "Fuses & protection",
  hobbyMotors: "Hobby motors & actuators",
  tools: "Tools & test equipment",
  consumables: "Consumables",
  unsorted: "Unsorted",
} as const;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Matching key across sources: case, Ω/ohm, µ/μ/u and punctuation folded. */
export function nameKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ωΩ]/g, "ohm")
    .replace(/[μµ]/g, "u")
    .replace(/[^a-z0-9.]+/g, "");
}

const TYPO_FIXES: [RegExp, string][] = [
  [/\b(schottcky|shottcky|schottk)\b/gi, "Schottky"],
  [/capacotior/gi, "capacitor"],
  [/oscilliscope/gi, "oscilloscope"],
  [/kaplon/gi, "Kapton"],
  [/simplfier/gi, "simplifier"],
  [/themistor/gi, "Thermistor"],
  [/\b([FMAC])\s?to\s?([FMAC])\b/g, "$1-$2"],
  // Resistance units -> Ω. "2.2mohm" is milliohm; "1M ohm" is megohm.
  [/(\d(?:\.\d+)?)\s?[kK]\s?ohms?\b/g, "$1kΩ"],
  [/(\d(?:\.\d+)?)\s?M\s+ohms?\b/g, "$1MΩ"],
  [/(\d(?:\.\d+)?)\s?mohms?\b/g, "$1mΩ"],
  [/(\d(?:\.\d+)?)\s?ohms?\b/g, "$1Ω"],
  [/[μµ]F/g, "uF"],
];

export function fixTypos(value: string): string {
  return TYPO_FIXES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function cleanName(raw: string): string {
  return sentenceCase(collapse(fixTypos(collapse(raw))));
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export type Qty = { kind: "count"; n: number } | { kind: "level"; raw: string } | { kind: "blank" };

/** "50" -> count; "a lot" / ">50" / "3 sticks" / "1tub" -> level; "" -> blank. Never invents a number. */
export function parseQty(raw: string): Qty {
  const value = raw.trim();
  if (value === "") return { kind: "blank" };
  if (/^\d+(\.0+)?$/.test(value)) return { kind: "count", n: Math.round(Number(value)) };
  return { kind: "level", raw: value };
}

/** Robot-Specific View cell: "6" -> held 6; "need 4" -> held 0, short 4. */
export function parseViewCell(raw: string): { held: number; need: number } {
  const value = raw.trim().toLowerCase();
  const need = /^need\s+(\d+)$/.exec(value);
  if (need) return { held: 0, need: Number(need[1]) };
  if (/^\d+$/.test(value)) return { held: Number(value), need: 0 };
  return { held: 0, need: 0 };
}

/**
 * The legacy app replaced every non-numeric or blank sheet quantity with 100
 * ("orig qty: 'a lot'"), and gave every to-be-purchased supercap BOM line a
 * total of 100 too ("[Needed: 4]"). None of those 100s were ever counted.
 */
export function isFabricatedLegacyTotal(item: LegacyItem, sheetQty: Qty | null): boolean {
  if (/orig qty:/i.test(item.notes) || /\[Needed:/i.test(item.notes)) return true;
  return item.total === 100 && sheetQty !== null && sheetQty.kind !== "count";
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CONSUMABLE_RE = /heat ?shrink|shrink tube|solder sleeve|\btape\b|\bsolder\b|flux/;
const TOOL_RE = /tester|logic analy[sz]er|data logger|multimeter|oscillo/;
const DEVBOARD_RE =
  /arduino|\brpi\b|raspberry|stm32|breadboard|perf board|buck|\bbec\b|stepper driver|motor driver|\bbms\b|encoder|nrf24|\bimu\b|lcd|cuav|sensor|usb to ttl|power delivery|hx0089/;
const HOBBY_MOTOR_RE = /motor|\bstepper\b/;
const INDUCTOR_RE = /inductor|ferrite/;
const CAPACITOR_RE = /capacit|\d(?:\.\d+)?\s?k?[pnuμµ]f\b|\d(?:\.\d+)?f\b/;
const SEMI_RE =
  /diode|schottky|\btvs\b|\bled\b|\brgb\b|mosfet|nmos|pmos|\bbjt\b|igbt|transistor|optocoupler|regulator|\bic\b|amplifier|op ?amp|opamp|\b555\b|crystal|flash|\b49e\b|\bl296\b|\bmps\d{4}|\b2n\d{4}/;
const RESISTOR_RE = /resistor|ω|ohm|shunt|potentiometer|trim ?pot|thermistor/;
const FUSE_RE = /fuse/;
const SWITCH_RE = /switch|button|relay|solenoid|buzzer/;
const CONNECTOR_RE = /xt30|xt60|xt90|mr30|jst|molex|dupont|crimp|header|pin conn|terminal|aviation|barrel jack|connector/;
const CABLE_RE = /usb|ethernet|mini b|jumper|wire|cable|ribbon|\bcsi\b|clips/;

/** Keyword category for an Electrical Parts row. Order matters: earlier rules win. */
export function categorize(item: string, section: string): string {
  const text = item.normalize("NFKC").toLowerCase();
  const sec = section.toLowerCase();

  if (sec.startsWith("tools")) return CONSUMABLE_RE.test(text) ? CATEGORY.consumables : CATEGORY.tools;
  if (CONSUMABLE_RE.test(text)) return CATEGORY.consumables;
  if (TOOL_RE.test(text)) return CATEGORY.tools;
  if (sec.startsWith("assembled")) return CATEGORY.assemblies;
  if (/battery holder/.test(text)) return CATEGORY.batteries;
  if (DEVBOARD_RE.test(text)) return CATEGORY.devboards;
  if (HOBBY_MOTOR_RE.test(text)) return CATEGORY.hobbyMotors;
  if (INDUCTOR_RE.test(text)) return CATEGORY.inductors;
  if (CAPACITOR_RE.test(text)) return CATEGORY.capacitors;
  if (SEMI_RE.test(text)) return CATEGORY.semis;
  if (RESISTOR_RE.test(text)) return CATEGORY.resistors;
  if (FUSE_RE.test(text)) return CATEGORY.fuses;
  if (SWITCH_RE.test(text)) return CATEGORY.switches;
  if (sec.startsWith("wires")) return CATEGORY.cables;
  if (CONNECTOR_RE.test(text)) return CATEGORY.connectors;
  if (CABLE_RE.test(text)) return CATEGORY.cables;
  if (sec.startsWith("connectors")) return CATEGORY.connectors;
  return CATEGORY.unsorted;
}

/**
 * Default criticality from category. Critical is reserved for things that
 * are expensive (roughly S$150+ a unit), competition-mandatory, safety
 * relevant or irreplaceable, and is almost always set explicitly in
 * curation.ts rather than inferred here.
 */
export function defaultCriticality(category: string): Criticality {
  switch (category) {
    case CATEGORY.motors:
    case CATEGORY.referee:
    case CATEGORY.compute:
    case CATEGORY.rc:
      return "critical";
    case CATEGORY.tools:
    case CATEGORY.devboards:
    case CATEGORY.assemblies:
    case CATEGORY.hobbyMotors:
    case CATEGORY.batteries:
    case CATEGORY.mechanical:
      return "standard";
    default:
      return "expendable";
  }
}

/** Tier only drives counting UX: level-only stock is `loose`, anything that comes back is `asset`. */
export function tierFor(criticality: Criticality, qty: Qty | null): Tier {
  if (qty?.kind === "level") return "loose";
  return criticality === "expendable" ? "bulk" : "asset";
}

// ---------------------------------------------------------------------------
// Specs and part numbers
// ---------------------------------------------------------------------------

const PACKAGE_RE = /\b(0201|0402|0603|0805|1206|1210|1812|2512)\b/;

export function extractSpec(name: string, category: string): Record<string, string> | null {
  const text = name.normalize("NFKC");
  const pkg = PACKAGE_RE.exec(text)?.[1];
  const spec: Record<string, string> = {};

  if (category === CATEGORY.resistors) {
    spec.type = /potentiometer|trim pot/i.test(text) ? "potentiometer" : "resistor";
    const value = /(\d+(?:\.\d+)?)\s?([kKmM])?\s?Ω/.exec(text);
    if (value) spec.value = `${value[1]}${value[2] === "K" ? "k" : (value[2] ?? "")}`;
    const power = /(\d+(?:\.\d+)?)\s?(m?W)\b/.exec(text);
    if (power) spec.power = `${power[1]}${power[2]}`;
  } else if (category === CATEGORY.capacitors) {
    spec.type = /electrolytic/i.test(text)
      ? "electrolytic"
      : /supercap|\d(?:\.\d+)?F\b/.test(text)
        ? "supercapacitor"
        : "ceramic";
    const value = /(\d+(?:\.\d+)?)\s?(k\s?u|kp|[pnu])?F\b/i.exec(text.replace(/[μµ]/g, "u"));
    if (value) spec.value = `${value[1]}${(value[2] ?? "").replace(/\s/g, "")}F`;
    const voltage = /(\d+(?:\.\d+)?)\s?(k)?V\b/.exec(text);
    if (voltage) spec.voltage = `${voltage[1]}${voltage[2] ?? ""}V`;
    const dielectric = /\b(X7R|X5R|X7S|C0G|NP0)\b/i.exec(text);
    if (dielectric) spec.dielectric = dielectric[1].toUpperCase();
  } else {
    return null;
  }

  if (pkg) spec.package = pkg;
  return Object.keys(spec).length > 1 ? spec : null;
}

const NOT_A_PART_NUMBER = /^(SOD|SOT|QFN|PQFN|TSSOP|SOIC|DIP|SMD|THT|JST|USB)/i;

/** Best-effort manufacturer part number: the last MPN-shaped token in the name. */
export function extractPartNumber(name: string): string | null {
  const candidates = name
    .split(/[\s,()]+/)
    .filter(
      (token) =>
        token.length >= 6 &&
        /^[A-Za-z0-9][A-Za-z0-9\-#./]+$/.test(token) &&
        /[A-Za-z]/.test(token) &&
        (token.match(/\d/g) ?? []).length >= 2 &&
        !/\./.test(token) &&
        !NOT_A_PART_NUMBER.test(token) &&
        // "17.4kohm", "665kohmSMD", "48Mhz": a quantity with a unit, not a part.
        !/^\d+(\.\d+)?[A-Za-zΩμµ]+$/.test(token),
    );
  return candidates.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Resistor book (0402 E24 sample book)
// ---------------------------------------------------------------------------

/** "R 0402 0 ohm", "R 402 1.1", "402 2.7Ω", "1.2Ω", "110k", "9.1MΩ" -> "0" / "1.1" / "2.7" / "1.2" / "110k" / "9.1M". */
export function parseBookResistorValue(item: string): string | null {
  const text = item.normalize("NFKC").trim();
  const match = /^(?:R\s+)?(?:0?402\s+)?(\d+(?:\.\d+)?)\s*([kKM])?\s*(?:Ω|ohms?)?$/.exec(text);
  if (!match) return null;
  return `${match[1]}${match[2] === "K" ? "k" : (match[2] ?? "")}`;
}

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

export function resistanceOhms(value: string): number {
  const match = /^(\d+(?:\.\d+)?)([kM])?$/.exec(value);
  if (!match) return Number.NaN;
  const multiplier = match[2] === "k" ? 1e3 : match[2] === "M" ? 1e6 : 1;
  return Number(match[1]) * multiplier;
}

export function isE24(value: string): boolean {
  const ohms = resistanceOhms(value);
  if (ohms === 0) return true;
  if (!Number.isFinite(ohms) || ohms < 0) return false;
  const mantissa = ohms / 10 ** Math.floor(Math.log10(ohms));
  return E24.some((e) => Math.abs(e - mantissa) < 0.005);
}

// ---------------------------------------------------------------------------
// Per-unit register
// ---------------------------------------------------------------------------

const FAULT_RE = /bloat|\bbad\b|\bdead\b|\bded\b|damage|error|cannot connect|destroyed|killed/i;

export function unitCondition(unit: {
  functioning: string;
  remarks: string;
  location: string;
  allocationTag: string;
}): Condition {
  if (unit.allocationTag.trim().toLowerCase() === "disposed / missing") {
    return /missing/i.test(`${unit.location} ${unit.remarks}`) ? "missing" : "disposed";
  }
  if (/^no$/i.test(unit.functioning.trim())) return "faulty";
  if (FAULT_RE.test(unit.remarks)) return "faulty";
  if (/^yes$/i.test(unit.functioning.trim())) return "ok";
  return "unknown";
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

/** "On loan from Advantech Sep 2025" / "loaned to us indefinitely by Huimin". */
export function unitOwnership(remarks: string): { ownership: "owned" | "on_loan"; loanedFrom: string | null } {
  const onLoan = new RegExp(`on loan from ([A-Za-z][\\w .&-]*?)(?:\\s+${MONTH}\\s+\\d{4})?\\s*$`, "i").exec(remarks);
  if (onLoan) return { ownership: "on_loan", loanedFrom: onLoan[1].trim() };
  const loanedBy = /loaned to us (?:indefinitely )?by ([A-Za-z][\w .&-]*)$/i.exec(remarks);
  if (loanedBy) return { ownership: "on_loan", loanedFrom: loanedBy[1].trim() };
  return { ownership: "owned", loanedFrom: null };
}

export function cleanSerial(raw: string): { serial: string | null; note: string | null } {
  const value = collapse(raw);
  if (!value || /^(nil|-|na|n\/a)$/i.test(value)) return { serial: null, note: null };
  if (/sticker|too scratched/i.test(value)) return { serial: null, note: `Serial: ${value}` };
  if (/\?|scratched/i.test(value)) {
    return { serial: value.replace(/\s*\(scratched\)/i, "").trim(), note: "Serial partly unreadable" };
  }
  return { serial: value, note: null };
}
