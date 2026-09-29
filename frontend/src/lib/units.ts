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
