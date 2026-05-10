import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import type {
  DashboardSnapshot,
  FleetAsset,
  HealthResponse,
} from "@star-atlas/shared";
import { SECTOR_RESOURCE_MAP, getResourceForSector, ALL_RESOURCES } from "./sector-resource-map.js";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../../../.env"),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
    break;
  }
}

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT || process.env.API_PORT || 4100);
const HOST = process.env.HOST || process.env.API_HOST || "0.0.0.0";
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const PLATFORM_FEE_WALLET =
  process.env.PLATFORM_FEE_WALLET || "7BNFxaeXA2DPLRnYeRLEMqA5gAWgMGdG3tcJBFrbzH5v";
const PLATFORM_FEE_BPS = 100; // 1% = 100 basis points
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function safeProgramPublicKey(value: string, fallbackBytes: number[], label: string) {
  try {
    return new PublicKey(value.trim());
  } catch {
    app.log.warn(
      { label },
      "Invalid public key input for program id, using byte fallback",
    );
    return new PublicKey(Uint8Array.from(fallbackBytes));
  }
}

const SPL_TOKEN_PROGRAM = safeProgramPublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169],
  "SPL_TOKEN_PROGRAM",
);
const ATA_PROGRAM = safeProgramPublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89],
  "ATA_PROGRAM",
);
const SYSTEM_PROGRAM = safeProgramPublicKey(
  "11111111111111111111111111111111",
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "SYSTEM_PROGRAM",
);
const SYSVAR_RENT_PROGRAM = safeProgramPublicKey(
  "SysvarRent111111111111111111111111111111111",
  [6, 167, 213, 23, 25, 44, 92, 81, 33, 140, 201, 76, 61, 74, 241, 127, 88, 218, 238, 8, 155, 161, 253, 68, 227, 219, 217, 138, 0, 0, 0, 0],
  "SYSVAR_RENT_PROGRAM",
);

function parseEscrowSecretKey(secret?: string) {
  if (!secret) return null;
  const normalized = secret.trim();
  if (!normalized) return null;

  try {
    if (normalized.startsWith("[")) {
      const parsed = JSON.parse(normalized) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length > 0) {
      return Keypair.fromSecretKey(Uint8Array.from(decoded));
    }
  } catch {
    return null;
  }

  return null;
}

const MARKET_ESCROW_KEYPAIR = parseEscrowSecretKey(process.env.MARKET_ESCROW_SECRET_KEY);
const MARKET_ESCROW_WALLET =
  MARKET_ESCROW_KEYPAIR?.publicKey.toBase58() ||
  process.env.MARKET_ESCROW_WALLET ||
  "YQmg9nTsvVLUgtj35pY8WUPRVGHaz7KfmaCgPuS6bwY";

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

function splTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint,
) {
  const amountBytes: number[] = [];
  let n = amount;
  for (let i = 0; i < 8; i++) {
    amountBytes.push(Number(n & 0xffn));
    n >>= 8n;
  }

  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: SPL_TOKEN_PROGRAM,
    data: Buffer.from([3, ...amountBytes]),
  });
}

function createAtaIdempotentInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PROGRAM, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
  });
}
const API_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT_DIR = resolve(API_SRC_DIR, "..");

const DEFAULT_STAR_ATLAS_COLLECTIONS = [
  "staratlas",
  "star atlas",
  "star atlas ships",
  "star atlas posters",
  "star atlas crew",
  "sage labs",
  "sage",
  "fimbul airbike",
  "opal jet",
  "calico guardian",
  "xx-small cargo",
  "c4",
  "mud",
  "oni",
  "pearce",
  "vzus",
  "jogoor",
];

const DEFAULT_STAR_ATLAS_COLLECTION_KEYWORDS = [
  "star atlas",
  "staratlas",
  "sage",
  "fimbul",
  "opal",
  "calico",
  "xx-small cargo",
  "pearce",
  "vzus",
  "jogoor",
  "oni",
  "c4",
  "mud",
];

