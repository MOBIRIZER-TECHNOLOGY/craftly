import { getDesignType } from "@/data/designTypes";

/** "Presentation (16:9)" -> "Presentation". */
export const shortName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, "").trim() || name;

/** Short, friendly name of a design's type for captions ("Instagram Post", "Custom size"). */
export function shortTypeName(typeId: string): string {
  const type = getDesignType(typeId);
  return type ? shortName(type.name) : "Custom size";
}

/** Full catalogue name of a design's type, or "Custom size". */
export function fullTypeName(typeId: string): string {
  return getDesignType(typeId)?.name ?? "Custom size";
}
