import { parseUnits } from "viem";

/**
 * Render-safe wrapper around viem's parseUnits. Plain <input> values can be
 * anything ("abc", "1e3", …) and parseUnits throws on those — fine inside a
 * click handler, fatal when the parse runs during render. Returns undefined
 * for empty or unparsable input so callers can treat it as "no valid amount":
 * skip a render-time computation, or toast and bail out of a submit handler.
 */
export function tryParseUnits(value: string, decimals: number): bigint | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return undefined;
  }
}

// Real-world units a listing's unit price can be denominated in — commodity
// weight/volume/area units alongside the simple "per item" default, since a
// marketplace listing might be pricing anything from a single service to a
// bulk shipment of goods.
export const UNIT_OPTIONS = [
  { value: "unit", label: "Unit / Piece" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "ton", label: "Metric Ton (t)" },
  { value: "g", label: "Gram (g)" },
  { value: "lb", label: "Pound (lb)" },
  { value: "l", label: "Liter (L)" },
  { value: "m2", label: "Square Meter (m²)" },
  { value: "m3", label: "Cubic Meter (m³)" },
  { value: "hectare", label: "Hectare (ha)" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
] as const;

export type UnitValue = (typeof UNIT_OPTIONS)[number]["value"];

export function unitLabel(value: string | undefined): string {
  return UNIT_OPTIONS.find((u) => u.value === value)?.label ?? value ?? "";
}

// Short, plain-words names for reading a price aloud ("12.5 MOCK / sq meter"),
// as opposed to UNIT_OPTIONS' dropdown labels, which carry symbols and are too
// long for a price line. Unknown values fall back to the raw value.
const UNIT_SHORT_LABELS: Record<UnitValue, string> = {
  unit: "unit",
  kg: "kg",
  ton: "metric ton",
  g: "gram",
  lb: "lb",
  l: "liter",
  m2: "sq meter",
  m3: "cu meter",
  hectare: "hectare",
  hour: "hour",
  day: "day",
};

export function unitShortLabel(value: string | undefined): string {
  if (!value) return "";
  return UNIT_SHORT_LABELS[value as UnitValue] ?? value;
}

/** "12.5 MOCK / sq meter" — or just "12.5 MOCK" when the listing's unit isn't known (off-chain metadata missing). */
export function formatPerUnit(amount: string, unit: string | undefined): string {
  const label = unitShortLabel(unit);
  return label ? `${amount} / ${label}` : amount;
}