function parseCommaSeparatedList(value: string | undefined, fallback: string[]) {
  const source = value || fallback.join(",");
  return Array.from(
    new Set(
      source
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseWalletAllowlist(value: string | undefined, fallback: string[]) {
  const source = value || fallback.join(",");
  return Array.from(
    new Set(
      source
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

let starAtlasCollections = parseCommaSeparatedList(
  process.env.STAR_ATLAS_COLLECTIONS,
  DEFAULT_STAR_ATLAS_COLLECTIONS,
);
let starAtlasCollectionKeywords = parseCommaSeparatedList(
  process.env.STAR_ATLAS_COLLECTION_KEYWORDS,
  DEFAULT_STAR_ATLAS_COLLECTION_KEYWORDS,
);
let marketSettingsUpdatedAt = new Date().toISOString();

function isStarAtlasCollection(collectionFields: string[]) {
  return collectionFields.some(
    (value) =>
      starAtlasCollections.includes(value) ||
      starAtlasCollectionKeywords.some((keyword) => value.includes(keyword)),
  );
}

const KNOWN_TOKEN_BY_MINT: Record<
  string,
  {
    name: string;
    coingeckoId?: string;
    isStarAtlas?: boolean;
  }
> = {
  So11111111111111111111111111111111111111112: {
    name: "Solana",
    coingeckoId: "solana",
  },
  ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx: {
    name: "Star Atlas (ATLAS)",
    coingeckoId: "star-atlas",
    isStarAtlas: true,
  },
  poLisWXnNRwC6oB1vHiuKQzFjGL4XDSu4g9qjz9qVk: {
    name: "Star Atlas DAO (POLIS)",
    coingeckoId: "star-atlas-dao",
    isStarAtlas: true,
  },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    name: "USDC",
    coingeckoId: "usd-coin",
  },
};

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

const BASE_ASSETS: FleetAsset[] = [
  {
    id: "ship-fimbul",
    name: "Fimbul Airbike",
    class: "Ship",
    quantity: 2,
    estimatedValueUsd: 620,
    dailyYieldUsd: 14,
  },
  {
    id: "ship-cargo",
    name: "Cargo Runner",
    class: "Ship",
    quantity: 1,
    estimatedValueUsd: 920,
    dailyYieldUsd: 22,
  },
  {
    id: "crew-op",
    name: "Crew Operators",
    class: "Crew",
    quantity: 8,
    estimatedValueUsd: 160,
    dailyYieldUsd: 6,
  },
  {
    id: "resource-fuel",
    name: "Fuel & Supplies",
    class: "Resource",
    quantity: 320,
    estimatedValueUsd: 275,
    dailyYieldUsd: 4,
  },
];

type MarketAssetClass = FleetAsset["class"];
type ListingStatus = "active" | "sold" | "cancelled";
type BarterStatus = "open" | "accepted" | "declined";

type MarketListing = {
  id: string;
  itemName: string;
  itemClass: MarketAssetClass;
  quantity: number;
  priceUsd: number;
  paymentToken: "USDC" | "ATLAS" | "SOL";
  sellerWallet: string;
  buyerWallet?: string;
  status: ListingStatus;
  note?: string;
  mint?: string;
  image?: string;
  txSignature?: string;
  escrowTxSignature?: string;
  escrowWallet?: string;
  escrowedAt?: string;
  settlementTxSignature?: string;
  settledAt?: string;
  settlementError?: string;
  createdAt: string;
};

type BarterOffer = {
  id: string;
  fromWallet: string;
  responderWallet?: string;
  offerItem: string;
  wantItem: string;
  extraUsd: number;
  note?: string;
  status: BarterStatus;
  createdAt: string;
};

type IntelSourceKey = "official" | "medium" | "x" | "discord";

type IntelSourceStatus = {
  key: IntelSourceKey;
  url: string;
  ok: boolean;
  statusCode?: number;
  note: string;
};

type IntelItem = {
  source: IntelSourceKey;
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
};

type IntelOverview = {
  generatedAt: string;
  windowHours: number;
  sources: IntelSourceStatus[];
  sourceStats24h: Record<IntelSourceKey, number>;
  highlights: string[];
  conclusions: string[];
  items: IntelItem[];
};

type NewsArchiveEntryType = "genesis" | "weekly";

type NewsArchiveEntry = {
  id: string;
  type: NewsArchiveEntryType;
  title: string;
  summary: string;
  content: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  sourceStats: Record<IntelSourceKey, number>;
  totalSignals: number;
  tags: string[];
};

type NewsArchiveResponse = {
  generatedAt: string;
  entries: NewsArchiveEntry[];
};

type BridgeRole =
  | "Fleet Admiral"
  | "Admiral"
  | "Captain"
  | "Chief Specialist"
  | "Logistics Officer"
  | "Data Analyst"
  | "Market Trader"
  | "Threat Scout"
  | "Ensign"
  | "Allied Observer";

type BridgeAlertLevel = "critical" | "high" | "normal" | "info";
type BridgeRiskTolerance = "low" | "medium" | "high";
type BridgeOperationType =
  | "fleet-dispatch"
  | "logistics-route"
  | "recon"
  | "market-order"
  | "repair";
type BridgeC4Profile = "pre-c4" | "c4-transition" | "c4-live";

type BridgeRoleCapabilities = {
  canApproveCritical: boolean;
  canRunOperations: boolean;
  visiblePresets: Array<"Tactical" | "Logistics" | "Economy" | "Threat" | "Command">;
  notifications: BridgeAlertLevel[];
};

type BridgeProfileRules = {
  label: string;
  description: string;
  volatilityMultiplier: number;
  etaMultiplier: number;
  returnPotentialMultiplier: number;
  fleetCapacityPolicy: string;
};

type BridgeAlert = {
  id: string;
  level: BridgeAlertLevel;
  domain: "combat" | "economy" | "logistics" | "system";
  title: string;
  details: string;
  createdAt: string;
  targetRoles: BridgeRole[];
  acknowledgedBy: Array<{
    role: BridgeRole;
    actorWallet?: string;
    time: string;
  }>;
};

type BridgeAuditEvent = {
  id: string;
  eventType: "preflight-run" | "alert-ack";
  role: BridgeRole;
  profile?: BridgeC4Profile;
  actorWallet?: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type BridgeMapPoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  strength?: number;
  updatedAt?: string;
};

type BridgeMapRoute = {
  id: string;
  points: string;
  etaMinutes?: number;
  updatedAt?: string;
};

type BridgeMapRiskZone = {
  id: string;
  x: number;
  y: number;
  r: number;
  severity: "critical" | "high" | "normal";
  updatedAt?: string;
};

type BridgeFaction = "MUD" | "ONI" | "USTUR";

type BridgeConnectedWalletMetrics = {
  totalConnectedWallets: number;
  byFaction: Record<BridgeFaction, number>;
};

type BridgeSagePlayersMetric = {
  online: number | null;
  source: "upstream" | "estimated" | "unavailable";
  updatedAt: string;
};

type BridgeSageActiveProfilesMetric = {
  activeProfiles: number | null;
  source: "upstream" | "estimated" | "unavailable";
  updatedAt: string;
};

type BridgeLiveMap = {
  generatedAt: string;
  source: "upstream" | "data-intel" | "synthetic";
  role: BridgeRole;
  profile: BridgeC4Profile;
  mapImageUrl: string;
  refreshMs: number;
  activityScore: number;
  fleets: BridgeMapPoint[];
  enemies: BridgeMapPoint[];
  resources: BridgeMapPoint[];
  routes: BridgeMapRoute[];
  riskZones: BridgeMapRiskZone[];
  connectedWalletMetrics: BridgeConnectedWalletMetrics;
  sagePlayersMetric: BridgeSagePlayersMetric;
  sageActiveProfilesMetric: BridgeSageActiveProfilesMetric;
};

type BridgeAccessEntry = {
  wallet: string;
  grantedAt: string;
  grantedBy: string;
};

type WalletAuthUser = {
  id: string;
  wallet: string;
  registeredAt: string;
  verifiedAt: string;
  lastLoginAt: string;
  loginCount: number;
};

type WalletAuthChallenge = {
  challengeId: string;
  wallet: string;
  nonce: string;
  message: string;
  createdAt: string;
  expiresAt: string;
};

type WalletAuthSession = {
  token: string;
  wallet: string;
  createdAt: string;
  expiresAt: string;
};

const BRIDGE_DEFAULT_ROLE: BridgeRole = "Captain";
const BRIDGE_DEFAULT_PROFILE: BridgeC4Profile = "c4-transition";
const BRIDGE_MAP_IMAGE_URL =
  process.env.BRIDGE_MAP_IMAGE_URL || "https://cdn.staratlas.com/sage-labs/map-hires-dark.jpg";
const BRIDGE_LIVE_MAP_UPSTREAM_URL = (process.env.BRIDGE_LIVE_MAP_UPSTREAM_URL || "").trim();
const BRIDGE_DATA_INTEL_BASE_URL =
  (process.env.BRIDGE_DATA_INTEL_BASE_URL || "https://data-intel-prod.uc.r.appspot.com").trim();
const BRIDGE_SAGE_PLAYERS_UPSTREAM_URL =
  (process.env.BRIDGE_SAGE_PLAYERS_UPSTREAM_URL || "").trim();
const BRIDGE_SAGE_ACTIVE_PROFILES_UPSTREAM_URL =
  (process.env.BRIDGE_SAGE_ACTIVE_PROFILES_UPSTREAM_URL || "").trim();
const BRIDGE_LIVE_MAP_TIMEOUT_MS = parseDurationMs(
  process.env.BRIDGE_LIVE_MAP_TIMEOUT_MS,
  7_500,
);
const BRIDGE_PROFILES: Record<BridgeC4Profile, BridgeProfileRules> = {
  "pre-c4": {
    label: "Pre-C4 Baseline",
    description: "Стабильный режим до обновления C4, ниже рыночная турбулентность.",
    volatilityMultiplier: 1,
    etaMultiplier: 1,
    returnPotentialMultiplier: 1,
    fleetCapacityPolicy: "legacy-capacity",
  },
  "c4-transition": {
    label: "C4 Transition",
    description: "Переходный режим: меняются правила флотов и экономики, повышенная неопределенность.",
    volatilityMultiplier: 1.18,
    etaMultiplier: 1.1,
    returnPotentialMultiplier: 1.08,
    fleetCapacityPolicy: "perk-sensitive",
  },
  "c4-live": {
    label: "C4 Live",
    description: "Актуальный C4-режим: перки и прокачка влияют на лимиты и эффективность.",
    volatilityMultiplier: 1.32,
    etaMultiplier: 1.16,
    returnPotentialMultiplier: 1.14,
    fleetCapacityPolicy: "perk-gated",
  },
};

const BRIDGE_ROLE_CAPABILITIES: Record<BridgeRole, BridgeRoleCapabilities> = {
  "Fleet Admiral": {
    canApproveCritical: true,
    canRunOperations: true,
    visiblePresets: ["Tactical", "Logistics", "Economy", "Threat", "Command"],
    notifications: ["critical", "high", "normal", "info"],
  },
  Admiral: {
    canApproveCritical: true,
    canRunOperations: true,
    visiblePresets: ["Tactical", "Logistics", "Economy", "Threat", "Command"],
    notifications: ["critical", "high", "normal", "info"],
  },
  Captain: {
    canApproveCritical: true,
    canRunOperations: true,
    visiblePresets: ["Tactical", "Logistics", "Economy", "Command"],
    notifications: ["critical", "high", "normal"],
  },
  "Chief Specialist": {
    canApproveCritical: false,
    canRunOperations: true,
    visiblePresets: ["Logistics", "Economy", "Command"],
    notifications: ["high", "normal", "info"],
  },
  "Logistics Officer": {
    canApproveCritical: false,
    canRunOperations: true,
    visiblePresets: ["Logistics", "Command"],
    notifications: ["high", "normal"],
  },
  "Data Analyst": {
    canApproveCritical: false,
    canRunOperations: false,
    visiblePresets: ["Economy", "Command"],
    notifications: ["normal", "info"],
  },
  "Market Trader": {
    canApproveCritical: false,
    canRunOperations: true,
    visiblePresets: ["Economy", "Command"],
    notifications: ["high", "normal", "info"],
  },
  "Threat Scout": {
    canApproveCritical: false,
    canRunOperations: true,
    visiblePresets: ["Tactical", "Threat", "Command"],
    notifications: ["critical", "high", "normal"],
  },
  Ensign: {
    canApproveCritical: false,
    canRunOperations: false,
    visiblePresets: ["Command"],
    notifications: ["normal", "info"],
  },
  "Allied Observer": {
    canApproveCritical: false,
    canRunOperations: false,
    visiblePresets: ["Command"],
    notifications: ["info"],
  },
};

const bridgeAlertsStore: BridgeAlert[] = [
  {
    id: "alt-bridge-1001",
    level: "critical",
    domain: "system",
    title: "RPC latency spike",
    details: "Задержка Solana RPC превышает 2.2с, используйте fallback endpoint.",
    createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    targetRoles: ["Fleet Admiral", "Admiral", "Captain", "Threat Scout"],
    acknowledgedBy: [],
  },
  {
    id: "alt-bridge-1002",
    level: "high",
    domain: "economy",
    title: "ATLAS volatility increased",
    details: "В переходном C4-профиле волатильность выше baseline, пересчитайте pre-flight.",
    createdAt: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
    targetRoles: ["Fleet Admiral", "Admiral", "Captain", "Market Trader", "Data Analyst"],
    acknowledgedBy: [],
  },
  {
    id: "alt-bridge-1003",
    level: "normal",
    domain: "logistics",
    title: "Route 7 completed",
    details: "Логистический рейс завершен без потерь. Обновите burn rate и ETA модель.",
    createdAt: new Date(Date.now() - 82 * 60 * 1000).toISOString(),
    targetRoles: ["Captain", "Chief Specialist", "Logistics Officer"],
    acknowledgedBy: [],
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveBridgeRole(input: string | undefined): BridgeRole {
  if (!input) {
    return BRIDGE_DEFAULT_ROLE;
  }

  const role = Object.keys(BRIDGE_ROLE_CAPABILITIES).find(
    (item) => item.toLowerCase() === input.toLowerCase(),
  );
  return (role as BridgeRole | undefined) || BRIDGE_DEFAULT_ROLE;
}

function resolveBridgeProfile(input: string | undefined): BridgeC4Profile {
  if (!input) {
    return (process.env.BRIDGE_C4_PROFILE as BridgeC4Profile) || BRIDGE_DEFAULT_PROFILE;
  }

  const profile = Object.keys(BRIDGE_PROFILES).find(
    (item) => item.toLowerCase() === input.toLowerCase(),
  );
  return (profile as BridgeC4Profile | undefined) || BRIDGE_DEFAULT_PROFILE;
}

function runBridgePreflight(params: {
  operationType: BridgeOperationType;
  operationValueUsd: number;
  routeComplexity: number;
  riskTolerance: BridgeRiskTolerance;
  role: BridgeRole;
  profile: BridgeC4Profile;
}) {
  const riskByOperation: Record<BridgeOperationType, number> = {
    "fleet-dispatch": 46,
    "logistics-route": 38,
    recon: 42,
    "market-order": 34,
    repair: 26,
  };

  const toleranceShift: Record<BridgeRiskTolerance, number> = {
    low: -6,
    medium: 0,
    high: 6,
  };

  const etaByOperation: Record<BridgeOperationType, number> = {
    "fleet-dispatch": 130,
    "logistics-route": 220,
    recon: 160,
    "market-order": 40,
    repair: 95,
  };

  const marginByOperation: Record<BridgeOperationType, number> = {
    "fleet-dispatch": 0.12,
    "logistics-route": 0.15,
    recon: 0.09,
    "market-order": 0.07,
    repair: 0.03,
  };

  const profileRules = BRIDGE_PROFILES[params.profile];
  const roleCaps = BRIDGE_ROLE_CAPABILITIES[params.role];
  const complexity = clamp(params.routeComplexity, 1, 5);
  const complexityMultiplier = 1 + (complexity - 3) * 0.12;

  const baseRisk = riskByOperation[params.operationType];
  const roleRiskBonus = roleCaps.canApproveCritical ? -3 : 2;
  const rawRisk =
    baseRisk * profileRules.volatilityMultiplier * complexityMultiplier +
    toleranceShift[params.riskTolerance] +
    roleRiskBonus;
  const riskScore = clamp(Math.round(rawRisk), 8, 97);

  const successProbability = clamp(
    Math.round(100 - riskScore * 0.84 + (roleCaps.canApproveCritical ? 5 : 0)),
    6,
    95,
  );

  const etaMinutes = Math.round(
    etaByOperation[params.operationType] * profileRules.etaMultiplier * complexityMultiplier,
  );

  const operationValueUsd = Math.max(100, params.operationValueUsd);
  const expectedPnlUsd = Math.round(
    operationValueUsd *
      (marginByOperation[params.operationType] * profileRules.returnPotentialMultiplier -
        riskScore / 140),
  );
  const bestCaseUsd = Math.round(
    operationValueUsd *
      marginByOperation[params.operationType] *
      profileRules.returnPotentialMultiplier *
      2.2,
  );
  const worstCaseUsd = Math.round(operationValueUsd * (riskScore / 100) * 0.78);

  return {
    generatedAt: new Date().toISOString(),
    role: params.role,
    profile: params.profile,
    profileLabel: profileRules.label,
    operationType: params.operationType,
    operationValueUsd,
    routeComplexity: complexity,
    riskTolerance: params.riskTolerance,
    riskScore,
    successProbability,
    etaMinutes,
    expectedPnlUsd,
    bestCaseUsd,
    worstCaseUsd,
    assumptions: [
      `C4 profile: ${profileRules.label}`,
      `Fleet policy: ${profileRules.fleetCapacityPolicy}`,
      "Monte Carlo deep simulation planned for phase 2.",
    ],
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function hashedRange(seed: string, min: number, max: number) {
  const hash = hashString(seed);
  const ratio = (hash % 10_000) / 10_000;
  return Math.round(min + (max - min) * ratio);
}

const BRIDGE_FACTIONS: BridgeFaction[] = ["MUD", "ONI", "USTUR"];

function resolveBridgeFaction(wallet: string): BridgeFaction {
  const normalized = normalizeWalletAddress(wallet);
  if (!normalized) {
    return "MUD";
  }

  const index = hashString(normalized) % BRIDGE_FACTIONS.length;
  return BRIDGE_FACTIONS[index] || "MUD";
}

function buildConnectedWalletMetrics(currentWallet: string): BridgeConnectedWalletMetrics {
  const connectedWallets = new Set<string>();
  const normalizedCurrent = normalizeWalletAddress(currentWallet);
  if (normalizedCurrent) {
    connectedWallets.add(normalizedCurrent);
  }

  for (const session of walletAuthSessionStore.values()) {
    const normalizedSessionWallet = normalizeWalletAddress(session.wallet);
    if (!normalizedSessionWallet) {
      continue;
    }
    if (!hasBridgeAccess(normalizedSessionWallet)) {
      continue;
    }
    connectedWallets.add(normalizedSessionWallet);
  }

  const byFaction: Record<BridgeFaction, number> = {
    MUD: 0,
    ONI: 0,
    USTUR: 0,
  };

  for (const wallet of connectedWallets.values()) {
    const faction = resolveBridgeFaction(wallet);
    byFaction[faction] += 1;
  }

  return {
    totalConnectedWallets: connectedWallets.size,
    byFaction,
  };
}

type ParsedSagePlayersMetric = {
  online: number | null;
  source: BridgeSagePlayersMetric["source"];
};

type ParsedSageActiveProfilesMetric = {
  activeProfiles: number | null;
  source: BridgeSageActiveProfilesMetric["source"];
};

function parseSagePlayersMetricPayload(payload: unknown): ParsedSagePlayersMetric {
  const record = asRecord(payload);
  if (!record) {
    return {
      online: null,
      source: "unavailable",
    };
  }

  const directCandidates = [
    record.sagePlayersOnline,
    record.playersOnline,
    record.onlinePlayers,
    record.online,
    record.activePlayers,
    record.count,
  ];

  for (const candidate of directCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) {
      return {
        online: clamp(Math.round(value), 0, 1_000_000_000),
        source: "upstream",
      };
    }
  }

  const nestedCandidates = [
    asRecord(record.sageStats),
    asRecord(record.metrics),
    asRecord(record.players),
    asRecord(record.stats),
    asRecord(record.data),
  ].filter(Boolean) as Array<Record<string, unknown>>;

  for (const nested of nestedCandidates) {
    const value = Number(
      nested.sagePlayersOnline ||
        nested.playersOnline ||
        nested.onlinePlayers ||
        nested.online ||
        nested.activePlayers ||
        nested.count,
    );
    if (Number.isFinite(value) && value >= 0) {
      return {
        online: clamp(Math.round(value), 0, 1_000_000_000),
        source: "upstream",
      };
    }
  }

  // Ryden fallback: sum faction fleet counts from api_fleets_all.php payload.
  const statsRecord = asRecord(record.stats);
  if (statsRecord) {
    const fleetEstimate = ["1", "2", "3"].reduce((sum, factionKey) => {
      const factionStats = asRecord(statsRecord[factionKey]);
      if (!factionStats) {
        return sum;
      }
      const fleetCount = Number(factionStats.fleetCount);
      if (!Number.isFinite(fleetCount) || fleetCount < 0) {
        return sum;
      }
      return sum + fleetCount;
    }, 0);

    if (fleetEstimate > 0) {
      return {
        online: clamp(Math.round(fleetEstimate), 0, 1_000_000_000),
        source: "estimated",
      };
    }
  }

  return {
    online: null,
    source: "unavailable",
  };
}

async function fetchSagePlayersMetric(): Promise<BridgeSagePlayersMetric> {
  const nowIso = new Date().toISOString();
  if (!BRIDGE_SAGE_PLAYERS_UPSTREAM_URL) {
    return {
      online: null,
      source: "unavailable",
      updatedAt: nowIso,
    };
  }

  const payload = await fetchJsonWithTimeout(
    BRIDGE_SAGE_PLAYERS_UPSTREAM_URL,
    BRIDGE_LIVE_MAP_TIMEOUT_MS,
  );
  const metric = parseSagePlayersMetricPayload(payload);
  if (metric.online === null) {
    return {
      online: null,
      source: "unavailable",
      updatedAt: nowIso,
    };
  }

  return {
    online: metric.online,
    source: metric.source,
    updatedAt: nowIso,
  };
}

function parseSageActiveProfilesMetricPayload(payload: unknown): ParsedSageActiveProfilesMetric {
  const record = asRecord(payload);
  if (!record) {
    return {
      activeProfiles: null,
      source: "unavailable",
    };
  }

  const directCandidates = [
    record.sageActiveProfiles,
    record.sageActiveProfilesToday,
    record.activeProfiles,
    record.activeProfilesToday,
    record.profilesOnline,
    record.onlineProfiles,
    record.count,
  ];

  for (const candidate of directCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) {
      return {
        activeProfiles: clamp(Math.round(value), 0, 1_000_000_000),
        source: "upstream",
      };
    }
  }

  // Ryden fallback: unique profile addresses from today leaderboard for factions 1/2/3.
  const todayRecord = asRecord(record.today);
  if (todayRecord) {
    const profiles = new Set<string>();

    for (const factionKey of ["1", "2", "3"]) {
      const factionRecord = asRecord(todayRecord[factionKey]);
      const lpList = factionRecord?.LP;
      if (!Array.isArray(lpList)) {
        continue;
      }

      for (const item of lpList) {
        const row = asRecord(item);
        const profile = typeof row?.profile === "string" ? row.profile.trim() : "";
        if (profile) {
          profiles.add(profile);
        }
      }
    }

    if (profiles.size > 0) {
      return {
        activeProfiles: profiles.size,
        source: "estimated",
      };
    }
  }

  return {
    activeProfiles: null,
    source: "unavailable",
  };
}

async function fetchSageActiveProfilesMetric(): Promise<BridgeSageActiveProfilesMetric> {
  const nowIso = new Date().toISOString();
  if (!BRIDGE_SAGE_ACTIVE_PROFILES_UPSTREAM_URL) {
    return {
      activeProfiles: null,
      source: "unavailable",
      updatedAt: nowIso,
    };
  }

  const payload = await fetchJsonWithTimeout(
    BRIDGE_SAGE_ACTIVE_PROFILES_UPSTREAM_URL,
    BRIDGE_LIVE_MAP_TIMEOUT_MS,
  );
  const metric = parseSageActiveProfilesMetricPayload(payload);
  if (metric.activeProfiles === null) {
    return {
      activeProfiles: null,
      source: "unavailable",
      updatedAt: nowIso,
    };
  }

  return {
    activeProfiles: metric.activeProfiles,
    source: metric.source,
    updatedAt: nowIso,
  };
}

function buildBridgeUpstreamSamplePayload(params: {
  role: BridgeRole;
  profile: BridgeC4Profile;
  wallet: string;
  windowMinutes: number;
}): BridgeLiveMap {
  const nowIso = new Date().toISOString();

  const fleets: BridgeMapPoint[] = [
    {
      id: `up-fleet-${hashString(`${params.wallet}:1`)}`,
      label: "EV Vanguard",
      x: hashedRange(`${params.wallet}:fleet:x:1`, 140, 860),
      y: hashedRange(`${params.wallet}:fleet:y:1`, 90, 390),
      strength: 72,
      updatedAt: nowIso,
    },
    {
      id: `up-fleet-${hashString(`${params.wallet}:2`)}`,
      label: "EV Sentinel",
      x: hashedRange(`${params.wallet}:fleet:x:2`, 140, 860),
      y: hashedRange(`${params.wallet}:fleet:y:2`, 90, 390),
      strength: 64,
      updatedAt: nowIso,
    },
  ];

  const enemies: BridgeMapPoint[] = [
    {
      id: `up-enemy-${hashString(`${params.role}:1`)}`,
      label: "Hostile Wing",
      x: hashedRange(`${params.role}:enemy:x:1`, 520, 940),
      y: hashedRange(`${params.role}:enemy:y:1`, 80, 360),
      strength: 88,
      updatedAt: nowIso,
    },
  ];

  const resources: BridgeMapPoint[] = [
    {
      id: `up-resource-${hashString(`${params.profile}:1`)}`,
      label: "Fuel Lane",
      x: hashedRange(`${params.profile}:res:x:1`, 120, 880),
      y: hashedRange(`${params.profile}:res:y:1`, 120, 420),
      strength: 58,
      updatedAt: nowIso,
    },
    {
      id: `up-resource-${hashString(`${params.profile}:2`)}`,
      label: "Ore Cluster",
      x: hashedRange(`${params.profile}:res:x:2`, 120, 880),
      y: hashedRange(`${params.profile}:res:y:2`, 120, 420),
      strength: 66,
      updatedAt: nowIso,
    },
  ];

  const routes: BridgeMapRoute[] = [
    {
      id: `up-route-${hashString(`${params.wallet}:route`)}`,
      points: `${fleets[0].x},${fleets[0].y} ${Math.round((fleets[0].x + resources[0].x) / 2)},${Math.round((fleets[0].y + resources[0].y) / 2)} ${resources[0].x},${resources[0].y}`,
      etaMinutes: clamp(params.windowMinutes, 15, 240),
      updatedAt: nowIso,
    },
  ];

  const riskZones: BridgeMapRiskZone[] = [
    {
      id: `up-risk-${hashString(`${params.role}:critical`)}`,
      x: enemies[0].x,
      y: enemies[0].y,
      r: 96,
      severity: "critical",
      updatedAt: nowIso,
    },
  ];

  return {
    generatedAt: nowIso,
    source: "upstream",
    role: params.role,
    profile: params.profile,
    mapImageUrl: BRIDGE_MAP_IMAGE_URL,
    refreshMs: 10_000,
    activityScore: 73,
    fleets,
    enemies,
    resources,
    routes,
    riskZones,
    connectedWalletMetrics: buildConnectedWalletMetrics(params.wallet),
    sagePlayersMetric: {
      online: null,
      source: "unavailable",
      updatedAt: nowIso,
    },
    sageActiveProfilesMetric: {
      activeProfiles: null,
      source: "unavailable",
      updatedAt: nowIso,
    },
  };
}

type DataIntelOrderSignal = {
  id: string;
  label: string;
  status: string;
  valueUsd: number;
  createdAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractOrderSignals(payload: unknown): DataIntelOrderSignal[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Object.values(asRecord(payload) || {}).filter((value) => typeof value === "object");

  const signals = list
    .map((raw, index) => {
      const record = asRecord(raw);
      if (!record) return null;

      const id = String(
        record.id ||
          record.orderId ||
          record.signature ||
          record.txSignature ||
          `order-${index + 1}`,
      );
      const label = String(
        record.itemName ||
          record.asset ||
          record.market ||
          record.symbol ||
          record.side ||
          "Order",
      );
      const status = String(record.status || record.state || "active").toLowerCase();
      const valueUsd = Number(
        record.priceUsd || record.totalUsd || record.valueUsd || record.price || record.value || 0,
      );
      const createdAt =
        typeof record.createdAt === "string"
          ? record.createdAt
          : typeof record.updatedAt === "string"
            ? record.updatedAt
            : typeof record.timestamp === "string"
              ? record.timestamp
              : undefined;

      return {
        id,
        label,
        status,
        valueUsd: Number.isFinite(valueUsd) ? valueUsd : 0,
        createdAt,
      };
    })
    .filter(Boolean) as DataIntelOrderSignal[];

  return signals.slice(0, 40);
}

/**
 * Mining activity data from SAGE
 */
type MiningResourceData = {
  resource: string;
  totalFleets: number;
  byFaction: Record<string, number>;
  updatedAt: string;
};

type BridgeMiningMetrics = {
  resources: MiningResourceData[];
  resetAt: string; // UTC midnight when counters reset
  updatedAt: string;
};

/**
 * Fetch mining data from RYDN API and join with sector-resource mapping
 */
async function fetchSageMiningMetrics(): Promise<BridgeMiningMetrics> {
  try {
    const miningUrl = process.env.BRIDGE_SAGE_MINING_UPSTREAM_URL || 
                      "https://api.ryden.systems/api_fleets_all.php";
    
    const response = await fetchJsonWithTimeout(miningUrl, 8000);
    const data = asRecord(response);
    
    if (!data) {
      return buildEmptyMiningMetrics();
    }
    
    // Extract mining array: [{s: [x,y], c: fleetCount}, ...]
    const miningArray = Array.isArray(data.mining) ? data.mining : [];
    
    // Extract faction stats if available
    const statsRecord = asRecord(data.stats || {});
    const factionStats = {
      MUD: Number(statsRecord?.mud || statsRecord?.faction1 || 0),
      ONI: Number(statsRecord?.oni || statsRecord?.faction2 || 0),
      USTUR: Number(statsRecord?.ustur || statsRecord?.faction3 || 0),
    };
    
    // Aggregate mining data by resource
    const resourceMap = new Map<string, { total: number; byFaction: Record<string, number> }>();
    
    // Initialize all resources
    for (const resource of ALL_RESOURCES) {
      resourceMap.set(resource, { total: 0, byFaction: { MUD: 0, ONI: 0, USTUR: 0 } });
    }
    
    // Process mining sectors
    for (const entry of miningArray) {
      const sectorEntry = asRecord(entry);
      if (!sectorEntry) continue;
      
      const sectorCoords = Array.isArray(sectorEntry.s) && sectorEntry.s.length === 2
        ? sectorEntry.s
        : null;
      const fleetCount = Number(sectorEntry.c || 0);
      
      if (!sectorCoords || fleetCount <= 0) continue;
      
      const [x, y] = sectorCoords;
      const resource = getResourceForSector(x, y);
      
      if (!resource) continue;
      
      const entry_data = resourceMap.get(resource);
      if (!entry_data) continue;
      
      entry_data.total += fleetCount;
      
      // Distribute fleets proportionally across factions (simplified heuristic)
      // In reality, we'd need per-faction mining data from RYDN, but it's not available
      const perFaction = Math.ceil(fleetCount / 3);
      entry_data.byFaction.MUD += perFaction;
      entry_data.byFaction.ONI += perFaction;
      entry_data.byFaction.USTUR += fleetCount - perFaction * 2;
    }
    
    // Build response
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setUTCHours(24, 0, 0, 0);
    if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    
    const resources: MiningResourceData[] = Array.from(resourceMap.entries())
      .map(([resource, data]) => ({
        resource,
        totalFleets: data.total,
        byFaction: data.byFaction,
        updatedAt: now.toISOString(),
      }))
      .filter((r) => r.totalFleets > 0)
      .sort((a, b) => b.totalFleets - a.totalFleets);
    
    return {
      resources,
      resetAt: nextReset.toISOString(),
      updatedAt: now.toISOString(),
    };
  } catch (error) {
    app.log.warn(
      { error: String(error) },
      "Failed to fetch mining metrics from RYDN, returning empty",
    );
    return buildEmptyMiningMetrics();
  }
}

function buildEmptyMiningMetrics(): BridgeMiningMetrics {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);
  if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  
  return {
    resources: [],
    resetAt: nextReset.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StarAtlasBridgeLiveMap/1.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUpstreamLiveMap(params: {
  role: BridgeRole;
  profile: BridgeC4Profile;
  wallet: string;
  windowMinutes: number;
}) {
  if (!BRIDGE_LIVE_MAP_UPSTREAM_URL) {
    return null;
  }

  const separator = BRIDGE_LIVE_MAP_UPSTREAM_URL.includes("?") ? "&" : "?";
  const url =
    `${BRIDGE_LIVE_MAP_UPSTREAM_URL}${separator}` +
    `role=${encodeURIComponent(params.role)}` +
    `&profile=${encodeURIComponent(params.profile)}` +
    `&wallet=${encodeURIComponent(params.wallet)}` +
    `&windowMinutes=${params.windowMinutes}`;

  const payload = await fetchJsonWithTimeout(url, BRIDGE_LIVE_MAP_TIMEOUT_MS);
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const fleets = Array.isArray(record.fleets) ? (record.fleets as BridgeMapPoint[]) : [];
  const enemies = Array.isArray(record.enemies) ? (record.enemies as BridgeMapPoint[]) : [];
  const resources = Array.isArray(record.resources) ? (record.resources as BridgeMapPoint[]) : [];
  const routes = Array.isArray(record.routes) ? (record.routes as BridgeMapRoute[]) : [];
  const riskZones = Array.isArray(record.riskZones)
    ? (record.riskZones as BridgeMapRiskZone[])
    : [];
  const metricsRecord = asRecord(record.connectedWalletMetrics);
  const metricsByFaction = asRecord(metricsRecord?.byFaction);

  const connectedWalletMetrics: BridgeConnectedWalletMetrics = metricsByFaction
    ? {
        totalConnectedWallets: clamp(
          Number(metricsRecord?.totalConnectedWallets || 0),
          0,
          1_000_000,
        ),
        byFaction: {
          MUD: clamp(Number(metricsByFaction.MUD || 0), 0, 1_000_000),
          ONI: clamp(Number(metricsByFaction.ONI || 0), 0, 1_000_000),
          USTUR: clamp(Number(metricsByFaction.USTUR || 0), 0, 1_000_000),
        },
      }
    : buildConnectedWalletMetrics(params.wallet);

  const metricRecord = asRecord(record.sagePlayersMetric);
  const metricOnline = Number(metricRecord?.online);
  const parsedFallbackMetric = parseSagePlayersMetricPayload(record);
  const sagePlayersMetric: BridgeSagePlayersMetric = {
    online:
      Number.isFinite(metricOnline) && metricOnline >= 0
        ? clamp(Math.round(metricOnline), 0, 1_000_000_000)
        : parsedFallbackMetric.online,
    source:
      metricRecord?.source === "upstream" ||
      metricRecord?.source === "estimated" ||
      metricRecord?.source === "unavailable"
        ? metricRecord.source
        : Number.isFinite(metricOnline)
          ? "upstream"
          : parsedFallbackMetric.source,
    updatedAt:
      typeof metricRecord?.updatedAt === "string" && metricRecord.updatedAt
        ? metricRecord.updatedAt
        : new Date().toISOString(),
  };

  const activeProfilesRecord = asRecord(record.sageActiveProfilesMetric);
  const activeProfilesValue = Number(activeProfilesRecord?.activeProfiles);
  const parsedActiveProfilesFallback = parseSageActiveProfilesMetricPayload(record);
  const sageActiveProfilesMetric: BridgeSageActiveProfilesMetric = {
    activeProfiles:
      Number.isFinite(activeProfilesValue) && activeProfilesValue >= 0
        ? clamp(Math.round(activeProfilesValue), 0, 1_000_000_000)
        : parsedActiveProfilesFallback.activeProfiles,
    source:
      activeProfilesRecord?.source === "upstream" ||
      activeProfilesRecord?.source === "estimated" ||
      activeProfilesRecord?.source === "unavailable"
        ? activeProfilesRecord.source
        : Number.isFinite(activeProfilesValue)
          ? "upstream"
          : parsedActiveProfilesFallback.source,
    updatedAt:
      typeof activeProfilesRecord?.updatedAt === "string" && activeProfilesRecord.updatedAt
        ? activeProfilesRecord.updatedAt
        : new Date().toISOString(),
  };

  if (!fleets.length && !enemies.length && !resources.length) {
    return null;
  }

  return {
    generatedAt:
      typeof record.generatedAt === "string" ? record.generatedAt : new Date().toISOString(),
    source: "upstream" as const,
    role: params.role,
    profile: params.profile,
    mapImageUrl:
      typeof record.mapImageUrl === "string" && record.mapImageUrl
        ? record.mapImageUrl
        : BRIDGE_MAP_IMAGE_URL,
    refreshMs: clamp(Number(record.refreshMs || 10_000), 2_500, 60_000),
    activityScore: clamp(Number(record.activityScore || 55), 1, 100),
    fleets,
    enemies,
    resources,
    routes,
    riskZones,
    connectedWalletMetrics,
    sagePlayersMetric,
    sageActiveProfilesMetric,
  } satisfies BridgeLiveMap;
}

async function fetchDataIntelOrderSignals(wallet: string) {
  if (!isValidSolanaWallet(wallet) || !BRIDGE_DATA_INTEL_BASE_URL) {
    return [] as DataIntelOrderSignal[];
  }

  const [v2Payload, localPayload] = await Promise.all([
    fetchJsonWithTimeout(
      `${BRIDGE_DATA_INTEL_BASE_URL}/orders/v2/${encodeURIComponent(wallet)}`,
      BRIDGE_LIVE_MAP_TIMEOUT_MS,
    ),
    fetchJsonWithTimeout(
      `${BRIDGE_DATA_INTEL_BASE_URL}/orders/local/${encodeURIComponent(wallet)}`,
      BRIDGE_LIVE_MAP_TIMEOUT_MS,
    ),
  ]);

  const signals = [...extractOrderSignals(v2Payload), ...extractOrderSignals(localPayload)];
  const unique = Array.from(new Map(signals.map((signal) => [signal.id, signal])).values());
  return unique.slice(0, 40);
}

async function buildBridgeLiveMap(params: {
  role: BridgeRole;
  profile: BridgeC4Profile;
  wallet: string;
  windowMinutes: number;
}): Promise<BridgeLiveMap> {
  const upstream = await fetchUpstreamLiveMap(params);
  if (upstream) {
    return upstream;
  }

  const sageActiveProfilesMetric = await fetchSageActiveProfilesMetric();

  const dataIntelSignals = await fetchDataIntelOrderSignals(params.wallet);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const windowMs = params.windowMinutes * 60 * 1000;
  const sinceMs = now - windowMs;

  const scopedAlerts = bridgeAlertsStore
    .filter((alert) => alert.targetRoles.includes(params.role))
    .filter((alert) => new Date(alert.createdAt).getTime() >= sinceMs)
    .slice(0, 12);

  const preflights = bridgeAuditStore
    .filter((event) => event.role === params.role && event.eventType === "preflight-run")
    .filter((event) => new Date(event.createdAt).getTime() >= sinceMs)
    .slice(0, 10);

  const activeListings = marketListings.filter((listing) => listing.status === "active").slice(0, 12);
  const dataIntelRecent = dataIntelSignals.filter((signal) => {
    if (!signal.createdAt) return true;
    const ts = new Date(signal.createdAt).getTime();
    return Number.isFinite(ts) ? ts >= sinceMs : true;
  });

  const fleets: BridgeMapPoint[] = preflights.length
    ? preflights.map((event, index) => ({
        id: `fleet-${event.id}`,
        label: `EV-${String(index + 1).padStart(2, "0")}`,
        x: hashedRange(`${event.id}:x`, 120, 900),
        y: hashedRange(`${event.id}:y`, 90, 420),
        strength: clamp(Number(event.details.successProbability || 60), 15, 95),
        updatedAt: event.createdAt,
      }))
    : [
        { id: "fleet-default-a", label: "EV Alpha", x: 180, y: 150, strength: 62, updatedAt: nowIso },
        { id: "fleet-default-b", label: "EV Cargo", x: 360, y: 220, strength: 57, updatedAt: nowIso },
        { id: "fleet-default-c", label: "EV Scout", x: 690, y: 170, strength: 68, updatedAt: nowIso },
      ];

  const enemies: BridgeMapPoint[] = scopedAlerts
    .filter((alert) => alert.level === "critical" || alert.level === "high")
    .map((alert, index) => ({
      id: `enemy-${alert.id}`,
      label: alert.level === "critical" ? `Raid-${index + 1}` : `Threat-${index + 1}`,
      x: hashedRange(`${alert.id}:x`, 500, 940),
      y: hashedRange(`${alert.id}:y`, 70, 410),
      strength: alert.level === "critical" ? 92 : 74,
      updatedAt: alert.createdAt,
    }));

  const resources: BridgeMapPoint[] = dataIntelRecent.length
    ? dataIntelRecent.map((signal) => ({
        id: `resource-${signal.id}`,
        label: signal.label.slice(0, 18),
        x: hashedRange(`${signal.id}:x`, 130, 930),
        y: hashedRange(`${signal.id}:y`, 80, 430),
        strength: clamp(Math.round(signal.valueUsd / 20), 10, 95),
        updatedAt: signal.createdAt,
      }))
    : activeListings.map((listing) => ({
        id: `resource-${listing.id}`,
        label: listing.itemName.slice(0, 18),
        x: hashedRange(`${listing.id}:x`, 130, 930),
        y: hashedRange(`${listing.id}:y`, 80, 430),
        strength: clamp(Math.round(listing.priceUsd / 10), 10, 95),
        updatedAt: listing.createdAt,
      }));

  const routes: BridgeMapRoute[] = fleets.slice(0, Math.max(0, fleets.length - 1)).map((fleet, index) => {
    const target = fleets[index + 1];
    const controlX = Math.round((fleet.x + target.x) / 2);
    const controlY = Math.round((fleet.y + target.y) / 2 + (index % 2 === 0 ? -24 : 24));
    return {
      id: `route-${fleet.id}-${target.id}`,
      points: `${fleet.x},${fleet.y} ${controlX},${controlY} ${target.x},${target.y}`,
      etaMinutes: clamp(Math.round(Math.abs(target.x - fleet.x) / 4 + Math.abs(target.y - fleet.y) / 6), 25, 320),
      updatedAt: [fleet.updatedAt, target.updatedAt].filter(Boolean).sort().reverse()[0],
    };
  });

  const riskZones: BridgeMapRiskZone[] = [
    ...enemies.slice(0, 4).map((enemy) => ({
      id: `zone-${enemy.id}`,
      x: enemy.x,
      y: enemy.y,
      r: clamp(Math.round((enemy.strength || 70) * 1.1), 55, 140),
      severity: ((enemy.strength || 0) >= 90 ? "critical" : "high") as
        | "critical"
        | "high"
        | "normal",
      updatedAt: enemy.updatedAt,
    })),
    ...resources.slice(0, 2).map((resource) => ({
      id: `zone-${resource.id}`,
      x: resource.x,
      y: resource.y,
      r: 58,
      severity: "normal" as const,
      updatedAt: resource.updatedAt,
    })),
  ];

  const activityScore = clamp(
    Math.round(
      fleets.length * 8 +
        enemies.length * 12 +
        resources.length * 5 +
        routes.length * 4 +
        dataIntelRecent.length * 2,
    ),
    5,
    100,
  );

  return {
    generatedAt: nowIso,
    source: dataIntelRecent.length ? "data-intel" : "synthetic",
    role: params.role,
    profile: params.profile,
    mapImageUrl: BRIDGE_MAP_IMAGE_URL,
    refreshMs: 10_000,
    activityScore,
    fleets,
    enemies,
    resources,
    routes,
    riskZones,
    connectedWalletMetrics: buildConnectedWalletMetrics(params.wallet),
    sagePlayersMetric: {
      online: null,
      source: "unavailable",
      updatedAt: nowIso,
    },
    sageActiveProfilesMetric,
  };
}

const marketListings: MarketListing[] = [
  {
    id: "lst-1001",
    itemName: "Fimbul Airbike",
    itemClass: "Ship",
    quantity: 1,
    priceUsd: 745,
    paymentToken: "USDC",
    sellerWallet: "DemoSellerA",
    status: "active",
    note: "Готов к быстрому трейду",
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "lst-1002",
    itemName: "Star Atlas Crew Pack",
    itemClass: "Crew",
    quantity: 4,
    priceUsd: 180,
    paymentToken: "ATLAS",
    sellerWallet: "DemoSellerB",
    status: "active",
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: "lst-1003",
    itemName: "Resource Bundle: Fuel + Food",
    itemClass: "Resource",
    quantity: 200,
    priceUsd: 92,
    paymentToken: "USDC",
    sellerWallet: "DemoSellerC",
    status: "active",
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
  },
];

const barterOffers: BarterOffer[] = [
  {
    id: "bar-9001",
    fromWallet: "DemoBarterA",
    offerItem: "Fimbul Airbike",
    wantItem: "Calico Guardian",
    extraUsd: 0,
    note: "Прямой swap без доплаты",
    status: "open",
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "bar-9002",
    fromWallet: "DemoBarterB",
    offerItem: "XX-Small Cargo",
    wantItem: "Fimbul Airbike",
    extraUsd: 120,
    note: "Готов добавить USDC",
    status: "open",
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
];

function createId(prefix: string) {
  const token = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${token}`;
}

function createAuthToken() {
  return randomBytes(32).toString("hex");
}

function normalizeWalletAddress(wallet: string) {
  return String(wallet || "").trim();
}

function isAdminWallet(wallet: string) {
  return WALLET_AUTH_ADMIN_WALLETS.has(wallet);
}

function hasBridgeAccess(wallet: string) {
  return isAdminWallet(wallet) || bridgeAccessStore.some((entry) => entry.wallet === wallet);
}

function isValidSolanaWallet(wallet: string) {
  try {
    const publicKey = new PublicKey(wallet);
    return publicKey.toBase58() === wallet;
  } catch {
    return false;
  }
}

function createWalletChallenge(wallet: string): WalletAuthChallenge {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WALLET_AUTH_CHALLENGE_TTL_MS).toISOString();
  const nonce = randomBytes(16).toString("hex");
  const challengeId = createId("wch");
  const message = [
    "Star Atlas Wallet Verification",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${createdAt}`,
    `Expires At: ${expiresAt}`,
    "Purpose: Login and wallet registration",
  ].join("\n");

  return {
    challengeId,
    wallet,
    nonce,
    message,
    createdAt,
    expiresAt,
  };
}

function verifyWalletSignature(wallet: string, message: string, signatureBase64: string) {
  try {
    const publicKey = new PublicKey(wallet);
    const rawSignature = Buffer.from(signatureBase64, "base64");
    // Some wallet providers may include an extra recovery byte.
    const signature =
      rawSignature.length > 64 ? rawSignature.subarray(0, 64) : rawSignature;

    const utf8Message = Buffer.from(message, "utf-8");
    const prefixedMessageWithLength = Buffer.from(
      `\u0017Solana Signed Message:\n${message.length}${message}`,
      "utf-8",
    );
    const prefixedMessageNoLength = Buffer.from(
      `\u0017Solana Signed Message:\n${message}`,
      "utf-8",
    );

    const candidateMessages = [
      utf8Message,
      prefixedMessageWithLength,
      prefixedMessageNoLength,
    ];

    return candidateMessages.some((candidate) =>
      nacl.sign.detached.verify(candidate, signature, publicKey.toBytes()),
    );
  } catch {
    return false;
  }
}

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function buildWalletAuthMemo(challengeId: string, nonce: string) {
  return `star-atlas-auth:${challengeId}:${nonce}`;
}

function verifyWalletAuthSignedTransaction(
  wallet: string,
  challengeId: string,
  nonce: string,
  serializedTransactionBase64: string,
) {
  try {
    const raw = Buffer.from(serializedTransactionBase64, "base64");
    const tx = Transaction.from(raw);

    if (!tx.verifySignatures()) {
      return false;
    }

    const feePayer = tx.feePayer?.toBase58();
    if (!feePayer || feePayer !== wallet) {
      return false;
    }

    const hasWalletSignature = tx.signatures.some(
      (entry) => entry.publicKey.toBase58() === wallet && Boolean(entry.signature),
    );
    if (!hasWalletSignature) {
      return false;
    }

    const expectedMemo = buildWalletAuthMemo(challengeId, nonce);
    const hasExpectedMemo = tx.instructions.some(
      (instruction) =>
        instruction.programId.toBase58() === MEMO_PROGRAM_ID &&
        instruction.data.toString("utf-8") === expectedMemo,
    );

    return hasExpectedMemo;
  } catch {
    return false;
  }
}

function getBearerToken(request: FastifyRequest) {
  const rawHeader = String(request.headers.authorization || "").trim();
  if (!rawHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return rawHeader.slice(7).trim();
}

function requireWalletAuthSession(request: FastifyRequest, reply: FastifyReply) {
  pruneWalletAuthStores();

  const token = getBearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "Authorization Bearer token is required" });
    return null;
  }

  const session = walletAuthSessionStore.get(token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    walletAuthSessionStore.delete(token);
    reply.code(401).send({ error: "Session expired or invalid" });
    return null;
  }

  return session;
}

function requireBridgeAccessSession(request: FastifyRequest, reply: FastifyReply) {
  const session = requireWalletAuthSession(request, reply);
  if (!session) {
    return null;
  }

  if (!hasBridgeAccess(session.wallet)) {
    reply.code(403).send({ error: "Captain's Bridge access required" });
    return null;
  }

  return session;
}

function pruneWalletAuthStores() {
  const now = Date.now();

  for (const [wallet, challenge] of walletAuthChallengeStore.entries()) {
    if (new Date(challenge.expiresAt).getTime() <= now) {
      walletAuthChallengeStore.delete(wallet);
    }
  }

  for (const [token, session] of walletAuthSessionStore.entries()) {
    if (new Date(session.expiresAt).getTime() <= now) {
      walletAuthSessionStore.delete(token);
    }
  }
}

function upsertWalletAuthUser(wallet: string) {
  const now = new Date().toISOString();
  const existing = walletAuthUsersStore.find((user) => user.wallet === wallet);

  if (existing) {
    existing.verifiedAt = now;
    existing.lastLoginAt = now;
    existing.loginCount += 1;
    return {
      user: existing,
      isNewRegistration: false,
    };
  }

  const user: WalletAuthUser = {
    id: createId("usr"),
    wallet,
    registeredAt: now,
    verifiedAt: now,
    lastLoginAt: now,
    loginCount: 1,
  };

  walletAuthUsersStore = [user, ...walletAuthUsersStore];
  return {
    user,
    isNewRegistration: true,
  };
}

function createWalletAuthSession(wallet: string) {
  const token = createAuthToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + WALLET_AUTH_SESSION_TTL_MS).toISOString();

  const session: WalletAuthSession = {
    token,
    wallet,
    createdAt,
    expiresAt,
  };

  walletAuthSessionStore.set(token, session);
  return session;
}

function buildSnapshot(handle: string): DashboardSnapshot {
  const normalized = handle.trim().toLowerCase() || "pilot";
  const modifier = 0.9 + (normalized.length % 5) * 0.05;

  const assets = BASE_ASSETS.map((asset) => ({
    ...asset,
    isStarAtlas: true,
    estimatedValueUsd: Number((asset.estimatedValueUsd * modifier).toFixed(2)),
    dailyYieldUsd: Number((asset.dailyYieldUsd * modifier).toFixed(2)),
  }));

  const totalValueUsd = Number(
    assets
      .reduce((sum, current) => sum + current.estimatedValueUsd, 0)
      .toFixed(2),
  );
  const dailyProfitUsd = Number(
    assets.reduce((sum, current) => sum + current.dailyYieldUsd, 0).toFixed(2),
  );
  const roiDays =
    dailyProfitUsd > 0
      ? Number((totalValueUsd / dailyProfitUsd).toFixed(1))
      : 0;

  return {
    handle: normalized,
    generatedAt: new Date().toISOString(),
    totalValueUsd,
    dailyProfitUsd,
    roiDays,
    assets,
  };
}

async function fetchPricesUsdByCoingeckoId(ids: string[]) {
  if (!ids.length) {
    return {} as Record<string, number>;
  }

  const query = encodeURIComponent(ids.join(","));
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${query}&vs_currencies=usd`,
  );

  if (!response.ok) {
    return {} as Record<string, number>;
  }

  const payload = (await response.json()) as Record<string, { usd?: number }>;
  const prices: Record<string, number> = {};

  for (const id of ids) {
    prices[id] = Number(payload[id]?.usd || 0);
  }

  return prices;
}

async function fetchPricesUsdByMintViaJupiter(mints: string[]) {
  if (!mints.length) {
    return {} as Record<string, number>;
  }

  try {
    const uniqueMints = Array.from(new Set(mints));
    const chunks = chunkArray(uniqueMints, 100);
    const prices: Record<string, number> = {};

    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const ids = encodeURIComponent(chunk.join(","));
          const response = await fetch(`https://price.jup.ag/v6/price?ids=${ids}`);

          if (!response.ok) {
            return;
          }

          const payload = (await response.json()) as {
            data?: Record<string, { price?: number }>;
          };

          for (const mint of chunk) {
            prices[mint] = Number(payload.data?.[mint]?.price || 0);
          }
        } catch {
          return;
        }
      }),
    );

    return prices;
  } catch {
    return {} as Record<string, number>;
  }
}

function normalizeSolLikePrice(value: number) {
  if (value <= 0) {
    return 0;
  }

  // Some APIs return lamports, others SOL. Heuristic keeps both usable.
  return value > 100_000 ? value / 1_000_000_000 : value;
}

async function fetchNftPricesUsdByMintViaMagicEden(
  mints: string[],
  solUsd: number,
): Promise<
  Record<
    string,
    {
      priceUsd: number;
      isStarAtlas: boolean;
    }
  >
> {
  if (!mints.length || solUsd <= 0) {
    return {} as Record<
      string,
      {
        priceUsd: number;
        isStarAtlas: boolean;
      }
    >;
  }

  const metadataByMint: Record<
    string,
    {
      priceUsd: number;
      isStarAtlas: boolean;
    }
  > = {};
  const limitedMints = Array.from(new Set(mints)).slice(0, 40);

  await Promise.all(
    limitedMints.map(async (mint) => {
      try {
        const response = await fetch(
          `https://api-mainnet.magiceden.dev/v2/tokens/${mint}`,
        );

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          collection?: string;
          collectionName?: string;
          symbol?: string;
          name?: string;
          price?: number;
          listedPrice?: number;
          lastSalePrice?: number;
        };

        const solPrice = normalizeSolLikePrice(
          Number(payload.price || payload.listedPrice || payload.lastSalePrice || 0),
        );

        const collectionFields = [
          payload.collection,
          payload.collectionName,
          payload.symbol,
          payload.name,
        ]
          .filter(Boolean)
          .map((value) => String(value).trim().toLowerCase());

        const isStarAtlas = isStarAtlasCollection(collectionFields);

        metadataByMint[mint] = {
          priceUsd: solPrice > 0 ? Number((solPrice * solUsd).toFixed(6)) : 0,
          isStarAtlas,
        };
      } catch {
        return;
      }
    }),
  );

  return metadataByMint;
}

