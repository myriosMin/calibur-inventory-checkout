/**
 * The human-judgement layer of the catalog clean-up.
 *
 * Everything in this file is an assumption made by a developer with an
 * electrical/robotics background, NOT confirmed by the people who run the
 * store. Each one is either reflected in data/clean/review_flags.csv or
 * visible in the output columns, so the SME review can overturn it. When a
 * reviewer corrects something, prefer editing data/clean/*.csv directly; only
 * change this file if the build needs re-running from the raw sources.
 */

import { CATEGORY, type Criticality, type Severity } from "./rules";

/** Timestamp for opening-balance `seed` movements: before the earliest open legacy loan (2026-08-07). */
export const OPENING_BALANCE_AT = "2026-08-01T00:00:00+08:00";

export interface CuratedFlag {
  severity: Severity;
  issue: string;
}

// ---------------------------------------------------------------------------
// Holders
// ---------------------------------------------------------------------------

export interface RobotHolderDef {
  name: string;
  /** Lowercased labels used for this robot across the sheets. */
  aliases: string[];
  note?: string;
}

/** Canonical robot/project holders, from the Robot-Specific View rows plus the older remarks' spellings. */
export const ROBOT_HOLDERS: RobotHolderDef[] = [
  {
    name: "DarkNUS",
    aliases: ["darkstds", "darknus", "darkstd", "darkstd team 1", "darkstd team 2", "darkstd team 3", "darkstd team 4"],
    note: "The four DarkSTD standards (DarkSTD Team 1-4) are one holder; split them if parts move between them.",
  },
  { name: "Hero", aliases: ["hero", "old hero", "with hero"] },
  { name: "Sentry", aliases: ["sentry"] },
  { name: "Dart", aliases: ["dart", "with dart"] },
  { name: "Engineer 2.0", aliases: ["engineer 2.0", "with engineer"] },
  { name: "Old Engineer", aliases: ["old engineer"] },
  { name: "Aerial", aliases: ["aerial", "with aerial"] },
  { name: "Outpost", aliases: ["outpost"] },
  { name: "Standard – Kirbee", aliases: ["standard (kirbee)", "kirbee", "kirby", "kirby gimbal"] },
  { name: "Standard – Pancake", aliases: ["standard (pancake)", "pancake", "with pancake"] },
  { name: "Balancing Standard – Evans", aliases: ["balancing standard (evans)"] },
  { name: "Balancing Standard – Yiming", aliases: ["balancing standard (yiming)"] },
  {
    name: "Balancing Standard – Acrylic prototype",
    aliases: ["balancing standard prototype acrylic daren", "balancing standard prototype"],
  },
  { name: "Balancing Standard – EG3301", aliases: ["balancing standard eg3301"] },
  { name: "Hero chassis prototype", aliases: ["hero chassis prototype", "prototype hero chassis"] },
  { name: "Hero gimbal prototype", aliases: ["hero gimbal prototype"] },
  { name: "Hero launcher prototype", aliases: ["hero launcher prototype"] },
  { name: "Standard prototyping", aliases: ["standard prototyping"] },
  { name: "Firmware trainer", aliases: ["firmware trainer"] },
  { name: "Aimbot trainer (Waddledee)", aliases: ["aimbot trainer (using waddledee)", "waddledee", "with aimbot"] },
  {
    name: "Standard (unspecified)",
    aliases: ["standard (unspecified)"],
    note: "Bucket from the sheet: on *a* standard, which one unknown. Re-home by stocktake, then deactivate.",
  },
  {
    name: "Balancing Standard (unspecified)",
    aliases: ["balancing standard (unspecified)"],
    note: "Bucket from the sheet: on *a* balancing standard. Re-home by stocktake, then deactivate.",
  },
];

/** Allocation tags that mean "in the store". */
export const STORE_TAGS = new Set([
  "storage / unallocated",
  "leftover from 2024 material purchase order",
  "shelf storage (near the tower)",
]);
/** Allocation tags that mean "exists, location unknown": seeded into the store and flagged for audit. */
export const UNASSIGNED_TAGS = new Set(["other / unassigned", ""]);
export const DISPOSED_TAG = "disposed / missing";

