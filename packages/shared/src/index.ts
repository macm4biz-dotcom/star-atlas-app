export type FleetAsset = {
  id: string;
  name: string;
  class: "Ship" | "Crew" | "Resource" | "NFT";
  isStarAtlas?: boolean;
  quantity: number;
  estimatedValueUsd: number;
  dailyYieldUsd: number;
};

export type DashboardSnapshot = {
  handle: string;
  generatedAt: string;
  totalValueUsd: number;
  dailyProfitUsd: number;
  roiDays: number;
  assets: FleetAsset[];
};

export type HealthResponse = {
  status: "ok";
  service: string;
  time: string;
};
