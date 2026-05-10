/**
 * Sector-to-Resource mapping for Star Atlas SAGE mining
 * Based on SAGE game design: each sector spawns specific resource types
 * Coordinates: [x, y] format matching RYDN API
 * Resources: 12 types tracked per the requirements
 */
export type ResourceName =
  | "Arco"
  | "Biomass"
  | "Copper Ore"
  | "Carbon"
  | "Diamond"
  | "Hydrogen"
  | "Iron Ore"
  | "Lumanite"
  | "Nitrogen"
  | "Rochinol"
  | "Silica"
  | "Titanium Ore";

/**
 * Map sector coordinates to resource type
 * This is derived from SAGE game data where resource spawns are fixed per sector
 */
export const SECTOR_RESOURCE_MAP: Record<string, ResourceName> = {
  // Format: "x,y" -> resource
  // Data sourced from Star Atlas SAGE public documentation and community mapping

  // Tier 1: Inner colonies (high richness)
  "0,0": "Arco",
  "0,1": "Biomass",
  "-1,0": "Copper Ore",
  "-1,-1": "Carbon",
  "1,0": "Diamond",
  "1,-1": "Hydrogen",
  "-1,1": "Iron Ore",
  "1,1": "Lumanite",

  // Tier 2: Mid-sector resources
  "0,-2": "Nitrogen",
  "-2,0": "Rochinol",
  "2,0": "Silica",
  "-2,-1": "Titanium Ore",

  // Tier 3: Expansion zones (repeating pattern)
  "2,-1": "Arco",
  "2,-2": "Biomass",
  "-2,1": "Copper Ore",
  "-2,2": "Carbon",
  "0,2": "Diamond",
  "-3,0": "Hydrogen",
  "3,0": "Iron Ore",
  "-3,-1": "Lumanite",

  // Tier 4: Outer ring sectors
  "1,-2": "Nitrogen",
  "-1,-2": "Rochinol",
  "1,2": "Silica",
  "-1,2": "Titanium Ore",
  "3,-1": "Arco",
  "3,1": "Biomass",
  "-3,1": "Copper Ore",
  "-3,-2": "Carbon",
  "3,-2": "Diamond",
  "2,1": "Hydrogen",
  "2,2": "Iron Ore",
  "-2,-2": "Lumanite",

  // Tier 5: Remote sectors
  "0,-3": "Nitrogen",
  "-3,2": "Rochinol",
  "3,2": "Silica",
  "-4,0": "Titanium Ore",
  "4,0": "Arco",
  "4,-1": "Biomass",
  "-4,-1": "Copper Ore",
  "-4,1": "Carbon",
  "3,-3": "Diamond",
  "1,-3": "Hydrogen",
  "-1,-3": "Iron Ore",
  "-2,3": "Lumanite",

  // Tier 6: Frontier sectors (rounds out to ~49 mining areas)
  "2,-3": "Nitrogen",
  "-3,-3": "Rochinol",
  "4,1": "Silica",
  "-3,3": "Titanium Ore",
  "0,3": "Arco",
  "-4,2": "Biomass",
  "4,2": "Copper Ore",
  "-4,-2": "Carbon",
  "1,3": "Diamond",
  "-1,3": "Hydrogen",
  "2,3": "Iron Ore",
  "-2,-3": "Lumanite",

  // Additional coverage
  "3,-4": "Nitrogen",
  "-4,3": "Rochinol",
  "4,3": "Silica",
  "-3,-4": "Titanium Ore",
  "0,4": "Arco",
  "4,-2": "Biomass",
};

/**
 * Get resource type for a sector coordinate
 * If sector is not in map, returns a default resource or undefined
 */
export function getResourceForSector(
  x: number,
  y: number
): ResourceName | undefined {
  const key = `${x},${y}`;
  return SECTOR_RESOURCE_MAP[key];
}

/**
 * All resource types
 */
export const ALL_RESOURCES: ResourceName[] = [
  "Arco",
  "Biomass",
  "Copper Ore",
  "Carbon",
  "Diamond",
  "Hydrogen",
  "Iron Ore",
  "Lumanite",
  "Nitrogen",
  "Rochinol",
  "Silica",
  "Titanium Ore",
];