export function resolveHolder(label: string): string | null {
  const key = label.trim().toLowerCase();
  return ROBOT_HOLDERS.find((h) => h.name.toLowerCase() === key || h.aliases.includes(key))?.name ?? null;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export const LOCATIONS: { name: string; aliases: string[] }[] = [
  { name: "Table shelf", aliases: ["table shelf"] },
  { name: "Rotating shelf", aliases: ["rotating shelf"] },
  { name: "Small box", aliases: ["small box"] },
  { name: "Resistor book (0402)", aliases: ["book"] },
  { name: "Blue rack", aliases: ["blue rack"] },
  { name: "Battery charging point", aliases: ["battery charging point", "charging rack"] },
  { name: "DarkNUS box", aliases: ["3 darknus box", "near darknus box", "darknus box"] },
  { name: "Capacitor bank box", aliases: ["box with cap bank"] },
  { name: "JLC boxes", aliases: ["boxes jlc"] },
  { name: "Metal cabinet", aliases: ["metal cabinet"] },
  { name: "Yellow flammable storage cabinet", aliases: ["yellow flammable storage cabinet", "flammable cupboard"] },
  { name: "Shelf near door", aliases: ["shelf near door"] },
  { name: "Remote controller rack", aliases: ["remote controller rack"] },
  { name: "Clear box in grey shelf", aliases: ["clear box in grey shelf"] },
  { name: "Grey tables", aliases: ["grey tables"] },
  { name: "Shelf of shame (faulty parts)", aliases: ["shelf of shame"] },
  { name: "Delivery box", aliases: ["in delivery box"] },
  { name: "Balancing box", aliases: ["balancing box"] },
  { name: "Box (unspecified)", aliases: ["box"] },
];

/** First comma-separated token of a sheet location that names a known place. */
export function resolveLocation(raw: string): string | null {
  for (const token of raw.split(",")) {
    const key = token.trim().toLowerCase();
    const hit = LOCATIONS.find((loc) => loc.aliases.includes(key));
    if (hit) return hit.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Registry products: the RoboMaster hardware that appears in more than one
// source and has to be merged by hand.
// ---------------------------------------------------------------------------

export interface Allocation {
  holder: string;
  qty: number;
  basis: string;
}

export interface RegistryDef {
  key: string;
  name: string;
  category: string;
  criticality: Criticality;
  unit?: string;
  location?: string;
  /** Electrical Parts main-table rows folded into this product. */
  electricalRows?: number[];
  /** "High Value Items" / "Referee System Inventory" summary names (column A). */
  summary?: string[];
  /** Per-unit register "Item Category" (column E). Present => total and allocation come from the units. */
  unitCategory?: string;
  /** Legacy app items.id. The first is primary; the rest are duplicates merged in. */
  legacyIds?: string[];
  /** Robot-Specific View column headers whose per-robot counts are this product. */
  viewColumns?: string[];
  /** Robot allocations parsed by hand from Electrical Parts remarks. */
  allocations?: Allocation[];
  action?: "import" | "hold";
  notes?: string;
  flags?: CuratedFlag[];
}

export const REGISTRY: RegistryDef[] = [
  // --- Motors & ESCs -------------------------------------------------------
  {
    key: "m3508",
    name: "DJI M3508 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [173],
    summary: ["M3508 Motor (w and w/o gearbox)", "Flywheel Motor (M3508 Gearbox)"],
    legacyIds: ["a284994b-72af-43f2-817f-abe4c9671791"],
    viewColumns: ["M3508", "Flywheel Motor (M3508 Gearbox)"],
    notes: "Includes M3508s used as flywheel motors (gearbox removed); the gearbox is an accessory, not a different part.",
    flags: [
      {
        severity: "check",
        issue:
          "4 serials recorded without component IDs (R04DLAUA020033, R04DK49A010327, R04DKC1A010164 'supposedly damaged', R04DK48A010241). Not imported as units until the M3508s are labelled.",
      },
    ],
  },
  {
    key: "m2006",
    name: "DJI M2006 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    electricalRows: [174],
    summary: ["M2006 Motor"],
    legacyIds: ["69ca9645-8547-470f-8544-b88511a267e1"],
    viewColumns: ["M2006"],
  },
  {
    key: "gm6020",
    name: "DJI GM6020 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [175],
    summary: ["GM6020 Motor"],
    legacyIds: ["8fd4abf4-4a3b-4c6a-a133-6fe135545d7c"],
    viewColumns: ["GM6020"],
  },
  {
    key: "snail2305",
    name: "DJI Snail 2305 motor",
    category: CATEGORY.motors,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [176],
    legacyIds: ["de34a0cb-4497-43f7-95e6-b38c556bff03"],
    notes: "17mm flywheel motor, roughly S$40 a unit: tracked as standard, not critical.",
  },
  {
    key: "dm4340",
    name: "Damiao DM4340 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [177],
    summary: ["DM4340 Motor"],
    legacyIds: ["a7961885-b3a1-46cd-b978-445082bcf8c3"],
    viewColumns: ["DM4340"],
  },
  {
    key: "dm4310",
    name: "Damiao DM4310 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [178],
    summary: ["DM4310 Motor"],
    legacyIds: ["68cb478a-aeb6-44c7-9f0e-729cc789468d"],
    viewColumns: ["DM4310"],
  },
  {
    key: "dm8009",
    name: "Damiao DM8009P motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [179],
    summary: ["DM8009 Motor"],
    legacyIds: ["f7c1368b-1a73-4925-8baa-f29933cbb22f"],
    viewColumns: ["DM8009"],
    notes: "Sheet names: 'Damiao J8009P', 'DM8009 Motor', 'DM8009', 'DM809' -- one part.",
  },
  {
    key: "dm10010",
    name: "Damiao DM10010 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    electricalRows: [180],
    summary: ["DM10010"],
    legacyIds: ["4bcf37ee-ae1f-4862-8c8a-080182d5bbf6"],
    allocations: [{ holder: "Old Engineer", qty: 1, basis: "Electrical Parts R180 remark 'engineer'" }],
    flags: [
      {
        severity: "check",
        issue: "Remark just says 'engineer'; assumed the Old Engineer (Engineer 2.0 has no DM motors in the robot view).",
      },
    ],
  },
  {
    key: "dm3507",
    name: "Damiao DM3507 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    summary: ["DM3507"],
    legacyIds: ["d992d99e-7772-4440-81ca-9d8eed5f827b"],
  },
  {
    key: "dm3519",
    name: "DM3519 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    legacyIds: ["00775f29-36f7-4863-acff-f6c256f2684a", "08022ee5-d168-46f9-a5cc-a4abb7253218"],
    flags: [
      {
        severity: "check",
        issue:
          "Only exists in the legacy app, added twice (16 Aug and 19 Aug 2026, 41 each; merged as 41). 41 of a large motor is a big purchase -- confirm the model and count.",
      },
    ],
  },
  {
    key: "dm3520",
    name: "DM3520 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    legacyIds: ["4386e084-3a28-4a75-8249-656f10965b1a"],
    action: "hold",
    flags: [
      {
        severity: "check",
        issue:
          "Legacy-app-only item added 19 Aug 2026 with exactly the same quantity (41) as DM3519 a minute earlier -- probable data-entry duplicate. Held.",
      },
    ],
  },
  {
    key: "mg4005",
    name: "MG4005 motor",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [196],
    summary: ["MG4005"],
  },
  {
    key: "mg5010e",
    name: "MG5010E motor",
    category: CATEGORY.motors,
    criticality: "critical",
    viewColumns: ["MG5010E"],
    flags: [{ severity: "check", issue: "Only appears as a per-robot count in the robot view (1 on Hero); no stock record." }],
  },
  {
    key: "c620",
    name: "DJI C620 ESC",
    category: CATEGORY.motors,
    criticality: "critical",
    electricalRows: [181],
    summary: ["ESC620"],
    legacyIds: ["5dc867ee-4ca5-4c55-a182-0337e6db4a56"],
    viewColumns: ["C620"],
  },
  {
    key: "c610",
    name: "DJI C610 ESC",
    category: CATEGORY.motors,
    criticality: "critical",
    electricalRows: [182],
    summary: ["ESC610"],
    legacyIds: ["3a0c8469-d5eb-4686-a227-319c30cafe43"],
    viewColumns: ["C610"],
  },
  {
    key: "c615",
    name: "DJI C615 ESC",
    category: CATEGORY.motors,
    criticality: "critical",
    location: "Blue rack",
    electricalRows: [183],
    summary: ["ESC615"],
    legacyIds: ["ed67a532-bed3-4490-be7a-cce9ea72ef10"],
  },

  // --- Referee system: all critical, all serialised ------------------------
  ...(
    [
      ["cm01", "Supercapacitor Management Module CM01", ["14499f83-4ae5-4e23-9e7d-830e461df18c"]],
      ["am12", "Large Armor Module AM12", ["d1a3ee5d-2cf8-4f65-9a13-582cdccfdd34"]],
      ["li01", "Light Indicator Module LI01", ["873e168a-d595-4b89-9e13-a36eec5cec69"]],
      ["mc02", "Main Control Module MC02", ["5fc56b4e-1b0b-41f3-b1cc-f62ed678fd87"]],
      ["uw01", "Positioning System Module UW01", ["5281a169-d521-4c1b-95e3-51557dde3ea7"]],
      ["uw11", "Positioning System Module UW11", ["33605c58-6892-4713-aa60-2481ad1d05b7"]],
      ["pm02", "Power Management Module PM02", ["ee4cde67-f5c7-4236-ac0b-bd1a1a924e67", "29164ff0-ae71-4a04-802d-60b3e495ce8b"]],
      ["tc01", "RFID Interaction Card TC01", ["55220476-bbbd-48b5-977f-689a6a6bce84"]],
      ["fi02", "RFID Interaction Module FI02", ["528cbe86-b227-43c5-bc5b-733aee837097"]],
      ["am02", "Small Armor Module AM02", ["ca463b0d-2fbe-431a-9d2f-7e616e5e0a9b"]],
      ["sm01", "Speed Monitor Module 17mm SM01", ["c4f70b6a-362b-4711-aaad-dc9add8ada08"]],
      ["sm11", "Speed Monitor Module 42mm SM11", ["bd17b617-0fc4-46ec-a374-e5555dd2ab6f"]],
      ["vt12", "VTM Receiver VT12", ["eae84185-db4d-42ba-bea9-e952d7beb2ee"]],
      ["vt12-charger", "VTM Receiver VT12 Charger", ["513dd118-47e5-4d3a-b9be-dc33cc7822e9"]],
      ["vt02", "VTM Transmitter VT02", ["59b42381-6404-4f18-adc7-68520c195cfb"]],
      ["vt03", "VTM Transmitter VT03", ["f705d764-d6b2-4fd4-a3fb-5a7ad7f55854"]],
      ["vt13", "VTM Receiver + Remote VT13", ["41535c70-6453-4375-8c80-f98b9d3abee3"]],
    ] as const
  ).map(
    ([key, name, legacyIds]): RegistryDef => ({
      key: `ref-${key}`,
      name: `DJI referee ${name}`,
      category: CATEGORY.referee,
      criticality: "critical",
      summary: [name],
      unitCategory: name,
      legacyIds: [...legacyIds],
    }),
  ),

  // --- Remote control ------------------------------------------------------
  {
    key: "dt7-dr16",
    name: "DJI DR16 receiver (DT7 set)",
    category: CATEGORY.rc,
    criticality: "critical",
    electricalRows: [197],
    summary: ["Remote Receiver DT7"],
    unitCategory: "Remote Receiver DT7",
    legacyIds: ["60488f88-1e85-474b-a0c4-a7563444d72a", "a9c5be20-31f4-4856-b910-1754d2e41ad6"],
    notes: "Merged: 'Remote Receiver DT7' (register) and 'DR16 receiver' (Electrical Parts) -- the DR16 is the receiver of the DT7 set, and both count 11.",
    flags: [
      {
        severity: "check",
        issue: "Merged 'DR16 receiver' (Electrical Parts, 11) into the DT7 register (14 labelled units). Confirm they are the same receivers.",
      },
    ],
  },
  {
    key: "ndj6",
    name: "DJI remote controller NDJ6",
    category: CATEGORY.rc,
    criticality: "critical",
    location: "Remote controller rack",
    summary: ["Remote Controller NDJ6"],
    unitCategory: "Remote Controller NDJ6",
    legacyIds: ["a2347a25-cb75-40d0-b1ef-eb0653e5a16b"],
  },
  {
    key: "controller-old",
    name: "Old controller (model unconfirmed)",
    category: CATEGORY.rc,
    criticality: "critical",
    electricalRows: [188],
    action: "hold",
    flags: [
      {
        severity: "check",
        issue: "'Old Controller' (6) in Electrical Parts: probably DT7 transmitters, possibly already counted elsewhere. Held until identified.",
      },
    ],
  },
  {
    key: "controller-new",
    name: "New controller (model unconfirmed)",
    category: CATEGORY.rc,
    criticality: "critical",
    electricalRows: [189],
    legacyIds: ["24c633e9-dbf3-43a1-93ea-f0ea6b8345d7"],
    action: "hold",
    flags: [
      {
        severity: "check",
        issue: "'New Controller' (7): possibly the NDJ6 remotes (11 in the register) counted again. Held until identified.",
      },
    ],
  },

  // --- Batteries -----------------------------------------------------------
  {
    key: "tb47s",
    name: "DJI TB47S battery",
    category: CATEGORY.batteries,
    criticality: "critical",
    summary: ["Battery TB47S"],
    unitCategory: "Battery TB47S",
    legacyIds: ["f5cee398-1d13-414f-8f00-33c181dbf106"],
    notes: "LiPo: store in the flammable cabinet; swollen packs must not be issued.",
    flags: [
      {
        severity: "blocker",
        issue:
          "SAFETY: 9 of 10 TB47S packs are recorded as swollen (8) or 'bad' (1). Swollen LiPo packs are a fire risk -- quarantine and dispose through the lab's battery disposal route; do not issue. Imported as condition=faulty.",
      },
    ],
  },
  {
    key: "tb48s",
    name: "DJI TB48S battery",
    category: CATEGORY.batteries,
    criticality: "critical",
    location: "Battery charging point",
    summary: ["Battery TB48S"],
    unitCategory: "Battery TB48S",
    legacyIds: ["4d149664-1280-420b-8add-b295968e0871"],
  },
  {
    key: "matrice4d",
    name: "DJI Matrice 4D battery",
    category: CATEGORY.batteries,
    criticality: "critical",
    summary: ["Battery MATRICE4D"],
    unitCategory: "Battery MATRICE4D",
    legacyIds: ["1f9db014-db43-49c1-a7de-a0d0c3717802"],
  },
  {
    key: "battery-old",
    name: "Battery 'old' (model unconfirmed)",
    category: CATEGORY.batteries,
    criticality: "critical",
    electricalRows: [186],
    action: "hold",
    flags: [
      {
        severity: "check",
        issue: "'Battery old' (17) in Electrical Parts: probably the TB47S/TB48S packs already in the unit register. Held to avoid double-counting.",
      },
    ],
  },
  {
    key: "battery-new",
    name: "Battery 'new' (model unconfirmed)",
    category: CATEGORY.batteries,
    criticality: "critical",
    electricalRows: [187],
    action: "hold",
    flags: [
      {
        severity: "check",
        issue: "'Battery new' (8) in Electrical Parts: probably TB48S or Matrice 4D packs already in the register. Held to avoid double-counting.",
      },
    ],
  },
  {
    key: "battery-rack-new",
    name: "Battery rack (new)",
    category: CATEGORY.batteries,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [184],
    legacyIds: ["cff03b9e-d76d-4e6e-b668-efd6037b7f56"],
    flags: [
      {
        severity: "check",
        issue:
          "Robot view puts 19 battery racks on robots but does not split new/old, and the sheet only says 'new robots' -- robot allocation not seeded, all counted in the store.",
      },
    ],
  },
  {
    key: "battery-rack-old",
    name: "Battery rack (old)",
    category: CATEGORY.batteries,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [185],
    legacyIds: ["9d116dd5-8fb7-49b2-91f1-e8233f6cb667"],
    allocations: [{ holder: "DarkNUS", qty: 6, basis: "Electrical Parts R185: 6 outside, remark 'darknus'" }],
  },
  {
    key: "uv-charger",
    name: "UV charger",
    category: CATEGORY.batteries,
    criticality: "standard",
    legacyIds: ["b247ff89-8f72-4320-8df3-59ccb556dff3"],
    viewColumns: ["UV Charger"],
    flags: [{ severity: "info", issue: "Model and what 'UV' means are unknown; tracked as a standard battery charger." }],
  },

  // --- Compute & vision ----------------------------------------------------
  {
    key: "jetson-orin-nx",
    name: "NVIDIA Jetson Orin NX",
    category: CATEGORY.compute,
    criticality: "critical",
    electricalRows: [193],
    summary: ["NVIDIA Jetson Orin NX"],
    unitCategory: "NVIDIA Jetson Orin NX",
    legacyIds: ["ed1575ea-172a-46bd-8dd4-77d81d2ca526"],
    notes: "Legacy app, 23 Jul 2026: one Orin NX 'broke during testing' and was written off; one 'overvoltaged and killed the board'.",
    flags: [
      {
        severity: "check",
        issue:
          "Sheets say 2 Orin NX; the register has 1 labelled unit. Legacy log (23 Jul 2026) writes one off and reports one killed by overvoltage -- possibly the same incident logged twice. Imported as 1 unit, condition faulty.",
      },
    ],
  },
  {
    key: "jetson-agx-orin",
    name: "NVIDIA Jetson AGX Orin",
    category: CATEGORY.compute,
    criticality: "critical",
    location: "Yellow flammable storage cabinet",
    electricalRows: [194],
    summary: ["NVIDIA Jetson Orin AGX"],
    unitCategory: "NVIDIA Jetson Orin AGX",
    legacyIds: ["a8897b87-3d41-4f47-8885-d00f0039921c"],
  },
  {
    key: "jetson-agx-thor",
    name: "NVIDIA Jetson AGX Thor",
    category: CATEGORY.compute,
    criticality: "critical",
    summary: ["NVIDIA Jetson Thor AGX"],
    unitCategory: "NVIDIA Jetson Thor AGX",
    legacyIds: ["8e72aca9-df47-4480-9546-b997647ce2c0"],
  },
  {
    key: "jetson-xavier-nx",
    name: "NVIDIA Jetson Xavier NX",
    category: CATEGORY.compute,
    criticality: "critical",
    summary: ["NVIDIA Jetson Xavier NX"],
    unitCategory: "NVIDIA Jetson Xavier NX",
  },
  {
    key: "nanopi-r6c",
    name: "FriendlyElec NanoPi R6C",
    category: CATEGORY.compute,
    criticality: "critical",
    summary: ["Nanopi-R6C"],
    unitCategory: "Nanopi-R6C",
    legacyIds: ["878c75a1-86e7-407a-98c0-ac8b13900b66"],
  },
  {
    key: "mini-pc",
    name: "Mini PC",
    category: CATEGORY.compute,
    criticality: "critical",
    electricalRows: [195],
    allocations: [{ holder: "Standard – Kirbee", qty: 1, basis: "Electrical Parts R195 remark 'kirby gimbal'" }],
    flags: [{ severity: "info", issue: "Make/model unknown." }],
  },
  {
    key: "oak-d-lite",
    name: "Luxonis OAK-D Lite",
    category: CATEGORY.compute,
    criticality: "critical",
    summary: ["Oak-D-lite"],
    unitCategory: "Oak-D-lite",
    legacyIds: ["5bf7a6f3-978a-4565-aae0-81e7f86acaab"],
  },
  {
    key: "oak-1-lite",
    name: "Luxonis OAK-1 Lite",
    category: CATEGORY.compute,
    criticality: "critical",
    summary: ["Oak-1-lite"],
    unitCategory: "Oak-1-lite",
    legacyIds: ["c3cde955-923a-4328-a146-1870adc70319"],
  },
  {
    key: "realsense-d435i",
    name: "Intel RealSense D435i depth camera",
    category: CATEGORY.compute,
    criticality: "critical",
    electricalRows: [199],
    summary: ["D435i Depth Camera"],
    legacyIds: ["68bcd8f5-c542-45c6-a241-05458a0813ec"],
    allocations: [
      { holder: "Standard – Kirbee", qty: 1, basis: "Electrical Parts R199: 2 outside, remark 'Kirby, sentry'" },
      { holder: "Sentry", qty: 1, basis: "Electrical Parts R199: 2 outside, remark 'Kirby, sentry'" },
    ],
  },
  {
    key: "livox-lidar",
    name: "Livox LiDAR",
    category: CATEGORY.compute,
    criticality: "critical",
    location: "Metal cabinet",
    electricalRows: [200],
    summary: ["Livox LIDAR"],
    legacyIds: ["07b40d22-7538-40c7-9e13-7fe0e688862b"],
    allocations: [{ holder: "Sentry", qty: 1, basis: "Electrical Parts R200: 1 outside, remark 'metal cabinet, sentry'" }],
    flags: [{ severity: "info", issue: "Model unknown (Mid-360?)." }],
  },
  {
    key: "h30-imu",
    name: "H30 IMU",
    category: CATEGORY.compute,
    criticality: "critical",
    electricalRows: [198],
    summary: ["H30 IMU"],
    legacyIds: ["083e93c6-4f4e-44a1-8a66-f9c6eb1b040c"],
    flags: [
      {
        severity: "check",
        issue: "Sheet: 3 outside, remark 'Hero, Hopps' -- no per-robot counts and 'Hopps' matches no robot. Robot allocation not seeded.",
      },
    ],
  },
  {
    key: "hikvision-camera",
    name: "Hikvision industrial camera",
    category: CATEGORY.compute,
    criticality: "critical",
    electricalRows: [202],
    summary: ["Hikvision Camera"],
    legacyIds: ["39e2e60c-2840-47c2-af01-903cdd5b16e1"],
    flags: [
      { severity: "check", issue: "Sheet: 2 outside on 'robot' (which?). Robot allocation not seeded. Model unknown." },
    ],
  },

  // --- Dev boards ----------------------------------------------------------
  {
    key: "dev-board-c",
    name: "DJI RoboMaster Development Board Type C",
    category: CATEGORY.devboards,
    criticality: "critical",
    summary: ["Dev C"],
    legacyIds: ["2428aa8e-a966-423d-829e-2821497d69a5"],
    viewColumns: ["Dev C"],
    notes: "Every robot's main controller: cheap-ish but competition-critical, so tracked as critical.",
  },
  {
    key: "dev-board-a",
    name: "DJI RoboMaster Development Board Type A",
    category: CATEGORY.devboards,
    criticality: "critical",
    viewColumns: ["Dev A"],
    flags: [{ severity: "check", issue: "Only appears in the robot view (3 on robots); no stock record." }],
  },
  {
    key: "stm32h7-board",
    name: "STM32H7 board",
    category: CATEGORY.devboards,
    criticality: "standard",
    electricalRows: [201],
    legacyIds: ["b3204cce-3fec-4d74-ae2f-e8f4bf5b0035"],
  },
  {
    key: "st-link",
    name: "ST-Link debugger",
    category: CATEGORY.tools,
    criticality: "standard",
    legacyIds: ["f7cb360b-73cf-4f2f-abbe-83cc07dce450"],
  },

  // --- Custom PCBs & assemblies -------------------------------------------
  {
    key: "capacitor-bank-new",
    name: "Supercapacitor bank (new)",
    category: CATEGORY.assemblies,
    criticality: "critical",
    electricalRows: [170],
    legacyIds: ["bf928538-61d2-4103-9551-0773b60da2bd"],
    notes: "Club-built supercap bank: stores enough energy to hurt, and takes weeks to rebuild.",
  },
  {
    key: "capacitor-bank-old",
    name: "Supercapacitor bank (old)",
    category: CATEGORY.assemblies,
    criticality: "critical",
    electricalRows: [171],
    legacyIds: ["b2a260e7-e84a-4038-9e7c-584a0ad54dd7"],
  },
  {
    key: "peak-shaving-controller",
    name: "Peak-shaving controller (LT8708A)",
    category: CATEGORY.assemblies,
    criticality: "standard",
    electricalRows: [172],
    legacyIds: ["0ff5ea58-4dd3-42f6-83b7-2bcc82c90799"],
  },
  {
    key: "center-board-1",
    name: "ESC center board 1",
    category: CATEGORY.assemblies,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [190],
    legacyIds: ["8eedff3a-3e6d-4af8-8758-b25879df22dd"],
    allocations: [{ holder: "DarkNUS", qty: 8, basis: "Electrical Parts R190: 8 outside, remark 'darknus'" }],
  },
  {
    key: "center-board-2",
    name: "ESC center board 2",
    category: CATEGORY.assemblies,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [191],
    legacyIds: ["72241885-5bcc-446f-a1f1-5a5b69c50106"],
    viewColumns: ["ESC Center Board 2"],
  },
  {
    key: "dart-trigger",
    name: "Dart trigger",
    category: CATEGORY.assemblies,
    criticality: "standard",
    location: "Blue rack",
    electricalRows: [192],
  },
  {
    key: "darknus-slip-ring",
    name: "DarkNUS slip ring",
    category: CATEGORY.assemblies,
    criticality: "standard",
    electricalRows: [203],
    legacyIds: ["08cf041d-2c57-4e4f-82be-9fbae3a689bd"],
    flags: [
      { severity: "check", issue: "Sheet: 7 outside with no robot named ('near darknus box, blue rack'). Counted in the store." },
    ],
  },

  // --- Mechanical (only what the robot view already counts) ----------------
  {
    key: "mecanum-left",
    name: "Mecanum wheel (left)",
    category: CATEGORY.mechanical,
    criticality: "standard",
    viewColumns: ["Left Mecanum"],
    flags: [{ severity: "info", issue: "From the robot view only; the mechanical sheet is still being written." }],
  },
  {
    key: "mecanum-right",
    name: "Mecanum wheel (right)",
    category: CATEGORY.mechanical,
    criticality: "standard",
    viewColumns: ["Right Mecanum"],
    flags: [{ severity: "info", issue: "From the robot view only; the mechanical sheet is still being written." }],
  },

  // --- Tools ---------------------------------------------------------------
  {
    key: "electric-screwdriver",
    name: "Electric screwdriver",
    category: CATEGORY.tools,
    criticality: "standard",
    summary: ["Electric Screwdriver"],
    legacyIds: ["c60b0200-89b1-44bc-b0da-f7b2f2b1789f"],
  },
];

// ---------------------------------------------------------------------------
// Electrical Parts: per-row overrides for the generic path
// ---------------------------------------------------------------------------

export interface RowOverride {
  name?: string;
  category?: string;
  criticality?: Criticality;
  unit?: string;
  action?: "hold";
  /** This row duplicates another row of the same table; fold it in. */
  mergeInto?: number;
  /** Resistor book: corrected value, e.g. "3k". */
  bookValue?: string;
  notes?: string;
  flags?: CuratedFlag[];
}

const check = (issue: string): CuratedFlag => ({ severity: "check", issue });
const info = (issue: string): CuratedFlag => ({ severity: "info", issue });

/** Per-unit corrections to the register, keyed by component ID. */
export const UNIT_OVERRIDES: Record<string, { condition?: "faulty"; note: string }> = {
  "ORINNX-01": {
    condition: "faulty",
    note: "Legacy app, 23 Jul 2026: reported overvoltaged and killed. Register (Sep 2025) still says functioning.",
  },
};

const DUP_100NF = info("Several 100nF/0.1uF 100V ceramic rows (259, 267, 294, 352): different packages or the same part? Kept separate.");

// Keys are xlsx ROW numbers, not the sheet's "No." column (which runs 3 behind
// from the first data row).
export const MAIN_ROW_OVERRIDES: Record<number, RowOverride> = {
  // Connectors
  44: { name: "Pin header pins, male (loose)" },
  45: { name: "Pin header, male, right-angle", unit: "sticks" },
  46: { name: "Pin header, female" },
  48: { name: "Female header pin", unit: "sticks" },

  // Components through hole
  50: { name: "Supercapacitor 2.7V 50F", notes: "Also listed in the capacitor-bank column (R95, same 9) -- counted once." },
  51: { name: "Electrolytic capacitor 10000uF 50V", flags: [check("Sheet says '10k μF': read as 10,000 uF (a real bulk-cap size); confirm.")] },
  52: { name: "Electrolytic capacitor 10uF 50V" },
  53: { name: "Electrolytic capacitor 10uF (50V or 450V)", flags: [check("Sheet gives two voltages ('50V 450V'); read the can.")] },
  54: { name: "Electrolytic capacitor 6.8uF 400V" },
  55: { name: "Electrolytic capacitor 6.8uF 450V" },
  56: { name: "Electrolytic capacitor 680uF 50V" },
  57: { name: "Electrolytic capacitor 10uF 400V" },
  60: { name: "Resistor 400 (unit unconfirmed), through-hole", flags: [check("No unit and 400 is not an E-series value (390Ω? 402Ω?); check the bin.")] },
  74: { name: "Film resistor 1kΩ (SMD)", flags: [info("Filed under through-hole but named SMD.")] },
  75: { name: "Film resistor 100kΩ (SMD)", flags: [info("Filed under through-hole but named SMD.")] },
  76: { name: "Load resistor 2Ω 50W" },
  77: { name: "Load resistor (large)", action: "hold", flags: [check("Unidentifiable ('Load resistor big') with no quantity or location.")] },
  78: { name: "Rotary potentiometer 5kΩ" },
  79: { name: "Trim potentiometer 5kΩ" },
  80: { name: "Rotary potentiometer 10kΩ" },
  81: { name: "Trim potentiometer 10kΩ" },
  82: { name: "Rotary potentiometer 50kΩ" },
  83: { name: "2N7000 N-channel MOSFET", flags: [info("Sheet calls it a BJT; the 2N7000 is a small-signal MOSFET.")] },
  84: { name: "MPS2222A NPN transistor" },
  85: { name: "IRF3205 N-channel MOSFET" },
  86: { name: "IRFZ44N N-channel MOSFET" },
  87: { name: "IRF9540N P-channel MOSFET" },
  88: { name: "IRFD9120 P-channel MOSFET" },
  89: { name: "IGBT 02N120" },
  90: { name: "LED, through-hole (assorted)" },
  91: { name: "LED, SMD (assorted)" },
  92: { name: "RGB LED" },
  95: { name: "555 timer IC" },
  96: { name: "SparkFun op-amp board", action: "hold", flags: [check("'Sparkfun opamp': which board? No quantity.")] },
  97: { name: "Voltage regulator 5V", flags: [info("Part unknown (7805?).")] },
  98: { name: "Cartridge fuse 5A" },
  99: { name: "Cartridge fuse 13A" },
  100: { name: "Cartridge fuse (rating unknown)", flags: [check("Fuse rating unknown: read the fuse body.")] },
  101: { name: "Blade fuse 5A" },
  102: { name: "Blade fuse 10A" },
  103: { name: "Blade fuse 7.5A" },
  105: { flags: [info("Value unknown (NTC 10k?).")] },
  113: { name: "Switch (type unknown)", flags: [info("Switch type unknown.")] },
  114: { name: "Relay 48V" },
  116: { name: "Solenoid" },
  117: { name: "Crocodile clip leads" },
  118: { name: "Hall effect sensor 49E (SOT-23)", category: CATEGORY.semis },
  119: { name: "Hall sensor PCB", category: CATEGORY.assemblies, criticality: "expendable" },
  120: { name: "Trim potentiometer (SMD)" },
  121: { name: "RB521S-30 Schottky diode (SMD)" },
  122: { name: "Op-amp TPH2501-TR (SMD)" },
  123: {
    name: "CUAV flight controller",
    criticality: "critical",
    flags: [check("Model unknown (V5+? X7?). Around S$300+ each, so tracked as critical.")],
  },
  124: { name: "AS5047 magnetic encoder board" },
  125: { flags: [check("L296 is a switching-regulator IC; if these are L298N motor-driver boards, rename.")] },
  126: { name: "Motor driver board (small)" },
  127: { name: "Stepper motor driver" },
  128: { name: "Buck converter module" },
  129: { name: "X hx0089b", action: "hold", flags: [check("Unidentifiable ('X hx0089b').")] },
  130: { flags: [info("Model unknown.")] },
  131: {
    name: "USB-PD trigger board (unconfirmed)",
    action: "hold",
    flags: [check("'Power delivery thingy': probably USB-PD trigger boards. Confirm and rename.")],
  },
  133: { name: "IR speed sensor" },
  134: { name: "3S BMS board" },
  137: { name: "5V BEC" },
  138: { name: "IMU module (model unknown)", flags: [check("Which IMU? Quantity is 0.")] },
  139: { name: "DIP-8 IC socket", category: CATEGORY.connectors, flags: [info("'8 pin dip header' read as DIP-8 IC sockets.")] },
  140: { name: "STM32 dev board", flags: [info("Probably Blue Pill (STM32F103); confirm.")] },
  142: { name: "Raspberry Pi (model unconfirmed)", flags: [check("Model unknown (3B+/4/5).")] },
  143: { name: "Perf board", criticality: "expendable" },
  144: { name: "DC barrel jack", category: CATEGORY.connectors },
  145: { name: "Hobby DC motor" },
  146: { name: "Stepper motor" },
  147: { name: "USB-to-TTL serial adapter" },
  149: { flags: [info("Model unknown.")] },
  150: { name: "ST-Link ribbon cable" },
  151: { name: "CSI camera cable" },
  153: { name: "NRF24L01 RF transceiver module" },

  // Assembled parts not in the registry
  204: { name: "Slip ring PCB (assorted)", criticality: "expendable" },
  205: { name: "Slip ring PCB, unsoldered (top)", criticality: "expendable" },
  206: { name: "Slip ring PCB, unsoldered (bottom)", criticality: "expendable" },
  207: { name: "Power & CAN splitter board" },
  208: { name: "Connection simplifier board" },
  209: { name: "Muse Lab USB logic analyser", category: CATEGORY.tools },
  210: { name: "3D-printer heatbed MOSFET switch (test rig)" },

  // Wires
  247: { name: "Dupont jumper wire F-F" },
  248: { name: "Dupont jumper wire M-M" },
  249: { name: "Dupont jumper wire M-F" },

  // SMD
  259: { flags: [DUP_100NF] },
  267: { flags: [DUP_100NF] },
  281: { name: "10nF 16V 0402 ceramic capacitor", flags: [info("Sheet says '10kpF' (= 10nF).")] },
  294: { flags: [DUP_100NF] },
  295: {
    mergeInto: 294,
    flags: [check("R294 and R295 are byte-identical (85 each). Counted once as 85; if they are two bags the true count is 170.")],
  },
  313: { name: "GT110N06 N-channel MOSFET (SMD)" },
  315: { name: "Current-sense amplifier (SMD)", flags: [info("Part number unknown.")] },
  328: { name: "N-channel MOSFET 60V 131A 2.2mΩ (PQFNWB-8L)", category: CATEGORY.semis },
  338: { name: "X pulse", action: "hold", flags: [check("Unidentifiable ('X pulse').")] },
  339: { name: "Current-sense shunt resistor 2mΩ (SMD)", flags: [info("'2mohm' read as 2 milliohm.")] },
  340: { flags: [check("448Ω is not a standard value (442Ω/453Ω E96?); check the reel label.")] },
  342: { name: "Capacitor 2.2uF 16V", category: CATEGORY.capacitors, flags: [check("Labelled 'Resistor' but carries a capacitance; assumed capacitor.")] },
  343: { name: "Capacitor 470pF 50V", category: CATEGORY.capacitors, flags: [check("Labelled 'Resistor' but carries a capacitance; assumed capacitor.")] },
  344: { name: "Capacitor 1.5uF 16V", category: CATEGORY.capacitors, flags: [check("Labelled 'Resistor' but carries a capacitance; assumed capacitor.")] },
  345: {
    mergeInto: 276,
    flags: [check("Same part as R276 (10 pcs) listed again with 9. Merged as 10; if they are two bags the true count is 19.")],
  },
  346: { name: "'402' (unidentified)", action: "hold", flags: [check("'402': package, part number or value? The legacy app guessed '0402 Resistor'. Check the bag.")] },
  347: { name: "'422' (unidentified)", action: "hold", flags: [check("'422': no such package; the legacy app guessed '0422 Resistor'. Check the bag.")] },
  348: {
    name: "Current-sense shunt resistor 3mΩ",
    flags: [check("'3m resistor' read as a 3 milliohm shunt (same family as the supercap controller's 2mΩ/4mΩ shunts), not 3 megohm.")],
  },
  349: {
    name: "Current-sense shunt resistor 4mΩ",
    flags: [check("'4m Resistor' read as a 4 milliohm shunt, not 4 megohm.")],
  },
  350: { name: "Resistor 1kΩ (package unknown)" },
  351: { name: "Capacitor 10nF (package unknown)" },
  352: { flags: [DUP_100NF] },
  353: { name: "Capacitor 10pF (package unknown)" },
  354: { name: "Resistor 68Ω (package unknown)" },

  // Resistor book: values the sheet got wrong, judged by position in the E24 sequence
  357: { bookValue: "1.1" },
  391: { bookValue: "30", flags: [check("Sheet says 31Ω between 27Ω and 33Ω; not an E24 value. Assumed 30Ω.")] },
  439: { bookValue: "3k", flags: [check("Sheet says 3Ω but sits between 2.7kΩ and 3.3kΩ (a real 3Ω row exists at R367). Assumed 3kΩ.")] },
  441: { bookValue: "3.6k", flags: [check("Sheet says 3.6Ω but sits between 3.3kΩ and 3.9kΩ (a real 3.6Ω row exists at R369). Assumed 3.6kΩ.")] },
  449: { bookValue: "7.5k", flags: [check("Sheet says 5.5kΩ between 6.8kΩ and 8.2kΩ; 5.5k is not E24. Assumed 7.5kΩ.")] },

  // Tools
  517: { name: "Wire stripper" },
  518: { name: "Crimper" },
  519: { name: "Wire cutters" },
  520: { name: "Pliers (large)" },
  521: { name: "Needle-nose pliers" },
  522: { name: "Desoldering pump" },
  523: { name: "Electrical tape", unit: "rolls" },
  524: { name: "Tweezers" },
  525: { name: "Scissors" },
  526: { name: "Soldering iron" },
  527: { name: "Solder wire", unit: "spools" },
  528: { name: "Hot-air rework station" },
  529: { name: "Reflow hot plate" },
  530: { name: "Soldering iron holder" },
  531: { name: "Solder fume extractor fan" },
  532: { name: "Hot glue gun" },
  533: { name: "Thermal tape", unit: "rolls" },
  534: { name: "Multimeter" },
  535: { name: "Helping hands" },
  536: { name: "Oscilloscope", criticality: "critical", flags: [info("Model unknown.")] },
  537: { name: "Soldering flux", unit: "tubs" },
  538: { name: "Kapton tape", unit: "rolls" },
};

/** Side table (columns I-N). Keyed by sheet row; independent of MAIN_ROW_OVERRIDES. */
export const SIDE_ROW_OVERRIDES: Record<number, RowOverride> = {
  3: { name: "JST 4-pin SMD connector" },
  4: { name: "LT1999HMS8-50 current-sense IC" },
  5: { name: "Inductor 10uH 2.5A 79.3mΩ (SMD)", flags: [info("'79.3Mohm' read as 79.3 milliohm DCR.")] },
  6: { name: "MMSD4148T3G diode 100V 200mA (SOD-123)" },
  7: { name: "AT25EU0021A-SSHN-T 2Mbit SPI flash (SOIC-8)" },
  8: { name: "Electrolytic capacitor 220uF 35V (SMD aluminium)" },
  10: { name: "Fuse 30A 125VAC/32VDC 0685H9300" },
  11: { name: "10uF 50V 1206 ceramic capacitor CL31A106MBHNNNE" },
  12: { name: "TVS diode 5.5V TPD1E10B06DPYR" },
  13: { name: "Linear regulator 3.3V 1A (SOT-223-3)" },
  14: { name: "STM32G431CBU6 board", flags: [info("Sheet says 'STM32431CBU6' (missing G).")] },
  15: { name: "NTC thermistor 10kΩ 0603 NCU18XH103J60RB" },
  16: { name: "Inductor 3.6uH 4.9A 19.5mΩ LSXNH8080YBL3R6NJG", flags: [info("'19.5Mohm' read as 19.5 milliohm DCR.")] },
  17: { name: "Current-sense resistor 4mΩ 2W 2512" },
  18: { name: "Tactile switch SPST 50mA 12V" },
  19: { name: "Ferrite bead 26Ω@100MHz 0603 BLM18KG260TN1D" },
  20: { name: "Crystal 48MHz ECS-480-8-33B2Q-JVY-TR3" },
  21: { name: "Molex 4-pin SMD connector plug 5023860470" },
  26: { name: "ATA6560-GAQW-N CAN transceiver IC" },
  95: { mergeInto: 50 },
};

// ---------------------------------------------------------------------------
// BOM lines: parts that are NEEDED for a build but not in stock. These go to
// the procurement list, never into products -- the legacy app invented a
// quantity of 100 for every one of them.
// ---------------------------------------------------------------------------

export const BOM_DESCRIPTIONS: Record<string, string> = {
  "CL10B104KC8NNNC": "Capacitor 100nF 100V X7R 0603 (Samsung)",
  "SM02B-GHS-TB(LF)(SN) (jst 2pin)": "JST-GH 2-pin SMD header",
  "TPD2E2U06DCKR": "ESD protection, 2-channel (TI)",
  "GRM21BZ71H475KE15L": "Capacitor 4.7uF 50V 0805 (Murata)",
  "RC0603FR-075K1L": "Resistor 5.1kΩ 1% 0603 (Yageo)",
  "ME6216A33XG": "LDO regulator 3.3V (Microne)",
  "KT-0603R": "LED red 0603",
  "CC0603KRX7R9BB105": "Capacitor 1uF 50V X7R 0603 (Yageo)",
  "BLM18AG102SN1D": "Ferrite bead 1kΩ@100MHz 0603 (Murata)",
  "REF2033AIDDCR": "Voltage reference 3.3V/1.65V (TI REF2033)",
  "RC0603FR-0730K1L": "Resistor 30.1kΩ 1% 0603 (Yageo)",
  "RC0603FR-0710K7L": "Resistor 10.7kΩ 1% 0603 (Yageo)",
  "SKRPACE010 (button)": "Tactile switch (Alps SKRPACE010)",
  "TAXM8M4RDBCCT2T": "Crystal 8MHz SMD (TXC)",
  "CL10C100JB8NNNC": "Capacitor 10pF 50V C0G 0603 (Samsung)",
  "KT-0805B": "LED blue 0805",
  "532610471 (4 pin jst)": "Molex PicoBlade 4-pin header 53261-0471",
  "STM32G431CBT6": "MCU STM32G431CBT6 (LQFP-48)",
  "LGS5148": "Buck converter IC (Legend-Si LGS5148)",
  "AC0603FR-0793K1L": "Resistor 93.1kΩ 1% 0603 (Yageo)",
  "AC0603FR-07665KL": "Resistor 665kΩ 1% 0603 (Yageo)",
  "GRM31CC72A475KE11L": "Capacitor 4.7uF 100V 1206 (Murata)",
  "VLS5045EX-220M (small inductor)": "Inductor 22uH (TDK VLS5045EX)",
  "PZ254V-11-02P (pin)": "Pin header 2-pin 2.54mm",
  "DSK110": "Schottky diode 1A 100V (DSK110)",
  "INA240A2DR": "Current-sense amplifier INA240A2 (TI)",
  "RC0603FR-071RL": "Resistor 1Ω 1% 0603 (Yageo)",
  "RC0603FR-07200RL": "Resistor 200Ω 1% 0603 (Yageo)",
  "CC0603JRNPO7BN221": "Capacitor 220pF 16V NP0 0603 (Yageo)",
  "LT8708EUHG#TRPBF": "Buck-boost controller LT8708 (ADI)",
  "AC0603JR-073R3L": "Resistor 3.3Ω 5% 0603 (Yageo)",
  "CL10B224KA8NNNC": "Capacitor 220nF 25V X7R 0603 (Samsung)",
  "RC0603FR-0717K4L": "Resistor 17.4kΩ 1% 0603 (Yageo)",
  "CC0603KRX7R9BB103": "Capacitor 10nF 50V X7R 0603 (Yageo)",
  "RC0603FR-0721KL": "Resistor 21kΩ 1% 0603 (Yageo)",
  "RT0603BRD07294KL": "Resistor 294kΩ 0.1% 0603 thin film (Yageo)",
  "GRM1885C1H472JA01D": "Capacitor 4.7nF 50V C0G 0603 (Murata)",
  "RT0603BRD0750KL": "Resistor 50kΩ 0.1% 0603 thin film (Yageo)",
  "XT30PW-M30.G.Y": "XT30 PCB connector, male, horizontal (Amass)",
  "XT30PW-F20.G.Y": "XT30 PCB connector, female, horizontal (Amass)",
  "FCSL64R002GER": "Current-sense shunt resistor 2mΩ (FCSL64)",
  "EEH-ZT1V271P (electro cap)": "Hybrid polymer electrolytic 270uF 35V (Panasonic)",
  "CKG57NX7R2A106MT009W": "Capacitor 10uF 100V X7R, stacked (TDK CKG57N)",
  "RC0603FR-0710RL": "Resistor 10Ω 1% 0603 (Yageo)",
  "CC0603KRX7R9BB474": "Capacitor 470nF 50V X7R 0603 (Yageo)",
  "CJAC13TH06": "Unidentified -- check the supercap controller BOM",
  "SER2918H-682KL (big inductor)": "Power inductor 6.8uH (Coilcraft SER2918H)",
  "2N7002DW-7-F": "Dual N-channel MOSFET 2N7002DW (SOT-363)",
  "RC0603FR-07100KL": "Resistor 100kΩ 1% 0603 (Yageo)",
  "0603WAF1373T5E": "Resistor 137kΩ 1% 0603 (UniOhm)",
  "RC0603FR-0756KL": "Resistor 56kΩ 1% 0603 (Yageo)",
  "RT0603BRD077K68L": "Resistor 7.68kΩ 0.1% 0603 thin film (Yageo)",
  "AP2045Q MOSFET": "MOSFET AP2045Q",
  "LN809C2641MR-G reset IC": "Voltage supervisor / reset IC (LN809)",
  "NCD0805R1 RED LED": "LED red 0805 (NCD0805R1)",
  "30kohm 0805W8F3002T5E": "Resistor 30kΩ 1% 0805 (UniOhm)",
  "100 ohm 0805W8F1000T5E": "Resistor 100Ω 1% 0805 (UniOhm)",
  "1ohm FRC2512J1R0TS": "Resistor 1Ω 5% 2512",
};

// ---------------------------------------------------------------------------
// Legacy app items
// ---------------------------------------------------------------------------

/** Legacy items renamed by the legacy app's own import, mapped back to their sheet row. */
export const LEGACY_TO_MAIN_ROW: Record<string, number> = {
  "5d64b58d-f610-4a7b-8ced-d069124de879": 346, // "0402 Resistor" <- "402"
  "aad11134-235c-40c6-98c9-515d1f214dc7": 347, // "0422 Resistor" <- "422"
};

/** Legacy items that are not real stock. */
export const LEGACY_DROP: Record<string, string> = {
  "f0caa8e3-1297-4169-aa57-6d58677acc1d": "The 'Tools' section header row, imported as an item with an invented quantity of 100.",
};

/** Items that only exist in the legacy app (added after its July import). */
export const LEGACY_ONLY: Record<string, { key: string; name: string; category: string; criticality: Criticality }> = {
  "0ff459da-5d08-4c8b-946e-77a119a3cc87": {
    key: "xt30-wire-male",
    name: "XT30 connector, male (solder to wire)",
    category: CATEGORY.connectors,
    criticality: "expendable",
  },
  "3240ecb8-a8d0-48a1-8c70-d6a7d7d35a92": {
    key: "xt30-wire-female",
    name: "XT30 connector, female (solder to wire)",
    category: CATEGORY.connectors,
    criticality: "expendable",
  },
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** Proposed roles. Everyone else starts as `member`; legacy admins are flagged for a decision. */
export const ROLE_PROPOSALS: Record<string, { role: "member" | "procurement" | "admin"; reason: string }> = {
  "minmyrios@gmail.com": { role: "admin", reason: "Developer maintaining the checkout system." },
};

/** A burst of this many borrows by one person inside the window is treated as a bulk/test entry, not personal loans. */
export const BULK_LOAN_MIN_ROWS = 8;
export const BULK_LOAN_WINDOW_MINUTES = 30;