async function buildWalletSnapshot(wallet: string): Promise<DashboardSnapshot> {
  const publicKey = new PublicKey(wallet);
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(publicKey),
    connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    }),
  ]);

  const balancesByMint = new Map<string, { amount: number; decimals: number }>();

  for (const account of tokenAccounts.value) {
    const parsedInfo = account.account.data.parsed?.info;
    const mint = parsedInfo?.mint as string | undefined;
    const tokenAmount = parsedInfo?.tokenAmount;

    if (!mint || !tokenAmount) {
      continue;
    }

    const amount = Number(tokenAmount.uiAmount || 0);
    const decimals = Number(tokenAmount.decimals || 0);
    if (amount <= 0) {
      continue;
    }

    const current = balancesByMint.get(mint);
    balancesByMint.set(mint, {
      amount: Number(((current?.amount || 0) + amount).toFixed(9)),
      decimals,
    });
  }

  const aggregatedTokens = Array.from(balancesByMint.entries()).map(
    ([mint, balance]) => ({
      mint,
      amount: balance.amount,
      decimals: balance.decimals,
    }),
  );
  const fungibleTokens = aggregatedTokens.filter((token) => token.decimals > 0);
  const nftTokens = aggregatedTokens.filter((token) => token.decimals === 0);

  const coingeckoIds = Array.from(
    new Set(
      [
        "solana",
        ...fungibleTokens
          .map((token) => KNOWN_TOKEN_BY_MINT[token.mint]?.coingeckoId)
          .filter(Boolean),
      ] as string[],
    ),
  );
  const [pricesById, pricesByMint] = await Promise.all([
    fetchPricesUsdByCoingeckoId(coingeckoIds),
    fetchPricesUsdByMintViaJupiter(aggregatedTokens.map((token) => token.mint)),
  ]);
  const nftMetadataByMint = await fetchNftPricesUsdByMintViaMagicEden(
    nftTokens
      .filter((token) => Number(pricesByMint[token.mint] || 0) <= 0)
      .map((token) => token.mint),
    Number(pricesById["solana"] || 0),
  );

  const assets: FleetAsset[] = [];
  const solAmount = lamports / 1_000_000_000;
  assets.push({
    id: "sol-native",
    name: "Solana (SOL)",
    class: "Resource",
    isStarAtlas: false,
    quantity: Number(solAmount.toFixed(6)),
    estimatedValueUsd: Number((solAmount * Number(pricesById["solana"] || 0)).toFixed(2)),
    dailyYieldUsd: 0,
  });

  for (const token of fungibleTokens) {
    const known = KNOWN_TOKEN_BY_MINT[token.mint];
    const coingeckoId = known?.coingeckoId;
    const priceFromJupiter = Number(pricesByMint[token.mint] || 0);
    const priceFromCoingecko = coingeckoId
      ? Number(pricesById[coingeckoId] || 0)
      : 0;
    const priceUsd = priceFromJupiter > 0 ? priceFromJupiter : priceFromCoingecko;
    const shortMint = `${token.mint.slice(0, 4)}...${token.mint.slice(-4)}`;

    assets.push({
      id: token.mint,
      name: known?.name || `SPL Token (${shortMint})`,
      class: "Resource",
      isStarAtlas: Boolean(known?.isStarAtlas),
      quantity: Number(token.amount.toFixed(6)),
      estimatedValueUsd: Number((token.amount * priceUsd).toFixed(2)),
      dailyYieldUsd: 0,
    });
  }

  for (const nft of nftTokens) {
    const shortMint = `${nft.mint.slice(0, 4)}...${nft.mint.slice(-4)}`;
    const priceFromJupiter = Number(pricesByMint[nft.mint] || 0);
    const priceFromMagicEden = Number(
      nftMetadataByMint[nft.mint]?.priceUsd || 0,
    );
    const unitPriceUsd =
      priceFromJupiter > 0 ? priceFromJupiter : priceFromMagicEden;
    const isStarAtlas = Boolean(nftMetadataByMint[nft.mint]?.isStarAtlas);

    assets.push({
      id: nft.mint,
      name: `NFT (${shortMint})`,
      class: "NFT",
      isStarAtlas,
      quantity: Number(nft.amount.toFixed(0)),
      estimatedValueUsd: Number((nft.amount * unitPriceUsd).toFixed(2)),
      dailyYieldUsd: 0,
    });
  }

  const sortedAssets = assets.sort((left, right) => {
    const leftHasPrice = left.estimatedValueUsd > 0 ? 1 : 0;
    const rightHasPrice = right.estimatedValueUsd > 0 ? 1 : 0;

    if (rightHasPrice !== leftHasPrice) {
      return rightHasPrice - leftHasPrice;
    }

    if (right.estimatedValueUsd !== left.estimatedValueUsd) {
      return right.estimatedValueUsd - left.estimatedValueUsd;
    }

    return left.name.localeCompare(right.name);
  });

  const knownOrPricedAssets = sortedAssets.filter((asset) => {
    const known = KNOWN_TOKEN_BY_MINT[asset.id];
    return (
      asset.class === "NFT" ||
      !asset.name.startsWith("SPL Token (") ||
      asset.estimatedValueUsd > 0 ||
      Boolean(known?.isStarAtlas)
    );
  });
  const unknownAssets = sortedAssets.filter(
    (asset) => asset.name.startsWith("SPL Token (") && asset.estimatedValueUsd === 0,
  );

  const MAX_UNKNOWN_ASSETS = 20;
  const MAX_ASSETS = 80;
  const visibleAssets = [
    ...knownOrPricedAssets,
    ...unknownAssets.slice(0, MAX_UNKNOWN_ASSETS),
  ].slice(0, MAX_ASSETS);
  const hiddenAssetsCount = Math.max(0, sortedAssets.length - visibleAssets.length);

  if (hiddenAssetsCount > 0) {
    visibleAssets.push({
      id: "other-assets",
      name: `Other assets (${hiddenAssetsCount})`,
      class: "Resource",
      isStarAtlas: false,
      quantity: hiddenAssetsCount,
      estimatedValueUsd: 0,
      dailyYieldUsd: 0,
    });
  }

  const totalValueUsd = Number(
    sortedAssets
      .reduce((sum, current) => sum + current.estimatedValueUsd, 0)
      .toFixed(2),
  );

  return {
    handle: wallet,
    generatedAt: new Date().toISOString(),
    totalValueUsd,
    dailyProfitUsd: 0,
    roiDays: 0,
    assets: visibleAssets,
  };
}

