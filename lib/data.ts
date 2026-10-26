// Sift demo dataset - fully synthetic small-business lending portfolio.
// Deterministic (seeded) so the app, the CSV exports and the bureau API all agree.

export interface Borrower {
  id: string; name: string; segment: "agri" | "retail" | "services" | "manufacturing";
  region: "North" | "South" | "East" | "West"; district: string; since: number;
}
export interface Loan {
  id: string; borrowerId: string; principal: number; ratePct: number;
  termMonths: number; startMonth: string; status: "active" | "closed" | "restructured";
}
export interface Payment {
  loanId: string; month: string; due: number; paid: number; paidOnTime: boolean;
}
export interface FieldNote {
  id: string; borrowerId: string; date: string; author: string; note: string;
}

// --- tiny seeded RNG (mulberry32) ---
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261022);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const DISTRICTS: Record<string, string[]> = {
  South: ["Belagavi", "Satara", "Sangli", "Kolhapur", "Dharwad"],
  North: ["Meerut", "Aligarh", "Bareilly"],
  East: ["Cuttack", "Asansol", "Siliguri"],
  West: ["Rajkot", "Surat", "Nashik"],
};
const AGRI_NAMES = ["Greenfield Agro", "Kaveri Farms", "Hillside Organics", "Monsoon Harvest Co", "Sugarcane Collective", "Riverdale Dairy", "Pomona Orchards", "Vasant Poultry", "Fieldstone Grains", "Turmeric Traders", "Cardamom Hills", "Areca Nut Co-op", "Jowar Works", "Sunflower Oilseeds", "Malnad Plantation"];
const RETAIL_NAMES = ["CornerMart Stores", "Bharat Bazaar", "Nova Electronics", "Saree Sadan", "DailyNeeds Kirana", "City Footwear", "Apollo Stationers", "Glow Cosmetics", "Furniture Bazaar", "Mobile Junction", "Sweet Mithai House", "BookNest", "Sports Arena Store", "TileStyle", "KitchenKraft"];
const SERVICES_NAMES = ["PixelBridge Studio", "QuickShift Logistics", "MetroPrint Services", "CarePoint Clinic", "EduSpark Tutorials", "UrbanWash Laundry", "FixIt Mobility", "CloudKitchen Nine", "TravelDesk Tours", "SecureGuard Services", "BrightEvent Planners", "AutoCare Garage", "PackAndGo Movers", "Beauty Lounge", "NetCafe Plus"];
const MFG_NAMES = ["Precision Auto Parts", "Shakti Textiles", "AquaPure Plastics", "SteelFab Industries", "Ceramica Tiles", "AgroEquip Works", "BrightLite Electricals", "PackWell Cartons", "FoamLine Mattresses", "CopperCraft Utensils", "VoltWinding Motors", "PrintPack Labels", "WoodCraft Panels", "SpiceGrind Foods", "GlassShine Works"];

export const MONTHS: string[] = [];
for (let y = 2025; y <= 2026; y++) {
  const start = y === 2025 ? 4 : 1, end = y === 2026 ? 9 : 12;
  for (let m = start; m <= end; m++) MONTHS.push(`${y}-${String(m).padStart(2, "0")}`);
}

function buildBorrowers(): Borrower[] {
  const out: Borrower[] = [];
  const pools: [Borrower["segment"], string[]][] = [
    ["agri", AGRI_NAMES], ["retail", RETAIL_NAMES], ["services", SERVICES_NAMES], ["manufacturing", MFG_NAMES],
  ];
  let n = 1;
  for (const [segment, names] of pools) {
    for (const name of names) {
      // South is deliberately agri-heavy: the story lives there
      const region: Borrower["region"] = segment === "agri"
        ? (rand() < 0.55 ? "South" : pick(["North", "East", "West", "South"] as const))
        : pick(["North", "South", "East", "West"] as const);
      out.push({
        id: `B-${String(n).padStart(3, "0")}`, name, segment, region,
        district: pick(DISTRICTS[region]), since: 2015 + Math.floor(rand() * 10),
      });
      n++;
    }
  }
  return out;
}

export const BORROWERS = buildBorrowers();

export const LOANS: Loan[] = BORROWERS.map((b, i) => ({
  id: `L-${String(i + 1).padStart(3, "0")}`,
  borrowerId: b.id,
  principal: 400000 + Math.floor(rand() * 40) * 50000,
  ratePct: 11 + Math.floor(rand() * 6),
  termMonths: pick([24, 36, 36, 48]),
  startMonth: pick(["2024-06", "2024-09", "2025-01", "2025-04"]),
  status: "active",
}));

