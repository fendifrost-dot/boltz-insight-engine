/**
 * PROPOSAL SKETCH — Square line-item classifier.
 *
 * Not imported by cron, jobs, or sendOutbound. Conservative: when unsure,
 * return needs_review so a human sees the row instead of a silent drop.
 *
 * Vehicle and service can appear in either the item name or the note.
 */

export const V1_REMINDER_KINDS = ["oil", "brakes", "battery", "trans_fluid"] as const;
export type V1ReminderKind = (typeof V1_REMINDER_KINDS)[number];

export type ParseStatus = "classified" | "excluded" | "needs_review";

export type ClassifiedSquareLine = {
  parseStatus: ParseStatus;
  reminderKinds: V1ReminderKind[];
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleKey: string;
  excludeReason: string | null;
  needsReviewReason: string | null;
};

const MAKE_ALIASES: Record<string, string> = {
  chevy: "Chevrolet",
  chevrolet: "Chevrolet",
  chrysler: "Chrysler",
  dodge: "Dodge",
  jeep: "Jeep",
  ram: "Ram",
  ford: "Ford",
  lincoln: "Lincoln",
  gmc: "GMC",
  buick: "Buick",
  cadillac: "Cadillac",
  toyota: "Toyota",
  honda: "Honda",
  nissan: "Nissan",
  hyundai: "Hyundai",
  kia: "Kia",
  mazda: "Mazda",
  subaru: "Subaru",
  volkswagen: "Volkswagen",
  vw: "Volkswagen",
  audi: "Audi",
  bmw: "BMW",
  mercedes: "Mercedes-Benz",
  benz: "Mercedes-Benz",
  lexus: "Lexus",
  acura: "Acura",
  infiniti: "Infiniti",
  volvo: "Volvo",
  porsche: "Porsche",
};

const OIL = /\b(oil\s*change|oil\s*&\s*filter|oil\/filter|synthetic oil|conventional oil|\boil\b)/i;
const BRAKES = /\b(brake\s*pads?|rotors?|brake\s*job|brake\s*inspect(?:ion)?|pads?\s*&\s*rotors?)\b/i;
const BATTERY = /\b(batter(?:y|ies)|battery\s*test|battery\s*replace)\b/i;
const TRANS_FLUID = /\b(trans(?:mission)?\s*fluid|trans\s*flush|atf\b|transmission\s*service)\b/i;

const EXCLUDE_PAYMENT = /\b(custom amount|balance|deposit|deductible)\b/i;
const EXCLUDE_DIAGNOSTIC = /\bdiagnostic\b/i;
const EXCLUDE_BODY = /\b(collision|body\s*work|body\s*shop|paint(?:ing)?|insurance\s*claim|insurance)\b/i;
const EXCLUDE_FLEET = /\b(fleet|commercial account)\b/i;

const YEAR = /\b(19[8-9]\d|20[0-2]\d)\b/;

function blob(itemName: string, note: string): string {
  return `${itemName} ${note}`.replace(/\s+/g, " ").trim();
}

function extractVehicle(text: string): {
  year: number | null;
  make: string | null;
  model: string | null;
} {
  const yearMatch = text.match(YEAR);
  if (!yearMatch) return { year: null, make: null, model: null };
  const year = Number(yearMatch[1]);
  const after = text.slice(yearMatch.index! + yearMatch[0].length);
  const words = after.trim().split(/[\s,/]+/).filter(Boolean);
  if (words.length === 0) return { year, make: null, model: null };

  const makeRaw = words[0]!.toLowerCase().replace(/[^a-z]/g, "");
  const make = MAKE_ALIASES[makeRaw] ?? null;
  if (!make) return { year, make: null, model: null };

  const modelParts: string[] = [];
  for (const word of words.slice(1, 4)) {
    if (/^(lt|ls|ex|lx|se|le|xl|sxt)$/i.test(word)) {
      if (modelParts.length > 0) modelParts.push(word.toUpperCase());
      break;
    }
    if (/^[a-z0-9-]+$/i.test(word)) modelParts.push(word);
    else break;
  }
  const model = modelParts.length > 0 ? modelParts.join(" ") : null;
  return { year, make, model };
}

function vehicleKey(year: number | null, make: string | null, model: string | null): string {
  if (!year && !make && !model) return "unknown";
  return [year ?? "", (make ?? "").toLowerCase(), (model ?? "").toLowerCase()].join("|");
}

function reminderKindsIn(text: string): V1ReminderKind[] {
  const kinds: V1ReminderKind[] = [];
  if (OIL.test(text)) kinds.push("oil");
  if (BRAKES.test(text)) kinds.push("brakes");
  if (BATTERY.test(text)) kinds.push("battery");
  if (TRANS_FLUID.test(text)) kinds.push("trans_fluid");
  return kinds;
}

/**
 * Classify one Square line. Item name and note are searched together because
 * the shop’s real invoices swap vehicle and service between those two fields.
 */
export function classifySquareLine(itemName: string, note: string): ClassifiedSquareLine {
  const text = blob(itemName, note);
  const vehicle = extractVehicle(text);
  const kinds = reminderKindsIn(text);
  const genericOnly = EXCLUDE_PAYMENT.test(text) && kinds.length === 0 && !YEAR.test(text);
  const diagnosticOnly = EXCLUDE_DIAGNOSTIC.test(text) && kinds.length === 0;
  const bodyHit = EXCLUDE_BODY.test(text);
  const fleetHit = EXCLUDE_FLEET.test(text);

  if (bodyHit) {
    return {
      parseStatus: kinds.length > 0 ? "needs_review" : "excluded",
      reminderKinds: kinds,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleKey: vehicleKey(vehicle.year, vehicle.make, vehicle.model),
      excludeReason: kinds.length > 0 ? null : "body_collision_paint_or_insurance",
      needsReviewReason: kinds.length > 0 ? "mechanical_line_on_body_or_insurance_invoice" : null,
    };
  }

  if (fleetHit) {
    return {
      parseStatus: "excluded",
      reminderKinds: [],
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleKey: vehicleKey(vehicle.year, vehicle.make, vehicle.model),
      excludeReason: "fleet_or_commercial",
      needsReviewReason: null,
    };
  }

  if (genericOnly || diagnosticOnly) {
    return {
      parseStatus: "excluded",
      reminderKinds: [],
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleKey: vehicleKey(vehicle.year, vehicle.make, vehicle.model),
      excludeReason: diagnosticOnly ? "diagnostic_only" : "deposit_balance_or_custom_amount",
      needsReviewReason: null,
    };
  }

  if (kinds.length === 0) {
    return {
      parseStatus: "needs_review",
      reminderKinds: [],
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleKey: vehicleKey(vehicle.year, vehicle.make, vehicle.model),
      excludeReason: null,
      needsReviewReason: "no_v1_service_keyword",
    };
  }

  return {
    parseStatus: "classified",
    reminderKinds: kinds,
    vehicleYear: vehicle.year,
    vehicleMake: vehicle.make,
    vehicleModel: vehicle.model,
    vehicleKey: vehicleKey(vehicle.year, vehicle.make, vehicle.model),
    excludeReason: null,
    needsReviewReason: null,
  };
}