const STAR_ATLAS_OFFICIAL_URL =
  process.env.STAR_ATLAS_OFFICIAL_URL || "https://staratlas.com/";
const STAR_ATLAS_NEWS_URL =
  process.env.STAR_ATLAS_NEWS_URL || "https://staratlas.com/news";
const STAR_ATLAS_COMMUNITY_URL =
  process.env.STAR_ATLAS_COMMUNITY_URL || "https://staratlas.com/community";
const STAR_ATLAS_MEDIUM_RSS_URL =
  process.env.STAR_ATLAS_MEDIUM_RSS_URL || "https://medium.com/feed/star-atlas";
const STAR_ATLAS_X_URL = process.env.STAR_ATLAS_X_URL || "https://x.com/staratlas";
const STAR_ATLAS_X_RSS_URL =
  process.env.STAR_ATLAS_X_RSS_URL || "https://nitter.net/staratlas/rss";
const STAR_ATLAS_DISCORD_INVITE_URL =
  process.env.STAR_ATLAS_DISCORD_INVITE_URL || "https://discord.com/invite/staratlas";
const STAR_ATLAS_DISCORD_BOT_TOKEN = process.env.STAR_ATLAS_DISCORD_BOT_TOKEN || "";
const STAR_ATLAS_DISCORD_CHANNEL_IDS = (process.env.STAR_ATLAS_DISCORD_CHANNEL_IDS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const STAR_ATLAS_DISCORD_GUILD_ID = process.env.STAR_ATLAS_DISCORD_GUILD_ID || "";
const DISCORD_API_BASE = process.env.STAR_ATLAS_DISCORD_API_BASE || "https://discord.com/api/v10";
const STAR_ATLAS_ARCHIVE_AUTOBUILD =
  String(process.env.STAR_ATLAS_ARCHIVE_AUTOBUILD || "true").toLowerCase() !== "false";
const STAR_ATLAS_ARCHIVE_WEEKLY_DAYS = Number(
  process.env.STAR_ATLAS_ARCHIVE_WEEKLY_DAYS || 7,
);
const NEWS_ARCHIVE_FILE = resolve(API_ROOT_DIR, "data", "news-archive.json");
const BRIDGE_AUDIT_FILE = resolve(API_ROOT_DIR, "data", "bridge-audit-log.json");
const BRIDGE_ACCESS_FILE = resolve(API_ROOT_DIR, "data", "bridge-access.json");
const WALLET_AUTH_USERS_FILE = resolve(API_ROOT_DIR, "data", "wallet-auth-users.json");
const DEFAULT_WALLET_AUTH_ADMIN_WALLETS = [
  "YQmg9nTsvVLUgtj35pY8WUPRVGHaz7KfmaCgPuS6bwY",
];
const WALLET_AUTH_ADMIN_WALLETS = new Set(
  parseWalletAllowlist(
    process.env.WALLET_AUTH_ADMIN_WALLETS,
    DEFAULT_WALLET_AUTH_ADMIN_WALLETS,
  ),
);
const DEV_ADMIN_PASSWORD_LOGIN_ENABLED =
  String(process.env.DEV_ADMIN_PASSWORD_LOGIN_ENABLED || "false").toLowerCase() ===
  "true";
const DEV_ADMIN_PASSWORD = String(process.env.DEV_ADMIN_PASSWORD || "").trim();
const DEV_ADMIN_WALLET = normalizeWalletAddress(
  process.env.DEV_ADMIN_WALLET || DEFAULT_WALLET_AUTH_ADMIN_WALLETS[0] || "",
);

if (DEV_ADMIN_PASSWORD_LOGIN_ENABLED && isValidSolanaWallet(DEV_ADMIN_WALLET)) {
  WALLET_AUTH_ADMIN_WALLETS.add(DEV_ADMIN_WALLET);
}

function parseDurationMs(value: string | undefined, fallbackMs: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackMs;
  }
  return Math.floor(parsed);
}

const INTEL_CACHE_TTL_MS = parseDurationMs(
  process.env.INTEL_CACHE_TTL_MS,
  5 * 60 * 1000,
);
const NEWS_ARCHIVE_CACHE_TTL_MS = parseDurationMs(
  process.env.NEWS_ARCHIVE_CACHE_TTL_MS,
  5 * 60 * 1000,
);
const WALLET_AUTH_CHALLENGE_TTL_MS = parseDurationMs(
  process.env.WALLET_AUTH_CHALLENGE_TTL_MS,
  15 * 60 * 1000,
);
const WALLET_AUTH_SESSION_TTL_MS = parseDurationMs(
  process.env.WALLET_AUTH_SESSION_TTL_MS,
  7 * 24 * 60 * 60 * 1000,
);
const UPSTASH_REDIS_REST_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
const UPSTASH_REDIS_REST_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const CACHE_KEY_PREFIX = (process.env.CACHE_KEY_PREFIX || "star-atlas:cache").trim();
const SHARED_CACHE_ENABLED = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