// Story encoded in payments:
//  - Baseline: 92-96% on-time across the portfolio.
//  - Mar 2026: mild South dip (festival-season timing) - the "previous case" memory.
//  - Jul-Sep 2026: sharp on-time drop concentrated in South agri borrowers
//    (excess monsoon rainfall / flooding in Belagavi & Kolhapur districts).
//  - B-041 (manufacturing, West): chronic slow payer since early 2026 (true credit risk, contrast case).
export const PAYMENTS: Payment[] = [];
for (const loan of LOANS) {
  const b = BORROWERS.find((x) => x.id === loan.borrowerId)!;
  const emi = Math.round(loan.principal / loan.termMonths / 100) * 100;
  for (const month of MONTHS) {
    const [y, m] = month.split("-").map(Number);
    let pOnTime = 0.94;
    if (b.id === "B-041" && (y > 2025 || m >= 2)) pOnTime = 0.45; // chronic case
    else if (month >= "2026-07" && month <= "2026-09" && b.region === "South" && b.segment === "agri") pOnTime = month === "2026-08" ? 0.28 : 0.42;
    else if (month === "2026-03" && b.region === "South") pOnTime = 0.74;
    const onTime = rand() < pOnTime;
    PAYMENTS.push({
      loanId: loan.id, month, due: emi,
      paid: onTime ? emi : Math.round(emi * (0.35 + rand() * 0.4) / 100) * 100,
      paidOnTime: onTime,
    });
  }
}

export const FIELD_NOTES: FieldNote[] = [
  { id: "N-01", borrowerId: "B-003", date: "2026-07-21", author: "R. Desai (RM, South)", note: "Fields waterlogged after two weeks of heavy rain around Belagavi. Harvest pushed out at least three weeks. Asked about a short restructuring window." },
  { id: "N-02", borrowerId: "B-009", date: "2026-08-04", author: "R. Desai (RM, South)", note: "River breach near Kolhapur cut road access; produce sitting in godowns. Buyer payments delayed, so ours will be too." },
  { id: "N-03", borrowerId: "B-006", date: "2026-08-19", author: "S. Kulkarni (Collections)", note: "Called re: August EMI. Cane crop fine but transport rates doubled after flood damage on the Satara road. Expects to catch up by October." },
  { id: "N-04", borrowerId: "B-041", date: "2026-05-11", author: "A. Iyer (RM, West)", note: "Order book thinning; lost a tier-1 buyer in March. Owner mentioned working-capital stress. Watch closely." },
  { id: "N-05", borrowerId: "B-041", date: "2026-08-30", author: "A. Iyer (RM, West)", note: "Third partial payment in a row. No flood exposure here - this looks structural, not seasonal." },
  { id: "N-06", borrowerId: "B-022", date: "2026-03-09", author: "R. Desai (RM, South)", note: "Late because of festival-week staffing; paid in full the following week. No concern." },
  { id: "N-07", borrowerId: "B-014", date: "2026-09-02", author: "S. Kulkarni (Collections)", note: "Cardamom auction prices normal. Delay purely logistics after landslip clearance on the ghat road." },
  { id: "N-08", borrowerId: "B-033", date: "2026-09-12", author: "M. Rao (RM, East)", note: "Business as usual. Paid on time, asked about expanding the facility." },
];

// Bureau scores served by /api/bureau (and registered in Zetaris as a REST table).
// South agri borrowers keep healthy scores: cash-flow shock, not credit deterioration.
// B-041 deteriorates through 2026: genuine credit risk.
export function bureauScore(borrowerId: string, month: string): number {
  const b = BORROWERS.find((x) => x.id === borrowerId);
  if (!b) return 0;
  let base = 690 + ((borrowerId.charCodeAt(2) * 7 + borrowerId.charCodeAt(3)) % 60);
  if (borrowerId === "B-041") {
    const drift = month >= "2026-07" ? 105 : month >= "2026-04" ? 70 : 25;
    return base - drift;
  }
  return base + (month >= "2026-07" && b.region === "South" && b.segment === "agri" ? -8 : 0);
}

// CSV exports (used to load Zetaris file sources)
function toCsv(rows: Record<string, unknown>[]): string {
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
export const CSV = {
  borrowers: () => toCsv(BORROWERS as unknown as Record<string, unknown>[]),
  loans: () => toCsv(LOANS as unknown as Record<string, unknown>[]),
  payments: () => toCsv(PAYMENTS as unknown as Record<string, unknown>[]),
  field_notes: () => toCsv(FIELD_NOTES as unknown as Record<string, unknown>[]),
};