function isMatchingDevAdminPassword(password: string) {
  const expected = Buffer.from(DEV_ADMIN_PASSWORD, "utf-8");
  const provided = Buffer.from(password, "utf-8");

  if (!expected.length || provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const intelOverviewCache = new Map<number, CacheEntry<IntelOverview>>();
const newsArchiveCache = new Map<number, CacheEntry<NewsArchiveResponse>>();
let bridgeAuditStore: BridgeAuditEvent[] = [];
let bridgeAccessStore: BridgeAccessEntry[] = [];
let walletAuthUsersStore: WalletAuthUser[] = [];
const walletAuthChallengeStore = new Map<string, WalletAuthChallenge>();
const walletAuthSessionStore = new Map<string, WalletAuthSession>();

function readCache<T>(cache: Map<number, CacheEntry<T>>, key: number) {
  const now = Date.now();
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function writeCache<T>(
  cache: Map<number, CacheEntry<T>>,
  key: number,
  value: T,
  ttlMs: number,
) {
  if (ttlMs <= 0) {
    return;
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function clearNewsArchiveCache() {
  newsArchiveCache.clear();
  void clearSharedCacheByScope("news_archive");
}

function buildSharedCacheKey(scope: string, key: number) {
  return `${CACHE_KEY_PREFIX}:${scope}:${key}`;
}

async function upstashCommand<T>(command: string[]) {
  if (!SHARED_CACHE_ENABLED) {
    return null as T | null;
  }

  try {
    const response = await fetch(UPSTASH_REDIS_REST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      return null as T | null;
    }

    const payload = (await response.json()) as { result?: T };
    return payload.result ?? null;
  } catch {
    return null as T | null;
  }
}

async function readSharedCache<T>(scope: string, key: number) {
  const cacheKey = buildSharedCacheKey(scope, key);
  const raw = await upstashCommand<string>(["GET", cacheKey]);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeSharedCache<T>(scope: string, key: number, value: T, ttlMs: number) {
  if (ttlMs <= 0) {
    return;
  }

  const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
  const cacheKey = buildSharedCacheKey(scope, key);
  const serialized = JSON.stringify(value);
  await upstashCommand(["SET", cacheKey, serialized, "EX", String(ttlSeconds)]);
}

async function clearSharedCacheByScope(scope: string) {
  if (!SHARED_CACHE_ENABLED) {
    return;
  }

  const pattern = `${CACHE_KEY_PREFIX}:${scope}:*`;
  const keys = await upstashCommand<string[]>(["KEYS", pattern]);
  if (!keys || keys.length === 0) {
    return;
  }

  await Promise.all(keys.map((key) => upstashCommand(["DEL", key])));
}

let newsArchiveSyncInFlight: Promise<void> | null = null;

function stripHtmlTags(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithMeta(
  url: string,
  timeoutMs = 9000,
  headers?: Record<string, string>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StarAtlasIntelBot/1.0 (+https://staratlas.com)",
        ...(headers || {}),
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      text,
    };
  } catch {
    return {
      ok: false,
      statusCode: undefined,
      text: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractMediumItems(xml: string, limit: number): IntelItem[] {
  const matches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));
  return matches.slice(0, limit).map((match) => {
    const chunk = match[1] || "";
    const title = stripHtmlTags(chunk.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const url = stripHtmlTags(chunk.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
    const publishedAtRaw = stripHtmlTags(
      chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
    );
    const summary = stripHtmlTags(
      chunk.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "",
    ).slice(0, 220);

    return {
      source: "medium",
      title: title || "Medium update",
      url,
      publishedAt: toIsoDateString(publishedAtRaw),
      summary,
    };
  });
}

function extractXRssItems(xml: string, limit: number): IntelItem[] {
  const matches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));
  return matches.slice(0, limit).map((match) => {
    const chunk = match[1] || "";
    const title = stripHtmlTags(chunk.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const url = stripHtmlTags(chunk.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
    const publishedAtRaw = stripHtmlTags(
      chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
    );
    const summary = stripHtmlTags(
      chunk.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "",
    ).slice(0, 220);

    return {
      source: "x" as const,
      title: title || "X update from @staratlas",
      url,
      publishedAt: toIsoDateString(publishedAtRaw),
      summary,
    };
  });
}

function toIsoDateString(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function isWithinLastHours(value: string | undefined, hours: number) {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return parsed.getTime() >= cutoff;
}

function countBySource(items: IntelItem[]) {
  return items.reduce<Record<IntelSourceKey, number>>(
    (acc, item) => {
      acc[item.source] += 1;
      return acc;
    },
    { official: 0, medium: 0, x: 0, discord: 0 },
  );
}

function extractXItems(pageText: string, limit: number): IntelItem[] {
  const matches = Array.from(pageText.matchAll(/https:\/\/x\.com\/staratlas\/status\/(\d+)/g));
  const seen = new Set<string>();
  const items: IntelItem[] = [];

  for (const match of matches) {
    const statusId = match[1];
    if (!statusId || seen.has(statusId)) {
      continue;
    }
    seen.add(statusId);

    const idx = match.index || 0;
    const start = Math.max(0, idx - 260);
    const end = Math.min(pageText.length, idx + 220);
    const nearby = pageText.slice(start, end);
    const summary = nearby
      .replace(/\s+/g, " ")
      .replace(/\[.*?\]/g, "")
      .trim()
      .slice(0, 220);

    items.push({
      source: "x",
      title: summary ? `X update: ${summary}` : "X update from @staratlas",
      url: `https://x.com/staratlas/status/${statusId}`,
      summary,
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function extractDiscordNote(pageText: string) {
  const networkMatch = pageText.match(/([\d\s.,]+)\s+(?:в сети|Online)/i);
  const membersMatch = pageText.match(/([\d\s.,]+)\s+(?:участник|members?)/i);

  const online = networkMatch?.[1]?.trim();
  const members = membersMatch?.[1]?.trim();

  if (online || members) {
    return `Discord: online ${online || "n/a"}, members ${members || "n/a"}`;
  }

  return "Discord invite page reachable";
}

type DiscordApiMessage = {
  id?: string;
  content?: string;
  timestamp?: string;
  guild_id?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
  }>;
};

function buildDiscordMessageLink(channelId: string, message: DiscordApiMessage) {
  const guildId = message.guild_id || STAR_ATLAS_DISCORD_GUILD_ID;
  return `https://discord.com/channels/${guildId || "@me"}/${channelId}/${message.id || ""}`;
}

function extractDiscordMessageText(message: DiscordApiMessage) {
  const base = (message.content || "").trim();
  if (base) {
    return base;
  }

  const firstEmbed = message.embeds?.[0];
  const embedText = [firstEmbed?.title || "", firstEmbed?.description || ""]
    .join(" ")
    .trim();
  return embedText;
}

function extractDiscordItems(
  channelId: string,
  messages: DiscordApiMessage[],
  limit: number,
): IntelItem[] {
  const items: IntelItem[] = [];

  for (const message of messages) {
    if (!message.id) {
      continue;
    }

    const text = extractDiscordMessageText(message);
    const publishedAt = toIsoDateString(message.timestamp);

    items.push({
      source: "discord",
      title: text ? `Discord: ${text.slice(0, 80)}` : "Discord update",
      url: buildDiscordMessageLink(channelId, message),
      publishedAt,
      summary: text ? text.slice(0, 260) : "Сообщение без текста (embed/вложение).",
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

async function fetchDiscordItems(limit: number, windowHours = 24) {
  if (!STAR_ATLAS_DISCORD_BOT_TOKEN || STAR_ATLAS_DISCORD_CHANNEL_IDS.length === 0) {
    return {
      configured: false,
      ok: false,
      statusCode: undefined as number | undefined,
      note: "Discord Bot API не настроен (ожидаются STAR_ATLAS_DISCORD_BOT_TOKEN и STAR_ATLAS_DISCORD_CHANNEL_IDS)",
      items: [] as IntelItem[],
    };
  }

  const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;

  async function fetchChannelWindow(channelId: string) {
    const maxPages = 10;
    let beforeId: string | undefined;
    let firstStatus: number | undefined;
    let ok = false;
    const messages: DiscordApiMessage[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const beforeQuery = beforeId ? `&before=${beforeId}` : "";
      const response = await fetchWithMeta(
        `${DISCORD_API_BASE}/channels/${channelId}/messages?limit=100${beforeQuery}`,
        9000,
        {
          Authorization: `Bot ${STAR_ATLAS_DISCORD_BOT_TOKEN}`,
        },
      );

      if (firstStatus === undefined) {
        firstStatus = response.statusCode;
      }

      if (!response.ok) {
        return {
          channelId,
          ok: false,
          statusCode: firstStatus,
          messages: [] as DiscordApiMessage[],
        };
      }

      ok = true;

      let parsed: DiscordApiMessage[] = [];
      try {
        const payload = JSON.parse(response.text) as DiscordApiMessage[];
        if (Array.isArray(payload)) {
          parsed = payload;
        }
      } catch {
        parsed = [];
      }

      if (parsed.length === 0) {
        break;
      }

      let reachedOlderMessages = false;
      for (const message of parsed) {
        const ts = new Date(message.timestamp || 0).getTime();
        if (!Number.isNaN(ts) && ts >= cutoffMs) {
          messages.push(message);
        } else {
          reachedOlderMessages = true;
        }
      }

      beforeId = parsed[parsed.length - 1]?.id;
      if (!beforeId || parsed.length < 100 || reachedOlderMessages) {
        break;
      }
    }

    return {
      channelId,
      ok,
      statusCode: firstStatus,
      messages,
    };
  }

  const channelResponses = await Promise.all(
    STAR_ATLAS_DISCORD_CHANNEL_IDS.map((channelId) => fetchChannelWindow(channelId)),
  );

  let anyOk = false;
  let firstStatus: number | undefined;
  const items: IntelItem[] = [];

  for (const { channelId, ok, statusCode, messages } of channelResponses) {
    if (firstStatus === undefined) {
      firstStatus = statusCode;
    }

    if (!ok) {
      continue;
    }

    anyOk = true;
    items.push(...extractDiscordItems(channelId, messages, messages.length || limit));
  }

  const uniqueItemsSorted = Array.from(
    new Map(items.map((item) => [item.url, item])).values(),
  ).sort((left, right) => {
    const leftTime = new Date(left.publishedAt || 0).getTime();
    const rightTime = new Date(right.publishedAt || 0).getTime();
    return rightTime - leftTime;
  });

  return {
    configured: true,
    ok: anyOk,
    statusCode: firstStatus,
    note: anyOk
      ? `Discord Bot API active: ${STAR_ATLAS_DISCORD_CHANNEL_IDS.length} channel(s), ${uniqueItemsSorted.length} message(s) fetched in last ${windowHours}h`
      : "Discord Bot API configured, but no channel responses were readable (check permissions/channel IDs)",
    items: uniqueItemsSorted,
  };
}

async function buildIntelOverview(limit: number): Promise<IntelOverview> {
  const safeLimit = Math.max(3, Math.min(limit, 30));
  const windowHours = 24;
  const nowIso = new Date().toISOString();

  const [
    officialMain,
    officialNews,
    officialCommunity,
    mediumRss,
    xPage,
    xRss,
    discordPage,
  ] =
    await Promise.all([
      fetchWithMeta(STAR_ATLAS_OFFICIAL_URL),
      fetchWithMeta(STAR_ATLAS_NEWS_URL),
      fetchWithMeta(STAR_ATLAS_COMMUNITY_URL),
      fetchWithMeta(STAR_ATLAS_MEDIUM_RSS_URL),
      fetchWithMeta(STAR_ATLAS_X_URL),
      fetchWithMeta(STAR_ATLAS_X_RSS_URL),
      fetchWithMeta(STAR_ATLAS_DISCORD_INVITE_URL),
    ]);

  const sourceOfficial: IntelSourceStatus = {
    key: "official",
    url: STAR_ATLAS_OFFICIAL_URL,
    ok: officialMain.ok,
    statusCode: officialMain.statusCode,
    note:
      officialNews.ok && officialCommunity.ok
        ? "Main site and dedicated sections are reachable"
        : `Main site reachable=${officialMain.ok}; news=${officialNews.statusCode || "n/a"}; community=${officialCommunity.statusCode || "n/a"}`,
  };

  const mediumItems = mediumRss.ok ? extractMediumItems(mediumRss.text, safeLimit) : [];
  const xRssItems = xRss.ok ? extractXRssItems(xRss.text, safeLimit) : [];
  const xItems = xRssItems.length
    ? xRssItems
    : xPage.ok
      ? extractXItems(xPage.text, safeLimit)
      : [];
  const discordApi = await fetchDiscordItems(Math.min(60, safeLimit * 3));
  const discordNote = extractDiscordNote(discordPage.text);

  const sourceMedium: IntelSourceStatus = {
    key: "medium",
    url: STAR_ATLAS_MEDIUM_RSS_URL,
    ok: mediumRss.ok,
    statusCode: mediumRss.statusCode,
    note: mediumItems.length
      ? `Parsed ${mediumItems.length} latest publication(s)`
      : "No Medium items parsed",
  };

  const sourceX: IntelSourceStatus = {
    key: "x",
    url: STAR_ATLAS_X_URL,
    ok: xPage.ok || xRss.ok,
    statusCode: xRss.ok ? xRss.statusCode : xPage.statusCode,
    note: xRssItems.length
      ? `Parsed ${xRssItems.length} latest publication(s) from RSS`
      : xItems.length
        ? `Parsed ${xItems.length} post link(s) from profile page`
        : "No X posts parsed",
  };

  const sourceDiscord: IntelSourceStatus = {
    key: "discord",
    url: STAR_ATLAS_DISCORD_INVITE_URL,
    ok: discordApi.configured ? discordApi.ok : discordPage.ok,
    statusCode: discordApi.configured ? discordApi.statusCode : discordPage.statusCode,
    note: discordApi.configured
      ? discordApi.note
      : `${discordNote}. Для новостей за 24ч настройте Discord Bot API переменные окружения.`,
  };

  const rawItems: IntelItem[] = [
    ...mediumItems,
    ...xItems,
    ...discordApi.items,
  ];

  const allItems24h = rawItems
    .filter((item) => isWithinLastHours(item.publishedAt, windowHours))
    .sort((left, right) => {
      const leftTime = new Date(left.publishedAt || 0).getTime();
      const rightTime = new Date(right.publishedAt || 0).getTime();
      return rightTime - leftTime;
    });

  const sourceStats24h = countBySource(allItems24h);
  const items24h = allItems24h.slice(0, safeLimit);

  const highlights = [
    `За последние ${windowHours} часа: Medium — ${sourceStats24h.medium}, X — ${sourceStats24h.x}, Discord — ${sourceStats24h.discord}, Official — ${sourceStats24h.official}.`,
    sourceStats24h.medium > 0
      ? "Medium канал дал публикации за последние сутки."
      : "Новых Medium-публикаций за последние сутки не найдено.",
    sourceStats24h.x > 0
      ? "X канал активен за последние сутки (используется RSS/page fallback)."
      : "Новых X-постов за последние сутки не найдено.",
    sourceStats24h.discord > 0
      ? `Discord канал активен: найдено ${sourceStats24h.discord} сообщение(й) за последние сутки.`
      : discordApi.configured
        ? "Discord Bot API подключен, но сообщений за последние сутки не найдено."
        : `Discord invite reachable=${discordPage.ok}. ${discordNote}. Для контента нужна настройка Bot API.`,
  ];

  const conclusions = [
    sourceStats24h.medium + sourceStats24h.x > 0
      ? "Коммуникации проекта за последние сутки выглядят активными в публичных каналах."
      : "Публичная коммуникация за последние сутки слабая, проверьте обновление позже.",
    officialNews.ok && officialCommunity.ok
      ? "Разделы официального сайта доступны и подходят для прямого трекинга."
      : "Часть официальных разделов недоступна; используйте Medium/X/Discord как основные источники.",
    "Сначала оценивайте этот 24-часовой анализ, затем переходите к списку новостей и ссылок ниже.",
  ];

  return {
    generatedAt: nowIso,
    windowHours,
    sources: [sourceOfficial, sourceMedium, sourceX, sourceDiscord],
    sourceStats24h,
    highlights,
    conclusions,
    items: items24h,
  };
}

async function readNewsArchiveEntries() {
  try {
    const raw = await readFile(NEWS_ARCHIVE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: NewsArchiveEntry[] };
    if (Array.isArray(parsed.entries)) {
      return parsed.entries;
    }
    return [] as NewsArchiveEntry[];
  } catch {
    return [] as NewsArchiveEntry[];
  }
}

async function writeNewsArchiveEntries(entries: NewsArchiveEntry[]) {
  await mkdir(dirname(NEWS_ARCHIVE_FILE), { recursive: true });
  await writeFile(
    NEWS_ARCHIVE_FILE,
    JSON.stringify({ entries }, null, 2),
    "utf-8",
  );
}

async function readBridgeAuditEvents() {
  try {
    const raw = await readFile(BRIDGE_AUDIT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { events?: BridgeAuditEvent[] };
    if (Array.isArray(parsed.events)) {
      return parsed.events;
    }
    return [] as BridgeAuditEvent[];
  } catch {
    return [] as BridgeAuditEvent[];
  }
}

async function readBridgeAccessEntries() {
  try {
    const raw = await readFile(BRIDGE_ACCESS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: BridgeAccessEntry[] };
    if (Array.isArray(parsed.entries)) {
      return parsed.entries
        .map((entry) => ({
          wallet: String(entry.wallet || "").trim(),
          grantedAt: String(entry.grantedAt || ""),
          grantedBy: String(entry.grantedBy || "").trim(),
        }))
        .filter((entry) => entry.wallet && isValidSolanaWallet(entry.wallet));
    }
    return [] as BridgeAccessEntry[];
  } catch {
    return [] as BridgeAccessEntry[];
  }
}

async function writeBridgeAccessEntries(entries: BridgeAccessEntry[]) {
  await mkdir(dirname(BRIDGE_ACCESS_FILE), { recursive: true });
  await writeFile(
    BRIDGE_ACCESS_FILE,
    JSON.stringify({ entries }, null, 2),
    "utf-8",
  );
}

async function ensureBridgeAccessSeed() {
  const now = new Date().toISOString();
  let changed = false;

  for (const adminWallet of WALLET_AUTH_ADMIN_WALLETS) {
    if (!bridgeAccessStore.some((entry) => entry.wallet === adminWallet)) {
      bridgeAccessStore.push({
        wallet: adminWallet,
        grantedAt: now,
        grantedBy: adminWallet,
      });
      changed = true;
    }
  }

  if (changed) {
    await writeBridgeAccessEntries(bridgeAccessStore);
  }
}

async function writeBridgeAuditEvents(events: BridgeAuditEvent[]) {
  await mkdir(dirname(BRIDGE_AUDIT_FILE), { recursive: true });
  await writeFile(
    BRIDGE_AUDIT_FILE,
    JSON.stringify({ events }, null, 2),
    "utf-8",
  );
}

async function readWalletAuthUsers() {
  try {
    const raw = await readFile(WALLET_AUTH_USERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { users?: WalletAuthUser[] };
    if (Array.isArray(parsed.users)) {
      return parsed.users;
    }
    return [] as WalletAuthUser[];
  } catch {
    return [] as WalletAuthUser[];
  }
}

async function writeWalletAuthUsers(users: WalletAuthUser[]) {
  await mkdir(dirname(WALLET_AUTH_USERS_FILE), { recursive: true });
  await writeFile(
    WALLET_AUTH_USERS_FILE,
    JSON.stringify({ users }, null, 2),
    "utf-8",
  );
}

async function appendBridgeAuditEvent(event: BridgeAuditEvent) {
  bridgeAuditStore = [event, ...bridgeAuditStore].slice(0, 500);
  await writeBridgeAuditEvents(bridgeAuditStore);
}

function formatRuDate(value: Date) {
  return value.toLocaleDateString("ru-RU");
}

function buildThemeTags(items: IntelItem[]) {
  const dictionary: Array<{ tag: string; words: string[] }> = [
    { tag: "SAGE", words: ["sage", "holosim", "labs"] },
    { tag: "Экономика", words: ["economy", "market", "atlas", "polis", "token"] },
    { tag: "Флот", words: ["fleet", "ship", "repair", "combat", "arena"] },
    { tag: "Комьюнити", words: ["community", "discord", "event", "announce"] },
  ];

  const text = items
    .map((item) => `${item.title} ${item.summary || ""}`.toLowerCase())
    .join(" ");

  const tags = dictionary
    .filter((entry) => entry.words.some((word) => text.includes(word)))
    .map((entry) => entry.tag);

  return tags.length ? tags : ["Star Atlas", "Новости"];
}

function simplifyTitle(title: string) {
  const normalized = title
    .replace(/^Discord:\s*/i, "")
    .replace(/@everyone|@here/gi, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/#+\s*/g, "")
    .replace(/^[-:|/\\\s]+|[-:|/\\\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = normalized.toLowerCase();
  if (
    lower.includes("#📢┃announcements") ||
    lower.includes("#📢┃minor-announcements") ||
    lower.includes("📢┃announcements") ||
    lower.includes("📢┃minor-announcements") ||
    lower === "star atlas announcements"
  ) {
    return "Официальный анонс в Discord";
  }

  return normalized || "Без названия";
}

function isLikelyNoiseSignal(item: IntelItem) {
  const title = simplifyTitle(item.title).toLowerCase();
  const summary = (item.summary || "").toLowerCase();
  const text = `${title} ${summary}`;

  if (!title || title.length < 8) {
    return true;
  }

  const noisePatterns = [
    "original message deleted",
    "message deleted",
    "minor-announcements",
    "test",
    "gm",
    "итоговое заключение",
    "главные проблемы",
    "сценарий",
    "текущее состояние проекта",
    "коротко:",
  ];

  if (noisePatterns.some((pattern) => text.includes(pattern))) {
    return true;
  }

  if (item.source === "discord" && title.includes("@everyone") && title.length < 28) {
    return true;
  }

  if (item.source === "discord" && /^[⭐🔮❌]/.test(title)) {
    return true;
  }

  return false;
}

type ThemeBucket = "gameplay" | "economy" | "ecosystem";

function classifyTheme(item: IntelItem): ThemeBucket {
  const text = `${item.title} ${item.summary || ""}`.toLowerCase();

  if (
    ["econom", "atlas", "rebase", "reward", "prize", "token", "xp"].some((word) =>
      text.includes(word),
    )
  ) {
    return "economy";
  }

  if (
    ["z.ink", "open sourcing", "star frame", "svm", "chain", "infrastructure"].some(
      (word) => text.includes(word),
    )
  ) {
    return "ecosystem";
  }

  return "gameplay";
}

function buildThematicChapters(items: IntelItem[]) {
  const buckets: Record<ThemeBucket, IntelItem[]> = {
    gameplay: [],
    economy: [],
    ecosystem: [],
  };

  for (const item of items) {
    buckets[classifyTheme(item)].push(item);
  }

  const lines: string[] = ["Тематические главы периода:"];
  const sections: Array<{ key: ThemeBucket; title: string }> = [
    { key: "gameplay", title: "1. Геймплей и релизный контур" },
    { key: "economy", title: "2. Экономика и удержание" },
    { key: "ecosystem", title: "3. Экосистема и инфраструктура" },
  ];

  for (const section of sections) {
    const events = buckets[section.key];
    const top = events[0];
    if (!top) {
      lines.push(`${section.title}: значимых сигналов в периоде не обнаружено.`);
      continue;
    }
    lines.push(
      `${section.title}: ${events.length} сигнал(ов). Реперная точка — ${simplifyTitle(top.title)}.`,
    );
  }

  return lines;
}

function scoreEvent(item: IntelItem) {
  const text = `${item.title} ${item.summary || ""}`.toLowerCase();
  let score = 0;

  const priorityWords = [
    "release",
    "chapter",
    "season",
    "report",
    "town hall",
    "open sourcing",
    "airdrop",
    "rebase",
    "announcing",
    "update",
    "holosim",
    "starcomm",
  ];

  for (const word of priorityWords) {
    if (text.includes(word)) {
      score += 2;
    }
  }

  if (item.source === "medium") {
    score += 2;
  }
  if (item.source === "discord") {
    score += 1;
  }

  const ts = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
  if (ts > 0) {
    score += ts / 1_000_000_000_000;
  }

  return score;
}

function pickImportantEvents(items: IntelItem[], maxItems: number) {
  const sorted = [...items]
    .map((item) => ({ item, score: scoreEvent(item) }))
    .sort((left, right) => right.score - left.score);

  const result: IntelItem[] = [];
  const seen = new Set<string>();
  for (const candidate of sorted) {
    const key = simplifyTitle(candidate.item.title).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate.item);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function buildResourceLinks(items: IntelItem[]) {
  const links = new Set<string>([
    STAR_ATLAS_OFFICIAL_URL,
    STAR_ATLAS_DISCORD_INVITE_URL,
    STAR_ATLAS_MEDIUM_RSS_URL,
    STAR_ATLAS_X_URL,
  ]);

  for (const item of items.slice(0, 12)) {
    links.add(item.url);
  }

  return Array.from(links).filter(Boolean);
}

function buildArchiveContent(
  kind: NewsArchiveEntryType,
  periodStart: Date,
  periodEnd: Date,
  items: IntelItem[],
  sourceStats: Record<IntelSourceKey, number>,
) {
  const filteredItems = items.filter((item) => !isLikelyNoiseSignal(item));
  const effectiveItems = filteredItems.length >= Math.min(5, items.length) ? filteredItems : items;

  const header =
    kind === "genesis"
      ? `Первая статья архива. Сводный обзор доступных сигналов Star Atlas с ${formatRuDate(periodStart)} по ${formatRuDate(periodEnd)}.`
      : `Еженедельный обзор Star Atlas за период ${formatRuDate(periodStart)} - ${formatRuDate(periodEnd)}.`;

  const sourceLine = `Источник сигналов: Medium ${sourceStats.medium}, X ${sourceStats.x}, Discord ${sourceStats.discord}, Official ${sourceStats.official}.`;
  const sourceLeaders = [
    { source: "Discord", value: sourceStats.discord },
    { source: "Medium", value: sourceStats.medium },
    { source: "X", value: sourceStats.x },
    { source: "Official", value: sourceStats.official },
  ].sort((left, right) => right.value - left.value);

  const executiveSummary =
    effectiveItems.length > 0
      ? [
          "Executive summary (60 секунд):",
          `1. После антишум-фильтра в анализ вошло ${effectiveItems.length} сигналов из ${items.length} собранных.`,
          `2. Ведущий канал периода: ${sourceLeaders[0]?.source || "не определен"} (${sourceLeaders[0]?.value || 0} сигналов).`,
          "3. Главный паттерн: проект поддерживает live-ритм через релизные апдейты, экономические активности и инфраструктурные анонсы.",
        ]
      : [
          "Executive summary (60 секунд):",
          "1. За период не найдено достаточно чистых сигналов для аналитического вывода.",
          "2. Рекомендуется расширить выборку источников и пересинхронизировать архив.",
        ];

  const importantEvents = pickImportantEvents(effectiveItems, 6);
  const chronologicalSignals = effectiveItems.slice(0, 12).map((item, index) => {
    const date = item.publishedAt
      ? new Date(item.publishedAt).toLocaleString("ru-RU")
      : "дата не указана";
    return `${index + 1}. [${item.source.toUpperCase()}] ${simplifyTitle(item.title)} (${date})\n${item.url}`;
  });

  const importantSignals = importantEvents.map((item, index) => {
    const date = item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString("ru-RU")
      : "дата не указана";
    return `${index + 1}. ${simplifyTitle(item.title)} (${date})\n${item.url}`;
  });

  const links = buildResourceLinks(effectiveItems)
    .slice(0, 14)
    .map((link, index) => `${index + 1}. ${link}`);
  const thematicChapters = buildThematicChapters(effectiveItems);

  const overallConclusion =
    effectiveItems.length > 0
      ? [
          "Большой итог по проекту:",
          "Star Atlas проходит длинный цикл развития через регулярные релизы, экономические апдейты и сезонные активности комьюнити.",
          "По массиву сигналов видно, что ключевая коммуникация сосредоточена в Discord и поддерживается официальными публикациями в Medium.",
          "Фокус последних этапов: Holosim/SAGE-геймплей, устойчивость экономической модели и удержание игроков через регулярные события и кампании.",
          "Стратегически проект движется в сторону более зрелой live-операции с ритмом продуктовых обновлений и усилением ончейн-экосистемы.",
        ]
      : [
          "Большой итог по проекту:",
          "За выбранный период новых сигналов не обнаружено, поэтому для содержательного анализа требуется расширение источников и диапазона данных.",
        ];

  const analyticalBlock =
    effectiveItems.length > 0
      ? [
          "ИИ-анализ ключевых паттернов:",
          "1. Информационный поток устойчивый и событийный: преобладают релизные и операционные апдейты.",
          "2. Экономические и сезонные события используются как основной драйвер активности сообщества.",
          "3. Для продуктовой команды критично держать синхронизацию roadmap -> комьюнити -> in-game активации.",
        ]
      : [
          "ИИ-анализ ключевых паттернов:",
          "1. За указанный период новых сообщений не обнаружено.",
          "2. Рекомендуется расширить список источников и проверить права доступа к каналам.",
        ];

  return [
    header,
    sourceLine,
    "",
    ...executiveSummary,
    "",
    "Самые важные события:",
    ...(importantSignals.length > 0 ? importantSignals : ["1. Ключевые события не найдены в выбранном периоде."]),
    "",
    ...thematicChapters,
    "",
    ...analyticalBlock,
    "",
    ...overallConclusion,
    "",
    "Ссылки на ресурсы новостей:",
    ...links,
    "",
    "Хронология сигналов:",
    ...chronologicalSignals,
  ].join("\n");
}

function sortByPeriodEndDesc(entries: NewsArchiveEntry[]) {
  return [...entries].sort(
    (left, right) =>
      new Date(right.periodEnd).getTime() - new Date(left.periodEnd).getTime(),
  );
}

async function buildArchiveEntry(
  kind: NewsArchiveEntryType,
  periodStart: Date,
  periodEnd: Date,
) {
  const windowHours = Math.max(
    24,
    Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (60 * 60 * 1000)),
  );
  const discordSignals = await fetchDiscordItems(1200, windowHours + 24);
  const mediumRss = await fetchWithMeta(STAR_ATLAS_MEDIUM_RSS_URL);
  const xPage = await fetchWithMeta(STAR_ATLAS_X_URL);
  const xRss = await fetchWithMeta(STAR_ATLAS_X_RSS_URL);

  const mediumItems = mediumRss.ok ? extractMediumItems(mediumRss.text, 200) : [];
  const xRssItems = xRss.ok ? extractXRssItems(xRss.text, 200) : [];
  const xItems = xRssItems.length ? xRssItems : xPage.ok ? extractXItems(xPage.text, 200) : [];

  const rangeItems = [...mediumItems, ...xItems, ...discordSignals.items]
    .filter((item) => {
      if (!item.publishedAt) {
        return false;
      }
      const ts = new Date(item.publishedAt).getTime();
      return ts >= periodStart.getTime() && ts <= periodEnd.getTime();
    })
    .sort(
      (left, right) =>
        new Date(right.publishedAt || 0).getTime() -
        new Date(left.publishedAt || 0).getTime(),
    );

  const uniqueItems = Array.from(
    new Map(rangeItems.map((item) => [item.url, item])).values(),
  );

  const sourceStats = countBySource(uniqueItems);
  const totalSignals = uniqueItems.length;
  const tags = buildThemeTags(uniqueItems);
  const title =
    kind === "genesis"
      ? "Star Atlas: Историческая Первая Статья Архива"
      : `Star Atlas Weekly Archive: ${formatRuDate(periodStart)} - ${formatRuDate(periodEnd)}`;
  const summary =
    totalSignals > 0
      ? `За период найдено ${totalSignals} сигналов. Discord: ${sourceStats.discord}, Medium: ${sourceStats.medium}, X: ${sourceStats.x}.`
      : "За период не найдено новых сигналов в доступных источниках.";

  return {
    id: `${kind}-${periodEnd.getTime()}`,
    type: kind,
    title,
    summary,
    content: buildArchiveContent(kind, periodStart, periodEnd, uniqueItems, sourceStats),
    generatedAt: new Date().toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    sourceStats,
    totalSignals,
    tags,
  } satisfies NewsArchiveEntry;
}

async function syncNewsArchiveIfNeeded(options?: { forceGenesis?: boolean }) {
  if (!STAR_ATLAS_ARCHIVE_AUTOBUILD) {
    return;
  }

  if (newsArchiveSyncInFlight) {
    await newsArchiveSyncInFlight;
    return;
  }

  newsArchiveSyncInFlight = (async () => {
    let entries = await readNewsArchiveEntries();

    const forceGenesis = Boolean(options?.forceGenesis);

    if (entries.length === 0 || forceGenesis) {
      const genesis = await buildArchiveEntry(
        "genesis",
        new Date("2020-01-01T00:00:00.000Z"),
        new Date(),
      );
      entries = [
        genesis,
        ...entries.filter((entry) => entry.type !== "genesis"),
      ];
    } else {
      const hasLegacyGenesis = entries.some(
        (entry) =>
          entry.type === "genesis" &&
          !entry.content.toLowerCase().includes("самые важные события"),
      );
      if (hasLegacyGenesis) {
        const upgradedGenesis = await buildArchiveEntry(
          "genesis",
          new Date("2020-01-01T00:00:00.000Z"),
          new Date(),
        );
        entries = [
          upgradedGenesis,
          ...entries.filter((entry) => entry.type !== "genesis"),
        ];
      }
    }

    const weeklyMs = Math.max(1, STAR_ATLAS_ARCHIVE_WEEKLY_DAYS) * 24 * 60 * 60 * 1000;
    const sorted = sortByPeriodEndDesc(entries);
    let cursor = new Date(sorted[0]?.periodEnd || Date.now());
    const now = new Date();

    while (now.getTime() - cursor.getTime() >= weeklyMs) {
      const next = new Date(cursor.getTime() + weeklyMs);
      const weekly = await buildArchiveEntry("weekly", cursor, next);
      entries.push(weekly);
      cursor = next;
    }

    const unique = Array.from(
      new Map(sortByPeriodEndDesc(entries).map((entry) => [entry.id, entry])).values(),
    );
    await writeNewsArchiveEntries(unique);
    clearNewsArchiveCache();
  })().finally(() => {
    newsArchiveSyncInFlight = null;
  });

  await newsArchiveSyncInFlight;
}

app.register(cors, {
  origin: true,
});

app.get("/", async () => {
  return {
    service: "star-atlas-api",
    status: "ok",
    endpoints: {
      health: "/health",
      dashboardExample: "/api/dashboard/pilot",
      walletDashboardExample:
        "/api/dashboard/wallet/So11111111111111111111111111111111111111112",
      intelOverview: "/api/intel/overview",
      bridgeLiveMap: "/api/bridge/live-map",
      bridgeUpstreamSample: "/api/bridge/upstream-sample",
    },
  };
});

app.get<{
  Querystring: {
    role?: string;
    profile?: string;
    wallet?: string;
    windowMinutes?: number;
  };
}>("/api/bridge/upstream-sample", async (request, reply) => {
  const role = resolveBridgeRole(request.query.role);
  const profile = resolveBridgeProfile(request.query.profile);
  const wallet = normalizeWalletAddress(request.query.wallet || "So11111111111111111111111111111111111111112");
  const windowMinutes = clamp(Number(request.query.windowMinutes || 90), 5, 360);

  reply.header("cache-control", "no-store");
  return buildBridgeUpstreamSamplePayload({
    role,
    profile,
    wallet,
    windowMinutes,
  });
});

app.get(
  "/health",
  async () => ({
    status: "ok",
    service: "star-atlas-api",
    time: new Date().toISOString(),
    sharedCacheEnabled: SHARED_CACHE_ENABLED,
    cacheMode: SHARED_CACHE_ENABLED ? "upstash" : "memory",
    replica: process.env.RAILWAY_REPLICA_ID || "local",
    deployVersion: process.env.RAILWAY_GIT_COMMIT_SHA || "local",
  }),
);

app.post<{
  Body: {
    wallet?: string;
  };
}>("/api/auth/wallet/challenge", async (request, reply) => {
  pruneWalletAuthStores();

  const wallet = normalizeWalletAddress(request.body?.wallet || "");
  if (!wallet || !isValidSolanaWallet(wallet)) {
    return reply.code(400).send({ error: "Valid Solana wallet is required" });
  }

  const challenge = createWalletChallenge(wallet);
  walletAuthChallengeStore.set(wallet, challenge);

  return {
    success: true,
    challenge,
    ttlMs: WALLET_AUTH_CHALLENGE_TTL_MS,
  };
});

app.post<{
  Body: {
    wallet?: string;
    challengeId?: string;
    signature?: string;
  };
}>("/api/auth/wallet/verify", async (request, reply) => {
  pruneWalletAuthStores();

  const wallet = normalizeWalletAddress(request.body?.wallet || "");
  const challengeId = String(request.body?.challengeId || "").trim();
  const signature = String(request.body?.signature || "").trim();

  if (!wallet || !isValidSolanaWallet(wallet)) {
    return reply.code(400).send({ error: "Valid Solana wallet is required" });
  }

  if (!challengeId || !signature) {
    return reply.code(400).send({ error: "challengeId and signature are required" });
  }

  const challenge = walletAuthChallengeStore.get(wallet);
  if (!challenge || challenge.challengeId !== challengeId) {
    return reply.code(400).send({ error: "Challenge not found or expired" });
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    walletAuthChallengeStore.delete(wallet);
    return reply.code(400).send({ error: "Challenge expired" });
  }

  const isValidSignature = verifyWalletSignature(wallet, challenge.message, signature);
  if (!isValidSignature) {
    return reply.code(401).send({ error: "Invalid wallet signature" });
  }

  walletAuthChallengeStore.delete(wallet);
  const { user, isNewRegistration } = upsertWalletAuthUser(wallet);
  await writeWalletAuthUsers(walletAuthUsersStore);
  const session = createWalletAuthSession(wallet);

  return {
    success: true,
    isNewRegistration,
    token: session.token,
    tokenType: "Bearer",
    expiresAt: session.expiresAt,
    user: {
      wallet: user.wallet,
      registeredAt: user.registeredAt,
      verifiedAt: user.verifiedAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
      isAdmin: isAdminWallet(user.wallet),
    },
  };
});

app.post<{
  Body: {
    wallet?: string;
    challengeId?: string;
    signedTransaction?: string;
  };
}>("/api/auth/wallet/verify-transaction", async (request, reply) => {
  pruneWalletAuthStores();

  const wallet = normalizeWalletAddress(request.body?.wallet || "");
  const challengeId = String(request.body?.challengeId || "").trim();
  const signedTransaction = String(request.body?.signedTransaction || "").trim();

  if (!wallet || !isValidSolanaWallet(wallet)) {
    return reply.code(400).send({ error: "Valid Solana wallet is required" });
  }

  if (!challengeId || !signedTransaction) {
    return reply
      .code(400)
      .send({ error: "challengeId and signedTransaction are required" });
  }

  const challenge = walletAuthChallengeStore.get(wallet);
  if (!challenge || challenge.challengeId !== challengeId) {
    return reply.code(400).send({ error: "Challenge not found or expired" });
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    walletAuthChallengeStore.delete(wallet);
    return reply.code(400).send({ error: "Challenge expired" });
  }

  const isValidSignedTransaction = verifyWalletAuthSignedTransaction(
    wallet,
    challengeId,
    challenge.nonce,
    signedTransaction,
  );
  if (!isValidSignedTransaction) {
    return reply.code(401).send({ error: "Invalid signed transaction for challenge" });
  }

  walletAuthChallengeStore.delete(wallet);
  const { user, isNewRegistration } = upsertWalletAuthUser(wallet);
  await writeWalletAuthUsers(walletAuthUsersStore);
  const session = createWalletAuthSession(wallet);

  return {
    success: true,
    isNewRegistration,
    token: session.token,
    tokenType: "Bearer",
    expiresAt: session.expiresAt,
    user: {
      wallet: user.wallet,
      registeredAt: user.registeredAt,
      verifiedAt: user.verifiedAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
      isAdmin: isAdminWallet(user.wallet),
    },
  };
});

app.post<{
  Body: {
    password?: string;
  };
}>("/api/auth/dev-admin/login", async (request, reply) => {
  pruneWalletAuthStores();

  if (!DEV_ADMIN_PASSWORD_LOGIN_ENABLED) {
    return reply.code(404).send({ error: "Not found" });
  }

  if (!DEV_ADMIN_PASSWORD || !isValidSolanaWallet(DEV_ADMIN_WALLET)) {
    request.log.error(
      "DEV_ADMIN_PASSWORD_LOGIN_ENABLED=true but DEV_ADMIN_PASSWORD/DEV_ADMIN_WALLET is invalid",
    );
    return reply.code(503).send({ error: "Dev admin login is misconfigured" });
  }

  const password = String(request.body?.password || "");
  if (!password.trim()) {
    return reply.code(400).send({ error: "password is required" });
  }

  if (!isMatchingDevAdminPassword(password)) {
    return reply.code(401).send({ error: "Invalid password" });
  }

  const { user, isNewRegistration } = upsertWalletAuthUser(DEV_ADMIN_WALLET);
  await writeWalletAuthUsers(walletAuthUsersStore);
  const session = createWalletAuthSession(user.wallet);

  return {
    success: true,
    isNewRegistration,
    token: session.token,
    tokenType: "Bearer",
    expiresAt: session.expiresAt,
    user: {
      wallet: user.wallet,
      registeredAt: user.registeredAt,
      verifiedAt: user.verifiedAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
      isAdmin: isAdminWallet(user.wallet),
    },
  };
});

app.get("/api/auth/wallet/session", async (request, reply) => {
  pruneWalletAuthStores();

  const token = getBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: "Authorization Bearer token is required" });
  }

  const session = walletAuthSessionStore.get(token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    walletAuthSessionStore.delete(token);
    return reply.code(401).send({ error: "Session expired or invalid" });
  }

  const user = walletAuthUsersStore.find((item) => item.wallet === session.wallet);
  if (!user) {
    return reply.code(404).send({ error: "User not found" });
  }

  return {
    success: true,
    user: {
      wallet: user.wallet,
      registeredAt: user.registeredAt,
      verifiedAt: user.verifiedAt,
      lastLoginAt: user.lastLoginAt,
      loginCount: user.loginCount,
      isAdmin: isAdminWallet(user.wallet),
    },
    session: {
      token,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
  };
});

app.post("/api/auth/wallet/logout", async (request, reply) => {
  const token = getBearerToken(request);
  if (!token) {
    return reply.code(401).send({ error: "Authorization Bearer token is required" });
  }

  walletAuthSessionStore.delete(token);
  return {
    success: true,
  };
});

app.get<{ Params: { handle: string } }>(
  "/api/dashboard/:handle",
  async (request) => {
    return buildSnapshot(request.params.handle);
  },
);

app.get<{ Params: { wallet: string } }>(
  "/api/dashboard/wallet/:wallet",
  async (request, reply) => {
    try {
      return await buildWalletSnapshot(request.params.wallet);
    } catch (error) {
      request.log.error(error);
      return reply.code(400).send({
        error: "Invalid wallet or RPC fetch failed",
      });
    }
  },
);

app.get<{
  Querystring: {
    limit?: number;
  };
}>("/api/intel/overview", async (request, reply) => {
  const limit = Number(request.query.limit || 12);
  const safeLimit = Number.isFinite(limit) ? Math.max(3, Math.min(limit, 30)) : 12;
  const cached = readCache(intelOverviewCache, safeLimit);

  if (cached) {
    reply.header("x-cache", "HIT");
    reply.header("cache-control", `public, max-age=${Math.floor(INTEL_CACHE_TTL_MS / 1000)}`);
    return cached;
  }

  const sharedCached = await readSharedCache<IntelOverview>("intel_overview", safeLimit);
  if (sharedCached) {
    writeCache(intelOverviewCache, safeLimit, sharedCached, INTEL_CACHE_TTL_MS);
    reply.header("x-cache", "HIT-SHARED");
    reply.header("cache-control", `public, max-age=${Math.floor(INTEL_CACHE_TTL_MS / 1000)}`);
    return sharedCached;
  }

  const fresh = await buildIntelOverview(safeLimit);
  writeCache(intelOverviewCache, safeLimit, fresh, INTEL_CACHE_TTL_MS);
  await writeSharedCache("intel_overview", safeLimit, fresh, INTEL_CACHE_TTL_MS);
  reply.header("x-cache", "MISS");
  reply.header("cache-control", `public, max-age=${Math.floor(INTEL_CACHE_TTL_MS / 1000)}`);
  return fresh;
});

app.get<{
  Querystring: {
    limit?: number;
  };
}>("/api/news/archive", async (request, reply): Promise<NewsArchiveResponse> => {
  const requestedLimit = Number(request.query.limit || 30);
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 120))
    : 30;

  const cached = readCache(newsArchiveCache, safeLimit);
  if (cached) {
    reply.header("x-cache", "HIT");
    reply.header(
      "cache-control",
      `public, max-age=${Math.floor(NEWS_ARCHIVE_CACHE_TTL_MS / 1000)}`,
    );
    return cached;
  }

  const sharedCached = await readSharedCache<NewsArchiveResponse>("news_archive", safeLimit);
  if (sharedCached) {
    writeCache(newsArchiveCache, safeLimit, sharedCached, NEWS_ARCHIVE_CACHE_TTL_MS);
    reply.header("x-cache", "HIT-SHARED");
    reply.header(
      "cache-control",
      `public, max-age=${Math.floor(NEWS_ARCHIVE_CACHE_TTL_MS / 1000)}`,
    );
    return sharedCached;
  }

  await syncNewsArchiveIfNeeded();
  const entries = sortByPeriodEndDesc(await readNewsArchiveEntries()).slice(0, safeLimit);
  const fresh: NewsArchiveResponse = {
    generatedAt: new Date().toISOString(),
    entries,
  };

  writeCache(newsArchiveCache, safeLimit, fresh, NEWS_ARCHIVE_CACHE_TTL_MS);
  await writeSharedCache("news_archive", safeLimit, fresh, NEWS_ARCHIVE_CACHE_TTL_MS);
  reply.header("x-cache", "MISS");
  reply.header(
    "cache-control",
    `public, max-age=${Math.floor(NEWS_ARCHIVE_CACHE_TTL_MS / 1000)}`,
  );
  return fresh;
});

app.post<{ Querystring: { force?: string } }>("/api/news/archive/sync", async (request) => {
  const force = String(request.query.force || "0") === "1";
  await syncNewsArchiveIfNeeded({ forceGenesis: force });
  clearNewsArchiveCache();
  return {
    ok: true,
    force,
    time: new Date().toISOString(),
  };
});

app.get("/api/market/settings", async () => {
  return {
    collections: starAtlasCollections,
    keywords: starAtlasCollectionKeywords,
    updatedAt: marketSettingsUpdatedAt,
  };
});

app.put<{
  Body: {
    collections?: string[];
    keywords?: string[];
  };
}>("/api/market/settings", async (request, reply) => {
  const { collections, keywords } = request.body || {};

  if (!Array.isArray(collections) || !Array.isArray(keywords)) {
    return reply.code(400).send({
      error: "Both collections and keywords must be arrays of strings",
    });
  }

  const normalizedCollections = Array.from(
    new Set(
      collections
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const normalizedKeywords = Array.from(
    new Set(
      keywords
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  starAtlasCollections = normalizedCollections;
  starAtlasCollectionKeywords = normalizedKeywords;
  marketSettingsUpdatedAt = new Date().toISOString();

  return {
    collections: starAtlasCollections,
    keywords: starAtlasCollectionKeywords,
    updatedAt: marketSettingsUpdatedAt,
  };
});

app.get<{
  Querystring: {
    search?: string;
    itemClass?: MarketAssetClass | "all";
    status?: ListingStatus | "all";
  };
}>("/api/market/listings", async (request) => {
  const { search, itemClass = "all", status = "active" } = request.query;
  const normalizedSearch = String(search || "").trim().toLowerCase();

  return marketListings
    .filter((listing) => (status === "all" ? true : listing.status === status))
    .filter((listing) =>
      itemClass === "all" ? true : listing.itemClass === itemClass,
    )
    .filter((listing) =>
      normalizedSearch
        ? `${listing.itemName} ${listing.note || ""}`
            .toLowerCase()
            .includes(normalizedSearch)
        : true,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

app.post<{
  Body: {
    itemName?: string;
    itemClass?: MarketAssetClass;
    quantity?: number;
    priceUsd?: number;
    paymentToken?: "USDC" | "ATLAS" | "SOL";
    sellerWallet?: string;
    note?: string;
    mint?: string;
    image?: string;
    escrowTxSignature?: string;
  };
}>("/api/market/listings", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) {
    return;
  }

  const { itemName, itemClass, quantity, priceUsd, paymentToken, sellerWallet, note, mint, image, escrowTxSignature } =
    request.body || {};

  if (!itemName || !itemClass || !quantity || !priceUsd || !sellerWallet) {
    return reply.code(400).send({ error: "Missing required listing fields" });
  }

  const normalizedMint = String(mint || "").trim();
  if (!normalizedMint) {
    return reply.code(400).send({ error: "mint is required for listing" });
  }

  const normalizedEscrowTx = String(escrowTxSignature || "").trim();
  if (!normalizedEscrowTx) {
    return reply.code(400).send({ error: "escrowTxSignature is required" });
  }

  const requestedSellerWallet = String(sellerWallet).trim();
  if (requestedSellerWallet && requestedSellerWallet !== session.wallet) {
    return reply.code(403).send({ error: "sellerWallet must match authenticated wallet" });
  }

  const listing: MarketListing = {
    id: createId("lst"),
    itemName: String(itemName).trim(),
    itemClass,
    quantity: Number(quantity),
    priceUsd: Number(priceUsd),
    paymentToken: paymentToken ?? "USDC",
    sellerWallet: session.wallet,
    note: note ? String(note).trim() : undefined,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  listing.mint = normalizedMint;
  if (image) listing.image = String(image).trim();
  listing.escrowTxSignature = normalizedEscrowTx;
  listing.escrowWallet = MARKET_ESCROW_WALLET;
  listing.escrowedAt = new Date().toISOString();

  marketListings.unshift(listing);
  return reply.code(201).send(listing);
});

app.post<{
  Params: { id: string };
  Body: { buyerWallet?: string; txSignature?: string };
}>("/api/market/listings/:id/buy", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) {
    return;
  }

  const listing = marketListings.find((item) => item.id === request.params.id);

  if (!listing) {
    return reply.code(404).send({ error: "Listing not found" });
  }

  if (listing.status !== "active") {
    return reply.code(409).send({ error: "Listing is no longer active" });
  }

  if (!listing.escrowTxSignature) {
    return reply.code(409).send({ error: "Listing is not escrowed" });
  }

  const requestedBuyerWallet = String(request.body?.buyerWallet || "").trim();
  if (requestedBuyerWallet && requestedBuyerWallet !== session.wallet) {
    return reply.code(403).send({ error: "buyerWallet must match authenticated wallet" });
  }

  const buyerWallet = session.wallet;

  if (buyerWallet === listing.sellerWallet) {
    return reply.code(400).send({ error: "Seller cannot buy own listing" });
  }

  if (!listing.mint) {
    return reply.code(409).send({ error: "Listing mint is missing" });
  }

  const txSignature = String(request.body?.txSignature || "").trim();
  if (!txSignature) {
    return reply.code(400).send({ error: "txSignature is required" });
  }

  listing.status = "sold";
  listing.buyerWallet = buyerWallet;
  listing.txSignature = txSignature;

  const settlement: {
    status: "completed" | "pending";
    txSignature?: string;
    reason?: string;
  } = { status: "pending" };

  if (!MARKET_ESCROW_KEYPAIR) {
    settlement.reason = "MARKET_ESCROW_SECRET_KEY is not configured";
    listing.settlementError = settlement.reason;
  } else if (
    listing.escrowWallet &&
    listing.escrowWallet !== MARKET_ESCROW_KEYPAIR.publicKey.toBase58()
  ) {
    settlement.reason = "Escrow wallet does not match configured secret";
    listing.settlementError = settlement.reason;
  } else {
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const mintPubkey = new PublicKey(listing.mint);
      const escrowOwner = MARKET_ESCROW_KEYPAIR.publicKey;
      const buyerPubkey = new PublicKey(buyerWallet);
      const escrowAta = getAta(mintPubkey, escrowOwner);
      const buyerAta = getAta(mintPubkey, buyerPubkey);

      const tx = new Transaction();
      tx.add(createAtaIdempotentInstruction(escrowOwner, buyerAta, buyerPubkey, mintPubkey));
      tx.add(splTransferInstruction(escrowAta, buyerAta, escrowOwner, 1n));
      tx.feePayer = escrowOwner;

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.sign(MARKET_ESCROW_KEYPAIR);

      const settlementSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(settlementSig, "confirmed");

      listing.settlementTxSignature = settlementSig;
      listing.settledAt = new Date().toISOString();
      listing.settlementError = undefined;
      settlement.status = "completed";
      settlement.txSignature = settlementSig;
    } catch (error) {
      settlement.status = "pending";
      settlement.reason =
        error instanceof Error ? error.message : "Failed to settle escrow NFT";
      listing.settlementError = settlement.reason;
    }
  }

  return {
    success: true,
    listing,
    settlement,
    message:
      settlement.status === "completed"
        ? "Purchase recorded and NFT transferred to buyer"
        : "Purchase recorded; NFT settlement pending",
  };
});

app.get<{
  Querystring: {
    status?: BarterStatus | "all";
  };
}>("/api/market/barters", async (request) => {
  const { status = "open" } = request.query;

  return barterOffers
    .filter((offer) => (status === "all" ? true : offer.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

app.post<{
  Body: {
    fromWallet?: string;
    offerItem?: string;
    wantItem?: string;
    extraUsd?: number;
    note?: string;
  };
}>("/api/market/barters", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) {
    return;
  }

  const { fromWallet, offerItem, wantItem, extraUsd = 0, note } = request.body || {};

  if (!fromWallet || !offerItem || !wantItem) {
    return reply.code(400).send({ error: "Missing required barter fields" });
  }

  const requestedFromWallet = String(fromWallet).trim();
  if (requestedFromWallet && requestedFromWallet !== session.wallet) {
    return reply.code(403).send({ error: "fromWallet must match authenticated wallet" });
  }

  const offer: BarterOffer = {
    id: createId("bar"),
    fromWallet: session.wallet,
    offerItem: String(offerItem).trim(),
    wantItem: String(wantItem).trim(),
    extraUsd: Number(extraUsd || 0),
    note: note ? String(note).trim() : undefined,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  barterOffers.unshift(offer);
  return reply.code(201).send(offer);
});

app.post<{
  Params: { id: string };
  Body: {
    responderWallet?: string;
    action?: "accept" | "decline";
  };
}>("/api/market/barters/:id/respond", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) {
    return;
  }

  const offer = barterOffers.find((item) => item.id === request.params.id);

  if (!offer) {
    return reply.code(404).send({ error: "Barter offer not found" });
  }

  if (offer.status !== "open") {
    return reply.code(409).send({ error: "Offer is no longer open" });
  }

  const requestedResponderWallet = String(request.body?.responderWallet || "").trim();
  const action = request.body?.action;

  if (action !== "accept" && action !== "decline") {
    return reply.code(400).send({ error: "A valid action is required" });
  }

  if (requestedResponderWallet && requestedResponderWallet !== session.wallet) {
    return reply.code(403).send({ error: "responderWallet must match authenticated wallet" });
  }

  offer.responderWallet = session.wallet;
  offer.status = action === "accept" ? "accepted" : "declined";

  return {
    success: true,
    offer,
  };
});

app.get<{
  Querystring: {
    role?: string;
    profile?: string;
  };
}>("/api/bridge/config", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.query.role);
  const profile = resolveBridgeProfile(request.query.profile);

  return {
    generatedAt: new Date().toISOString(),
    role,
    activeProfile: profile,
    profileRules: BRIDGE_PROFILES[profile],
    availableProfiles: Object.entries(BRIDGE_PROFILES).map(([key, value]) => ({
      key,
      label: value.label,
      description: value.description,
    })),
    capabilities: BRIDGE_ROLE_CAPABILITIES[role],
    mapPresets: ["Tactical", "Logistics", "Economy", "Threat", "Command"],
  };
});

app.get<{
  Querystring: {
    role?: string;
    profile?: string;
    windowMinutes?: number;
  };
}>("/api/bridge/live-map", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.query.role);
  const profile = resolveBridgeProfile(request.query.profile);
  const windowMinutes = clamp(Number(request.query.windowMinutes || 90), 5, 360);

  const payload = await buildBridgeLiveMap({
    wallet: session.wallet,
    role,
    profile,
    windowMinutes,
  });

  reply.header("cache-control", "no-store");
  reply.header("x-map-sync", "live");
  return payload;
});

app.get<{
  Querystring: {
    role?: string;
  };
}>("/api/bridge/resources", async (request, reply) => {
  const miningMetrics = await fetchSageMiningMetrics();
  reply.header("cache-control", "max-age=60");
  reply.header("x-mining-sync", "live");
  return miningMetrics;
});

app.get("/api/bridge/access/me", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  return {
    success: true,
    wallet: session.wallet,
    isAdmin: isAdminWallet(session.wallet),
    hasBridgeAccess: hasBridgeAccess(session.wallet),
  };
});

app.get("/api/bridge/admin/access-list", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  if (!isAdminWallet(session.wallet)) {
    return reply.code(403).send({ error: "Admin access required" });
  }

  const entries = [...bridgeAccessStore].sort((left, right) =>
    right.grantedAt.localeCompare(left.grantedAt),
  );

  return {
    success: true,
    entries,
  };
});

app.post<{ Body: { wallet?: string } }>("/api/bridge/admin/access-list", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  if (!isAdminWallet(session.wallet)) {
    return reply.code(403).send({ error: "Admin access required" });
  }

  const wallet = normalizeWalletAddress(request.body?.wallet || "");
  if (!wallet || !isValidSolanaWallet(wallet)) {
    return reply.code(400).send({ error: "Valid Solana wallet is required" });
  }

  if (bridgeAccessStore.some((entry) => entry.wallet === wallet)) {
    return {
      success: true,
      alreadyExists: true,
      wallet,
    };
  }

  bridgeAccessStore = [
    {
      wallet,
      grantedAt: new Date().toISOString(),
      grantedBy: session.wallet,
    },
    ...bridgeAccessStore,
  ];
  await writeBridgeAccessEntries(bridgeAccessStore);

  return {
    success: true,
    wallet,
  };
});

app.delete<{ Params: { wallet: string } }>("/api/bridge/admin/access-list/:wallet", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  if (!isAdminWallet(session.wallet)) {
    return reply.code(403).send({ error: "Admin access required" });
  }

  const wallet = normalizeWalletAddress(request.params.wallet || "");
  if (!wallet || !isValidSolanaWallet(wallet)) {
    return reply.code(400).send({ error: "Valid Solana wallet is required" });
  }

  if (isAdminWallet(wallet)) {
    return reply.code(400).send({ error: "Cannot revoke admin wallet access" });
  }

  const before = bridgeAccessStore.length;
  bridgeAccessStore = bridgeAccessStore.filter((entry) => entry.wallet !== wallet);
  if (bridgeAccessStore.length === before) {
    return reply.code(404).send({ error: "Wallet is not in access list" });
  }

  await writeBridgeAccessEntries(bridgeAccessStore);
  return {
    success: true,
    wallet,
  };
});

app.get<{ Params: { role: string } }>("/api/bridge/capabilities/:role", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.params.role);
  return {
    role,
    capabilities: BRIDGE_ROLE_CAPABILITIES[role],
  };
});

app.get<{
  Querystring: {
    role?: string;
    level?: BridgeAlertLevel | "all";
    limit?: number;
  };
}>("/api/bridge/alerts", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.query.role);
  const level = request.query.level || "all";
  const limit = clamp(Number(request.query.limit || 20), 1, 100);

  const items = bridgeAlertsStore
    .filter((item) => item.targetRoles.includes(role))
    .filter((item) => (level === "all" ? true : item.level === level))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      acknowledged: item.acknowledgedBy.some((entry) => entry.role === role),
    }));

  return {
    generatedAt: new Date().toISOString(),
    role,
    items,
  };
});

app.get<{
  Querystring: {
    role?: string;
    limit?: number;
  };
}>("/api/bridge/audit", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.query.role);
  const limit = clamp(Number(request.query.limit || 20), 1, 100);

  const items = bridgeAuditStore
    .filter((item) => item.role === role)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    role,
    items,
  };
});

app.post<{
  Params: { id: string };
  Body: {
    role?: string;
    profile?: string;
    actorWallet?: string;
  };
}>("/api/bridge/alerts/:id/ack", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.body?.role);
  const profile = resolveBridgeProfile(request.body?.profile);
  const alert = bridgeAlertsStore.find((item) => item.id === request.params.id);

  if (!alert) {
    return reply.code(404).send({ error: "Alert not found" });
  }

  const alreadyAcked = alert.acknowledgedBy.some((item) => item.role === role);
  if (!alreadyAcked) {
    const ackTime = new Date().toISOString();
    alert.acknowledgedBy.push({
      role,
      actorWallet: request.body?.actorWallet ? String(request.body.actorWallet).trim() : undefined,
      time: ackTime,
    });

    await appendBridgeAuditEvent({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      eventType: "alert-ack",
      role,
      profile,
      actorWallet: request.body?.actorWallet ? String(request.body.actorWallet).trim() : undefined,
      details: {
        alertId: alert.id,
        level: alert.level,
        domain: alert.domain,
        title: alert.title,
      },
      createdAt: ackTime,
    });
  }

  return {
    success: true,
    alertId: alert.id,
    role,
    acknowledged: true,
    acknowledgedBy: alert.acknowledgedBy,
  };
});

app.post<{
  Body: {
    role?: string;
    profile?: string;
    operationType?: BridgeOperationType;
    operationValueUsd?: number;
    routeComplexity?: number;
    riskTolerance?: BridgeRiskTolerance;
  };
}>("/api/bridge/preflight", async (request, reply) => {
  const session = requireBridgeAccessSession(request, reply);
  if (!session) return;

  const role = resolveBridgeRole(request.body?.role);
  const profile = resolveBridgeProfile(request.body?.profile);
  const operationType = request.body?.operationType;
  const riskTolerance = request.body?.riskTolerance || "medium";
  const operationValueUsd = Number(request.body?.operationValueUsd || 0);
  const routeComplexity = Number(request.body?.routeComplexity || 3);

  const supportedOperations: BridgeOperationType[] = [
    "fleet-dispatch",
    "logistics-route",
    "recon",
    "market-order",
    "repair",
  ];

  if (!operationType || !supportedOperations.includes(operationType)) {
    return reply.code(400).send({
      error: "operationType is required",
      supportedOperations,
    });
  }

  if (!["low", "medium", "high"].includes(riskTolerance)) {
    return reply.code(400).send({
      error: "riskTolerance must be low|medium|high",
    });
  }

  if (!Number.isFinite(operationValueUsd) || operationValueUsd <= 0) {
    return reply.code(400).send({
      error: "operationValueUsd must be > 0",
    });
  }

  const preflight = runBridgePreflight({
    role,
    profile,
    operationType,
    operationValueUsd,
    routeComplexity,
    riskTolerance,
  });

  await appendBridgeAuditEvent({
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    eventType: "preflight-run",
    role,
    profile,
    details: {
      operationType,
      operationValueUsd,
      routeComplexity,
      riskTolerance,
      riskScore: preflight.riskScore,
      successProbability: preflight.successProbability,
      expectedPnlUsd: preflight.expectedPnlUsd,
    },
    createdAt: new Date().toISOString(),
  });

  return {
    success: true,
    ...preflight,
  };
});

// ── Bridge: Admin wallet assets ──────────────────────────────────────────────
const ATLAS_MINT = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
const POLIS_MINT = "poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

app.get("/api/bridge/admin/wallet-assets", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  if (!isAdminWallet(session.wallet)) {
    reply.code(403).send({ error: "Admin access required" });
    return;
  }

  const walletPubkey = new PublicKey(session.wallet);
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  let solBalance = 0;
  let atlasBalance = 0;
  let polisBalance = 0;
  let nftCount = 0;
  let rpcError: string | null = null;

  try {
    // Two sequential calls to stay under rate limits:
    // 1) SOL balance
    const lamports = await connection.getBalance(walletPubkey);
    solBalance = lamports / 1e9;

    // 2) All SPL token accounts in one call → derive ATLAS, POLIS, NFT count
    const allTokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: new PublicKey(TOKEN_PROGRAM_ID) },
    );

    for (const acc of allTokenAccounts.value) {
      const info = acc.account.data.parsed?.info;
      const tokenAmount = info?.tokenAmount;
      const mint: string = info?.mint ?? "";

      if (mint === ATLAS_MINT) {
        atlasBalance = Number(tokenAmount?.uiAmount || 0);
      } else if (mint === POLIS_MINT) {
        polisBalance = Number(tokenAmount?.uiAmount || 0);
      } else if (Number(tokenAmount?.amount) === 1 && Number(tokenAmount?.decimals) === 0) {
        nftCount++;
      }
    }
  } catch (err) {
    rpcError = err instanceof Error ? err.message : String(err);
  }

  return {
    success: true,
    wallet: session.wallet,
    fetchedAt: new Date().toISOString(),
    rpcError,
    sol: solBalance,
    atlas: atlasBalance,
    polis: polisBalance,
    nftCount,
  };
});

// ── Bridge: Admin wallet NFT list ────────────────────────────────────────────
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const METADATA_BATCH_SIZE = 25; // stay under public RPC rate limits
const METADATA_BATCH_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── Star Atlas Galaxy NFT catalog cache ──────────────────────────────────────
const SA_GALAXY_URL = "https://galaxy.staratlas.com/nfts";
const SA_GALAXY_TTL_MS = 60 * 60 * 1000; // 1 hour

type SaGalaxyNft = { mint: string; name: string; image: string; media?: { thumbnailUrl?: string } };
let saGalaxyCache: Map<string, SaGalaxyNft> | null = null;
let saGalaxyCachedAt = 0;

async function getSaGalaxyMap(): Promise<Map<string, SaGalaxyNft>> {
  if (saGalaxyCache && Date.now() - saGalaxyCachedAt < SA_GALAXY_TTL_MS) {
    return saGalaxyCache;
  }
  try {
    const resp = await fetch(SA_GALAXY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const list = (await resp.json()) as Array<{ mint: string; name: string; image?: string; media?: { thumbnailUrl?: string } }>;
    const map = new Map<string, SaGalaxyNft>();
    for (const item of list) {
      if (item.mint) {
        map.set(item.mint, {
          mint: item.mint,
          name: item.name ?? "",
          image: item.media?.thumbnailUrl ?? item.image ?? "",
          media: item.media,
        });
      }
    }
    saGalaxyCache = map;
    saGalaxyCachedAt = Date.now();
    return map;
  } catch {
    return saGalaxyCache ?? new Map();
  }
}

async function getMetaplexName(
  connection: Connection,
  mintPubkeys: PublicKey[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (mintPubkeys.length === 0) return result;

  // compute PDAs synchronously (no RPC call)
  const pdas = await Promise.all(
    mintPubkeys.map((mint) =>
      PublicKey.findProgramAddress(
        [
          Buffer.from("metadata"),
          METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        METAPLEX_METADATA_PROGRAM_ID,
      ).then(([pda]) => pda),
    ),
  );

  // batch getMultipleAccountsInfo to avoid 429
  for (let i = 0; i < pdas.length; i += METADATA_BATCH_SIZE) {
    if (i > 0) await sleep(METADATA_BATCH_DELAY_MS);

    const batchPdas = pdas.slice(i, i + METADATA_BATCH_SIZE);
    const batchMints = mintPubkeys.slice(i, i + METADATA_BATCH_SIZE);

    let accounts;
    try {
      accounts = await connection.getMultipleAccountsInfo(batchPdas);
    } catch {
      continue; // skip this batch on error
    }

    for (let j = 0; j < batchMints.length; j++) {
      const data = accounts[j]?.data;
      if (!data || data.length < 69) continue;

      try {
        // Metaplex metadata v1:
        // 1 (key) + 32 (update_authority) + 32 (mint) = 65 offset
        // then 4-byte LE u32 name_length, then name bytes
        const nameLen = data.readUInt32LE(65);
        if (nameLen > 0 && nameLen <= 200 && data.length >= 69 + nameLen) {
          const name = data
            .subarray(69, 69 + nameLen)
            .toString("utf8")
            .replace(/\0/g, "")
            .trim();
          if (name) {
            result.set(batchMints[j].toBase58(), name);
          }
        }
      } catch {
        // skip unparseable accounts
      }
    }
  }

  return result;
}

app.get("/api/bridge/admin/wallet-nfts", async (request, reply) => {
  const session = requireWalletAuthSession(request, reply);
  if (!session) return;

  if (!isAdminWallet(session.wallet)) {
    reply.code(403).send({ error: "Admin access required" });
    return;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const walletPubkey = new PublicKey(session.wallet);
  let rpcError: string | null = null;
  const nfts: Array<{ mint: string; name: string | null; image: string | null }> = [];

  try {
    // fetch SA galaxy catalog and token accounts in parallel
    const [saMap, tokenAccounts] = await Promise.all([
      getSaGalaxyMap(),
      connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: new PublicKey(TOKEN_PROGRAM_ID) },
      ),
    ]);

    const nftMints = tokenAccounts.value
      .filter((acc) => {
        const info = acc.account.data.parsed?.info?.tokenAmount;
        return Number(info?.amount) === 1 && Number(info?.decimals) === 0;
      })
      .map((acc) => new PublicKey(acc.account.data.parsed?.info?.mint as string));

    // on-chain name fallback only for mints not in SA catalog
    const unknownMints = nftMints.filter((m) => !saMap.has(m.toBase58()));
    const onChainNames = await getMetaplexName(connection, unknownMints);

    for (const mint of nftMints) {
      const mintStr = mint.toBase58();
      const saEntry = saMap.get(mintStr);
      nfts.push({
        mint: mintStr,
        name: saEntry?.name ?? onChainNames.get(mintStr) ?? null,
        image: saEntry?.image || null,
      });
    }

    // named first, then alphabetical
    nfts.sort((a, b) => {
      if (a.name && !b.name) return -1;
      if (!a.name && b.name) return 1;
      return (a.name ?? a.mint).localeCompare(b.name ?? b.mint);
    });
  } catch (err) {
    rpcError = err instanceof Error ? err.message : String(err);
  }

  return {
    success: true,
    wallet: session.wallet,
    fetchedAt: new Date().toISOString(),
    rpcError,
    total: nfts.length,
    nfts,
  };
});

const start = async () => {
  app.get("/api/solana/latest-blockhash", async (_request, reply) => {
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const latest = await connection.getLatestBlockhash("confirmed");
      return latest;
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to fetch blockhash",
      });
    }
  });

  app.post<{
    Body: {
      rawTxBase64?: string;
      waitForConfirmation?: boolean;
    };
  }>("/api/solana/send-raw", async (request, reply) => {
    const rawTxBase64 = String(request.body?.rawTxBase64 || "").trim();
    const waitForConfirmation = request.body?.waitForConfirmation !== false;

    if (!rawTxBase64) {
      return reply.code(400).send({ error: "rawTxBase64 is required" });
    }

    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const raw = Buffer.from(rawTxBase64, "base64");
      const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });

      if (waitForConfirmation) {
        await connection.confirmTransaction(signature, "confirmed");
      }

      return {
        success: true,
        signature,
        confirmed: waitForConfirmation,
      };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Failed to send raw transaction",
      });
    }
  });

  app.get("/api/market/config", async () => {
    return {
      platformFeeWallet: PLATFORM_FEE_WALLET,
      platformFeeBps: PLATFORM_FEE_BPS,
      usdcMint: USDC_MINT,
      escrowWallet: MARKET_ESCROW_WALLET,
      autoSettlementEnabled: Boolean(MARKET_ESCROW_KEYPAIR),
    };
  });

  app.get("/api/market/wallet-nfts", async (request, reply) => {
    const session = requireWalletAuthSession(request, reply);
    if (!session) return;

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const walletPubkey = new PublicKey(session.wallet);
    let rpcError: string | null = null;
    const nfts: Array<{ mint: string; name: string | null; image: string | null }> = [];

    try {
      const [saMap, tokenAccounts] = await Promise.all([
        getSaGalaxyMap(),
        connection.getParsedTokenAccountsByOwner(
          walletPubkey,
          { programId: new PublicKey(TOKEN_PROGRAM_ID) },
        ),
      ]);

      const nftMints = tokenAccounts.value
        .filter((acc) => {
          const info = acc.account.data.parsed?.info?.tokenAmount;
          return Number(info?.amount) === 1 && Number(info?.decimals) === 0;
        })
        .map((acc) => new PublicKey(acc.account.data.parsed?.info?.mint as string));

      const unknownMints = nftMints.filter((m) => !saMap.has(m.toBase58()));
      const onChainNames = await getMetaplexName(connection, unknownMints);

      for (const mint of nftMints) {
        const mintStr = mint.toBase58();
        const saEntry = saMap.get(mintStr);
        nfts.push({
          mint: mintStr,
          name: saEntry?.name ?? onChainNames.get(mintStr) ?? null,
          image: saEntry?.image || null,
        });
      }

      nfts.sort((a, b) => {
        if (a.name && !b.name) return -1;
        if (!a.name && b.name) return 1;
        return (a.name ?? a.mint).localeCompare(b.name ?? b.mint);
      });
    } catch (err) {
      rpcError = err instanceof Error ? err.message : String(err);
    }

    return {
      success: true,
      wallet: session.wallet,
      fetchedAt: new Date().toISOString(),
      rpcError,
      total: nfts.length,
      nfts,
    };
  });

  try {
    bridgeAuditStore = await readBridgeAuditEvents();
    bridgeAccessStore = await readBridgeAccessEntries();
    await ensureBridgeAccessSeed();
    walletAuthUsersStore = await readWalletAuthUsers();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Star Atlas API started at http://${HOST}:${PORT}`);
    void syncNewsArchiveIfNeeded();
    setInterval(() => {
      void syncNewsArchiveIfNeeded();
    }, 60 * 60 * 1000);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
