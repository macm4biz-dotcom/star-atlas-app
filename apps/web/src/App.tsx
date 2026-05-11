import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { ApiRequestError, apiRequest } from "./apiClient";
import "./App.css";

type FleetAsset = {
  id: string;
  name: string;
  class: "Ship" | "Crew" | "Resource" | "NFT";
  isStarAtlas?: boolean;
  quantity: number;
  estimatedValueUsd: number;
  dailyYieldUsd: number;
};

type DashboardSnapshot = {
  handle: string;
  generatedAt: string;
  totalValueUsd: number;
  dailyProfitUsd: number;
  roiDays: number;
  assets: FleetAsset[];
};

type MarketSettings = {
  collections: string[];
  keywords: string[];
  updatedAt: string;
};

type ListingStatus = "active" | "sold" | "cancelled";
type PaymentToken = "USDC" | "ATLAS" | "SOL";

type MarketListing = {
  id: string;
  itemName: string;
  itemClass: FleetAsset["class"];
  quantity: number;
  priceUsd: number;
  paymentToken: PaymentToken;
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

type BarterStatus = "open" | "accepted" | "declined";

type MarketWalletNft = { mint: string; name: string | null; image: string | null };
type MarketWalletNftsResponse = {
  wallet: string;
  fetchedAt: string;
  total: number;
  nfts: MarketWalletNft[];
  rpcError: string | null;
};
type MarketConfig = {
  platformFeeWallet: string;
  platformFeeBps: number;
  usdcMint: string;
  escrowWallet: string;
  autoSettlementEnabled: boolean;
};

type MarketBuyResponse = {
  success: true;
  listing: MarketListing;
  message: string;
  settlement?: {
    status: "completed" | "pending";
    txSignature?: string;
    reason?: string;
  };
};

type LatestBlockhashResponse = {
  blockhash: string;
  lastValidBlockHeight: number;
};

type SendRawTxResponse = {
  success: true;
  signature: string;
  confirmed: boolean;
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
  sourceStats24h: Record<IntelSourceKey, number>;
  sources: IntelSourceStatus[];
  highlights: string[];
  conclusions: string[];
  items: IntelItem[];
};

type NewsArchiveEntry = {
  id: string;
  type: "genesis" | "weekly";
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

type BridgeC4Profile = "pre-c4" | "c4-transition" | "c4-live";
type BridgeOperationType =
  | "fleet-dispatch"
  | "logistics-route"
  | "recon"
  | "market-order"
  | "repair";
type BridgeRiskTolerance = "low" | "medium" | "high";
type BridgeAlertLevel = "critical" | "high" | "normal" | "info";
type BridgeMapPresetKey = "Tactical" | "Logistics" | "Economy" | "Threat" | "Command";
type BridgeMapLayers = {
  fleets: boolean;
  enemies: boolean;
  resources: boolean;
  routes: boolean;
  riskZones: boolean;
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

type BridgeLiveMapResponse = {
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
  connectedWalletMetrics?: BridgeConnectedWalletMetrics;
  sagePlayersMetric?: BridgeSagePlayersMetric;
  sageActiveProfilesMetric?: BridgeSageActiveProfilesMetric;
};

type MiningResourceData = {
  resource: string;
  totalFleets: number;
  totalMined?: string;
  dailyMined?: string;
  resourceMint?: string;
  resourceMintSource?: "onchain" | "env" | "unresolved";
  playerWalletBalance?: number;
  developerWalletBalance?: number;
  estimatedPlayerReserves?: string;
  reserveSignal?: "deficit-risk" | "balanced" | "surplus-risk";
  reserveSignalScore?: number;
  resourceHardness?: number;
  averageSystemRichness?: number;
  // History-based signal fields
  consumptionSignal?: "deficit-risk" | "balanced" | "surplus-risk";
  consumptionScore?: number;
  consumptionReason?: string;
  estimatedCoverageDays?: number;
  avgConsumptionLast7d?: number;
  avgProductionLast7d?: number;
  byFaction: {
    MUD: number;
    ONI: number;
    USTUR: number;
  };
  updatedAt: string;
};

type BridgeMiningMetrics = {
  resources: MiningResourceData[];
  resetAt: string;
  updatedAt: string;
  source?: "sage-onchain" | "rydn-fallback" | "empty";
  reserveSummary?: {
    totalEstimatedReserves: string;
    totalPlayerWalletBalance: number;
    totalDeveloperWalletBalance: number;
    walletCoverageResources: number;
    playerWalletsScanned: number;
    developerWalletsScanned: number;
    deficitRiskCount: number;
    balancedCount: number;
    surplusRiskCount: number;
  };
};

type R4SignalLevel =
  | "deficit-risk"
  | "balanced"
  | "surplus-risk"
  | "consumption-spike"
  | "consumption-drop";

type R4ResourceMetrics = {
  key: "food" | "ammunition" | "toolkit" | "fuel";
  label: string;
  mint?: string;
  mintSource?: "r4-env" | "bridge-env" | "staratlas-market" | "unresolved";
  totalCreated: number;
  totalCreatedIsLowerBound: boolean;
  createdToday: number;
  consumedToday: number;
  totalConsumed: number;
  playerBalance: number;
  playerBalanceKnown: boolean;
  developerBalance: number;
  totalSupply: number;
  dailyConsumption: number;
  avgDailyConsumption7d: number;
  avgDailyConsumption30d: number;
  daysOfCover: number | null;
  signal: R4SignalLevel;
  signalReason: string;
  priceUsd: number;
  priceChange24hPct: number | null;
  priceChange7dPct: number | null;
  buyOrderVolume: number;
  sellOrderVolume: number;
};

type BridgeR4Metrics = {
  updatedAt: string;
  source: "onchain+r4-history";
  programIds: {
    sage: string;
    cargo: string;
    crafting: string;
    playerProfile: string;
    sourceUrl: string;
  };
  resources: R4ResourceMetrics[];
  summary: {
    totalCreated: number;
    totalConsumed: number;
    totalPlayerBalance: number;
    totalPlayerBalanceKnown: boolean;
    totalCreatedIsLowerBound: boolean;
    lowerBoundResourceCount: number;
    createdCoverageDays: number;
    createdCoverageStartUtcDate: string | null;
    createdCoverageEndUtcDate: string | null;
    productionHistorySource: string;
    deficitRiskCount: number;
    balancedCount: number;
    surplusRiskCount: number;
    anomalyCount: number;
    playerWalletsScanned: number;
    developerWalletsScanned: number;
  };
};

type BridgeCapabilities = {
  canApproveCritical: boolean;
  canRunOperations: boolean;
  visiblePresets: string[];
  notifications: BridgeAlertLevel[];
};

type BridgeConfig = {
  generatedAt: string;
  role: BridgeRole;
  activeProfile: BridgeC4Profile;
  profileRules: {
    label: string;
    description: string;
    volatilityMultiplier: number;
    etaMultiplier: number;
    returnPotentialMultiplier: number;
    fleetCapacityPolicy: string;
  };
  availableProfiles: Array<{
    key: BridgeC4Profile;
    label: string;
    description: string;
  }>;
  capabilities: BridgeCapabilities;
  mapPresets: string[];
};

type BridgeAlert = {
  id: string;
  level: BridgeAlertLevel;
  domain: "combat" | "economy" | "logistics" | "system";
  title: string;
  details: string;
  createdAt: string;
  acknowledged: boolean;
};

type BridgeAlertsResponse = {
  generatedAt: string;
  role: BridgeRole;
  items: BridgeAlert[];
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

type BridgeAuditResponse = {
  generatedAt: string;
  role: BridgeRole;
  items: BridgeAuditEvent[];
};

type BridgeAuditFilterType = "all" | BridgeAuditEvent["eventType"];
type BridgeAuditPeriod = "24h" | "7d" | "30d" | "all";
type BridgeWorkspaceView =
  | "preflight"
  | "alerts"
  | "audit"
  | "map"
  | "ops"
  | "notify"
  | "security"
  | "readiness";

type BridgePreflight = {
  success: true;
  generatedAt: string;
  role: BridgeRole;
  profile: BridgeC4Profile;
  profileLabel: string;
  operationType: BridgeOperationType;
  operationValueUsd: number;
  routeComplexity: number;
  riskTolerance: BridgeRiskTolerance;
  riskScore: number;
  successProbability: number;
  etaMinutes: number;
  expectedPnlUsd: number;
  bestCaseUsd: number;
  worstCaseUsd: number;
  assumptions: string[];
};

type WalletAuthChallengePayload = {
  challengeId: string;
  wallet: string;
  nonce: string;
  message: string;
  createdAt: string;
  expiresAt: string;
};

type WalletAuthChallengeResponse = {
  success: true;
  challenge: WalletAuthChallengePayload;
  ttlMs: number;
};

type WalletAuthUserProfile = {
  wallet: string;
  registeredAt: string;
  verifiedAt: string;
  lastLoginAt: string;
  loginCount: number;
  isAdmin: boolean;
};

type WalletAuthVerifyResponse = {
  success: true;
  isNewRegistration: boolean;
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: WalletAuthUserProfile;
};

type WalletAuthSessionResponse = {
  success: true;
  user: WalletAuthUserProfile;
  session: {
    token: string;
    createdAt: string;
    expiresAt: string;
  };
};

type BridgeAccessMeResponse = {
  success: true;
  wallet: string;
  isAdmin: boolean;
  hasBridgeAccess: boolean;
};

type BridgeAccessEntry = {
  wallet: string;
  grantedAt: string;
  grantedBy: string;
};

type BridgeAccessListResponse = {
  success: true;
  entries: BridgeAccessEntry[];
};

type CraftCatalogGroup = "compound-material" | "component";

type CraftCatalogItem = {
  name: string;
  group: CraftCatalogGroup;
  tier: string | null;
  verified: boolean;
  recipeDraft: string;
  output: string;
  status: string;
};

type BridgeCraftCatalogResponse = {
  source: string;
  verifiedAt: string | null;
  updatedAt: string;
  items: CraftCatalogItem[];
};

type CraftReferenceCategory = {
  key: CraftCatalogGroup;
  title: string;
  items: CraftCatalogItem[];
};

type WhaleHolder = {
  rank: number;
  wallet: string;
  tokenAccount: string;
  amount: number;
  uiAmount: string;
};

type WhaleTrade = {
  rank: number;
  signature: string;
  timestamp: number;
  type: string;
  direction: "buy" | "sell" | "transfer";
  amount: number;
  uiAmount: string;
  fromWallet: string;
  toWallet: string;
};

type WhalesSnapshot = {
  fetchedAt: string;
  atlasHolders: WhaleHolder[];
  polisHolders: WhaleHolder[];
  atlasTrades: WhaleTrade[];
  polisTrades: WhaleTrade[];
};

type StarAtlasTickerToken = {
  symbol: "ATLAS" | "POLIS" | "ZINC";
  priceUsd: number;
  change24hPct: number | null;
  trend24h: number[];
  placeholder?: boolean;
};

type StarAtlasTickerSnapshot = {
  updatedAt: string;
  utcDateKey: string;
  refreshIntervalMinutes: number;
  tokens: StarAtlasTickerToken[];
};

const LOCAL_CRAFT_REFERENCE_ITEMS: CraftCatalogItem[] = [
  { name: "Aerogel", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Crystal Lattice", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Copper Wire", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Copper", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Electronics", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Graphene", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Hydrocarbon", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Iron", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Magnet", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Polymer", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Steel", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Titanium", group: "compound-material", tier: null, verified: false, recipeDraft: "-", output: "1x", status: "Справочник" },
  { name: "Energy Substrate", group: "component", tier: null, verified: false, recipeDraft: "Polymer + Electronics + Copper Wire", output: "1x", status: "Приоритет" },
  { name: "Electromagnet", group: "component", tier: null, verified: false, recipeDraft: "Copper Wire + Magnet + Iron", output: "1x", status: "Приоритет" },
  { name: "Framework", group: "component", tier: null, verified: false, recipeDraft: "Steel + Titanium + Polymer", output: "1x", status: "Приоритет" },
  { name: "Field Stabilizer", group: "component", tier: null, verified: false, recipeDraft: "Crystal Lattice + Graphene + Magnet", output: "1x", status: "Приоритет" },
  { name: "Particle Accelerator", group: "component", tier: null, verified: false, recipeDraft: "Super Conductor + Power Source + Framework", output: "1x", status: "Приоритет" },
  { name: "Power Source", group: "component", tier: null, verified: false, recipeDraft: "Hydrocarbon + Copper Wire + Electronics", output: "1x", status: "Приоритет" },
  { name: "Radiation Absorber", group: "component", tier: null, verified: false, recipeDraft: "Aerogel + Polymer + Titanium", output: "1x", status: "Приоритет" },
  { name: "Strange Emitter", group: "component", tier: null, verified: false, recipeDraft: "Crystal Lattice + Graphene + Power Source", output: "1x", status: "Приоритет" },
  { name: "Super Conductor", group: "component", tier: null, verified: false, recipeDraft: "Graphene + Copper Wire + Electronics", output: "1x", status: "Приоритет" },
];

function buildCraftReferenceCategories(items: CraftCatalogItem[]): CraftReferenceCategory[] {
  const groups: CraftReferenceCategory[] = [
    { key: "compound-material", title: "Compound Material", items: [] },
    { key: "component", title: "Component", items: [] },
  ];

  for (const item of items) {
    const target = groups.find((group) => group.key === item.group);
    if (target) {
      target.items.push(item);
    }
  }

  return groups;
}

function parseListInput(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function parseNonNegativeNumber(input: string) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function formatIntegerString(value?: string) {
  if (!value) return "-";
  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) return "-";
  return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function parseIntegerStringToBigInt(value?: string) {
  if (!value) return 0n;
  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) return 0n;

  try {
    return BigInt(digitsOnly);
  } catch {
    return 0n;
  }
}

function formatCompactBigInt(value: bigint) {
  const units = [
    { pow: 12n, suffix: "T" },
    { pow: 9n, suffix: "B" },
    { pow: 6n, suffix: "M" },
    { pow: 3n, suffix: "K" },
  ];

  for (const unit of units) {
    const divisor = 10n ** unit.pow;
    if (value >= divisor) {
      const whole = value / divisor;
      const frac = (value % divisor) * 10n / divisor;
      return frac > 0n ? `${whole.toString()}.${frac.toString()}${unit.suffix}` : `${whole.toString()}${unit.suffix}`;
    }
  }

  return value.toString();
}

function formatCompactIntegerString(value?: string) {
  const parsed = parseIntegerStringToBigInt(value);
  return formatCompactBigInt(parsed);
}

function formatReserveSignal(signal?: "deficit-risk" | "balanced" | "surplus-risk") {
  if (signal === "deficit-risk") return "Риск дефицита";
  if (signal === "surplus-risk") return "Риск избытка";
  return "Баланс";
}

function formatR4Signal(signal?: R4SignalLevel) {
  if (signal === "deficit-risk") return "Риск дефицита";
  if (signal === "surplus-risk") return "Риск избытка";
  if (signal === "consumption-spike") return "Всплеск расхода";
  if (signal === "consumption-drop") return "Просадка расхода";
  return "Баланс";
}

function formatPercentDelta(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTokenAmount(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function formatCompactTokenAmount(value?: number) {
  if (value == null || !Number.isFinite(value)) return "-";

  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(1)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return formatTokenAmount(value);
}

function formatTokenAmountWithCoverage(value: number | undefined, scannedWallets: number) {
  if (value != null && Number.isFinite(value)) {
    return formatCompactTokenAmount(value);
  }
  if (scannedWallets <= 0) {
    return "-";
  }
  return formatCompactTokenAmount(value);
}

function renderMetricWithTooltip(displayValue: string, fullValue: string) {
  return (
    <span
      className="metric-tooltip"
      data-full={fullValue}
      title={fullValue}
      tabIndex={0}
    >
      {displayValue}
    </span>
  );
}

function formatMintShort(mint?: string) {
  if (!mint) return "-";
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

function formatMintSourceLabel(source?: "onchain" | "env" | "unresolved") {
  if (source === "onchain") return "on-chain";
  if (source === "env") return "env";
  return "missing";
}

function formatR4MintSourceLabel(source?: "r4-env" | "bridge-env" | "staratlas-market" | "unresolved") {
  if (source === "r4-env") return "r4-env";
  if (source === "bridge-env") return "bridge-env";
  if (source === "staratlas-market") return "staratlas-market";
  return "on-chain PDA (без SPL mint)";
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message || `HTTP ${error.status}`;
  }

  if (error instanceof Error) {
    return error.message || error.name || "Неизвестная ошибка";
  }

  if (typeof error === "string") {
    return error || "Неизвестная ошибка";
  }

  try {
    const payload = JSON.stringify(error);
    return payload && payload !== "{}" ? payload : "Неизвестная ошибка";
  } catch {
    return "Неизвестная ошибка";
  }
}

function isLikelySolanaAddress(address: string) {
  return /^Demo[A-Za-z0-9_-]{2,}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

const SPL_TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
const SYSVAR_RENT_PROGRAM = new PublicKey("SysvarRent111111111111111111111111111111111");

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), SPL_TOKEN_PROGRAM.toBytes(), mint.toBytes()],
    ATA_PROGRAM,
  )[0];
}

function splTransferInstruction(
  source: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const amtBytes: number[] = [];
  let n = amount;
  for (let i = 0; i < 8; i++) {
    amtBytes.push(Number(n & 0xffn));
    n >>= 8n;
  }
  return new TransactionInstruction({
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: SPL_TOKEN_PROGRAM,
    data: Buffer.from([3, ...amtBytes]),
  });
}

function createAtaIdempotentInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
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

async function getLatestBlockhashSafe(connection: Connection) {
  try {
    return await connection.getLatestBlockhash("confirmed");
  } catch {
    return await apiRequest<LatestBlockhashResponse>("/api/solana/latest-blockhash");
  }
}

async function sendRawTransactionSafe(
  connection: Connection,
  raw: Uint8Array,
) {
  try {
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  } catch {
    const fallback = await apiRequest<SendRawTxResponse>("/api/solana/send-raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawTxBase64: Buffer.from(raw).toString("base64"),
        waitForConfirmation: true,
      }),
    });
    return fallback.signature;
  }
}

function App() {
  const { connection } = useConnection();
  const { publicKey, connected, signMessage, signTransaction } = useWallet();
  const [activeTab, setActiveTab] = useState<
    "news" | "archive" | "dashboard" | "bridge" | "market" | "intel" | "resources" | "whales"
  >(
    "news",
  );
  const [marketSection, setMarketSection] = useState<
    "trade" | "barter" | "settings"
  >("trade");
  const [handle, setHandle] = useState("pilot");
  const [wallet, setWallet] = useState("");
  const [mode, setMode] = useState<"handle" | "wallet">("handle");
  const [assetFilter, setAssetFilter] = useState<"all" | "priced" | "star-atlas">(
    "all",
  );
  const [classFilter, setClassFilter] = useState<"all" | FleetAsset["class"]>(
    "all",
  );
  const [sortMode, setSortMode] = useState<
    "value-desc" | "value-asc" | "qty-desc" | "qty-asc" | "name-asc" | "class"
  >("value-desc");
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketSettings, setMarketSettings] = useState<MarketSettings | null>(
    null,
  );
  const [collectionsInput, setCollectionsInput] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [manualMarketWallet, setManualMarketWallet] = useState("");
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [listingsBusy, setListingsBusy] = useState(false);
  const [listingsMessage, setListingsMessage] = useState<string | null>(null);
  const [listingsSearch, setListingsSearch] = useState("");
  const [listingsClass, setListingsClass] = useState<"all" | FleetAsset["class"]>(
    "all",
  );
  const [listingsStatus, setListingsStatus] = useState<"active" | "all">("active");
  const [newListing, setNewListing] = useState({
    itemName: "",
    itemClass: "Resource" as FleetAsset["class"],
    quantity: "1",
    priceUsd: "",
    paymentToken: "USDC" as PaymentToken,
    note: "",
  });
  const [sellPickerNfts, setSellPickerNfts] = useState<MarketWalletNft[]>([]);
  const [sellPickerLoading, setSellPickerLoading] = useState(false);
  const [sellPickerError, setSellPickerError] = useState<string | null>(null);
  const [sellPickerSearch, setSellPickerSearch] = useState("");
  const [sellPickerSelected, setSellPickerSelected] = useState<MarketWalletNft | null>(null);
  const [marketConfig, setMarketConfig] = useState<MarketConfig | null>(null);
  const [barters, setBarters] = useState<BarterOffer[]>([]);
  const [bartersBusy, setBartersBusy] = useState(false);
  const [bartersMessage, setBartersMessage] = useState<string | null>(null);
  const [bartersStatus, setBartersStatus] = useState<"open" | "all">("open");
  const [newBarter, setNewBarter] = useState({
    offerItem: "",
    wantItem: "",
    extraUsd: "0",
    note: "",
  });
  const [intelData, setIntelData] = useState<IntelOverview | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [archiveData, setArchiveData] = useState<NewsArchiveResponse | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [miningMetrics, setMiningMetrics] = useState<BridgeMiningMetrics | null>(null);
  const [miningLoading, setMiningLoading] = useState(false);
  const [miningError, setMiningError] = useState<string | null>(null);
  const [r4Metrics, setR4Metrics] = useState<BridgeR4Metrics | null>(null);
  const [r4Loading, setR4Loading] = useState(false);
  const [r4Error, setR4Error] = useState<string | null>(null);
  const [craftCatalog, setCraftCatalog] = useState<BridgeCraftCatalogResponse | null>(null);
  const [craftCatalogLoading, setCraftCatalogLoading] = useState(false);
  const [craftCatalogError, setCraftCatalogError] = useState<string | null>(null);
  const [whalesData, setWhalesData] = useState<WhalesSnapshot | null>(null);
  const [whalesLoading, setWhalesLoading] = useState(false);
  const [whalesError, setWhalesError] = useState<string | null>(null);
  const [tickerData, setTickerData] = useState<StarAtlasTickerSnapshot | null>(null);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [bridgeRole, setBridgeRole] = useState<BridgeRole>("Captain");
  const [bridgeProfile, setBridgeProfile] = useState<BridgeC4Profile>("c4-transition");
  const [bridgeConfig, setBridgeConfig] = useState<BridgeConfig | null>(null);
  const [bridgeAlertsData, setBridgeAlertsData] = useState<BridgeAlert[]>([]);
  const [bridgeAuditData, setBridgeAuditData] = useState<BridgeAuditEvent[]>([]);
  const [bridgeAuditTypeFilter, setBridgeAuditTypeFilter] =
    useState<BridgeAuditFilterType>("all");
  const [bridgeAuditPeriodFilter, setBridgeAuditPeriodFilter] =
    useState<BridgeAuditPeriod>("7d");
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const [bridgeWorkspaceView, setBridgeWorkspaceView] =
    useState<BridgeWorkspaceView | null>(null);
  const [bridgeLiveMap, setBridgeLiveMap] = useState<BridgeLiveMapResponse | null>(null);
  const [bridgeLiveMapLoading, setBridgeLiveMapLoading] = useState(false);
  const [bridgeLiveMapError, setBridgeLiveMapError] = useState<string | null>(null);
  const [bridgePreflight, setBridgePreflight] = useState<BridgePreflight | null>(null);
  const [bridgePreflightForm, setBridgePreflightForm] = useState({
    operationType: "fleet-dispatch" as BridgeOperationType,
    operationValueUsd: "3500",
    routeComplexity: "3",
    riskTolerance: "medium" as BridgeRiskTolerance,
  });
  const [bridgeMapPreset, setBridgeMapPreset] = useState<BridgeMapPresetKey>("Command");
  const [bridgeMapLayers, setBridgeMapLayers] = useState<BridgeMapLayers>({
    fleets: true,
    enemies: true,
    resources: true,
    routes: true,
    riskZones: true,
  });

  const connectedWalletAddress = publicKey?.toBase58() || "";
  const marketWallet = connectedWalletAddress || manualMarketWallet;
  const [walletAuthToken, setWalletAuthToken] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem("walletAuthToken") || "";
  });
  const [walletAuthUser, setWalletAuthUser] = useState<WalletAuthUserProfile | null>(null);
  const [walletAuthBusy, setWalletAuthBusy] = useState(false);
  const [walletAuthMessage, setWalletAuthMessage] = useState<string | null>(null);
  const [devAdminPassword, setDevAdminPassword] = useState("");
  const [hasBridgeAccess, setHasBridgeAccess] = useState(false);
  const [bridgeAccessChecked, setBridgeAccessChecked] = useState(false);
  const [bridgeAccessList, setBridgeAccessList] = useState<BridgeAccessEntry[]>([]);
  const [bridgeAccessWalletInput, setBridgeAccessWalletInput] = useState("");
  const [bridgeAccessBusy, setBridgeAccessBusy] = useState(false);
  const [bridgeAccessMessage, setBridgeAccessMessage] = useState<string | null>(null);
  const [bridgeAuditReferenceNow, setBridgeAuditReferenceNow] = useState(() => Date.now());

  const isWalletSessionBound = Boolean(
    connected &&
      connectedWalletAddress &&
      walletAuthToken &&
      walletAuthUser?.wallet === connectedWalletAddress,
  );
  const isAdminSession = Boolean(walletAuthToken && walletAuthUser?.isAdmin);
  const bridgeAccessActive = hasBridgeAccess && (isWalletSessionBound || isAdminSession);

  const craftCatalogItems = useMemo(
    () => (craftCatalog?.items?.length ? craftCatalog.items : LOCAL_CRAFT_REFERENCE_ITEMS),
    [craftCatalog],
  );

  const craftReferenceCategories = useMemo(
    () => buildCraftReferenceCategories(craftCatalogItems),
    [craftCatalogItems],
  );

  const craftReferenceRows = useMemo(
    () =>
      craftCatalogItems.map((item) => ({
        category: item.group === "compound-material" ? "Compound Material" : "Component",
        item: item.name,
        tier: item.verified ? item.tier || "-" : "",
        recipeDraft: item.recipeDraft,
        output: item.output,
        status: item.status,
        verified: item.verified,
      })),
    [craftCatalogItems],
  );

  const planetaryPoolTotals = useMemo(() => {
    if (!miningMetrics?.resources?.length) {
      return {
        totalMined: "0",
        totalDailyMined: "0",
        resourcesWithMiningData: 0,
      };
    }

    let totalMined = 0n;
    let totalDailyMined = 0n;
    let resourcesWithMiningData = 0;

    for (const resource of miningMetrics.resources) {
      const mined = parseIntegerStringToBigInt(resource.totalMined);
      const daily = parseIntegerStringToBigInt(resource.dailyMined);

      if (mined > 0n || daily > 0n) {
        resourcesWithMiningData += 1;
      }

      totalMined += mined;
      totalDailyMined += daily;
    }

    return {
      totalMined: totalMined.toString(),
      totalDailyMined: totalDailyMined.toString(),
      resourcesWithMiningData,
    };
  }, [miningMetrics]);

  const bridgeFilteredAuditData = useMemo(() => {
    const periodMsMap: Record<BridgeAuditPeriod, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      all: Number.POSITIVE_INFINITY,
    };

    const maxAgeMs = periodMsMap[bridgeAuditPeriodFilter];

    return bridgeAuditData.filter((event) => {
      if (bridgeAuditTypeFilter !== "all" && event.eventType !== bridgeAuditTypeFilter) {
        return false;
      }

      if (!Number.isFinite(maxAgeMs)) {
        return true;
      }

      const createdAtMs = new Date(event.createdAt).getTime();
      if (!Number.isFinite(createdAtMs)) {
        return false;
      }

      return bridgeAuditReferenceNow - createdAtMs <= maxAgeMs;
    });
  }, [bridgeAuditData, bridgeAuditPeriodFilter, bridgeAuditReferenceNow, bridgeAuditTypeFilter]);

  useEffect(() => {
    setBridgeAuditReferenceNow(Date.now());
  }, [bridgeAuditData, bridgeAuditPeriodFilter, bridgeAuditTypeFilter]);

  const exportBridgeAudit = (format: "json" | "csv") => {
    if (!bridgeFilteredAuditData.length) {
      setBridgeMessage("Нет данных для экспорта Audit Trail по текущим фильтрам.");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let content = "";
    let filename = "";
    let mimeType = "";

    if (format === "json") {
      content = JSON.stringify(bridgeFilteredAuditData, null, 2);
      filename = `bridge-audit-${bridgeRole}-${timestamp}.json`;
      mimeType = "application/json;charset=utf-8";
    } else {
      const escapeCsv = (value: unknown) => {
        const text = String(value ?? "");
        const escaped = text.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const header = [
        "id",
        "eventType",
        "role",
        "profile",
        "actorWallet",
        "createdAt",
        "details",
      ].join(",");

      const rows = bridgeFilteredAuditData.map((event) =>
        [
          escapeCsv(event.id),
          escapeCsv(event.eventType),
          escapeCsv(event.role),
          escapeCsv(event.profile || ""),
          escapeCsv(event.actorWallet || ""),
          escapeCsv(event.createdAt),
          escapeCsv(JSON.stringify(event.details)),
        ].join(","),
      );

      content = [header, ...rows].join("\n");
      filename = `bridge-audit-${bridgeRole}-${timestamp}.csv`;
      mimeType = "text/csv;charset=utf-8";
    }

    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    setBridgeMessage(`Audit Trail экспортирован: ${filename}`);
  };

  const exportResourcesCsv = () => {
    if (!miningMetrics?.resources?.length) {
      setMiningError("Нет данных ресурсов для экспорта CSV.");
      return;
    }

    const escapeCsv = (value: unknown) => {
      const text = String(value ?? "");
      const escaped = text.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = [
      "resource",
      "mint",
      "mintSource",
      "totalFleets",
      "totalMined",
      "dailyMined",
      "playerWalletBalance",
      "developerWalletBalance",
      "resourceHardness",
      "averageSystemRichness",
      "mud",
      "oni",
      "ustur",
      "updatedAt",
    ].join(",");

    const rows = miningMetrics.resources.map((resource) =>
      [
        escapeCsv(resource.resource),
        escapeCsv(resource.resourceMint || ""),
        escapeCsv(resource.resourceMintSource || "unresolved"),
        escapeCsv(resource.totalFleets),
        escapeCsv(resource.totalMined || ""),
        escapeCsv(resource.dailyMined || ""),
        escapeCsv(resource.playerWalletBalance ?? ""),
        escapeCsv(resource.developerWalletBalance ?? ""),
        escapeCsv(resource.resourceHardness ?? ""),
        escapeCsv(resource.averageSystemRichness ?? ""),
        escapeCsv(resource.byFaction.MUD || 0),
        escapeCsv(resource.byFaction.ONI || 0),
        escapeCsv(resource.byFaction.USTUR || 0),
        escapeCsv(resource.updatedAt || miningMetrics.updatedAt),
      ].join(","),
    );

    const content = [header, ...rows].join("\n");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `resources-split-${timestamp}.csv`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  const visibleAssets = useMemo(() => {
    if (!data) {
      return [] as FleetAsset[];
    }

    let byPreset = data.assets;

    if (assetFilter === "priced") {
      byPreset = byPreset.filter((asset) => asset.estimatedValueUsd > 0);
    }

    if (assetFilter === "star-atlas") {
      byPreset = byPreset.filter((asset) => asset.isStarAtlas === true);
    }

    const byClass =
      classFilter === "all"
        ? byPreset
        : byPreset.filter((asset) => asset.class === classFilter);

    const sorted = [...byClass].sort((left, right) => {
      if (sortMode === "value-desc") {
        return right.estimatedValueUsd - left.estimatedValueUsd;
      }

      if (sortMode === "value-asc") {
        return left.estimatedValueUsd - right.estimatedValueUsd;
      }

      if (sortMode === "qty-desc") {
        return right.quantity - left.quantity;
      }

      if (sortMode === "qty-asc") {
        return left.quantity - right.quantity;
      }

      if (sortMode === "class") {
        const classCmp = left.class.localeCompare(right.class);
        return classCmp !== 0 ? classCmp : left.name.localeCompare(right.name);
      }

      return left.name.localeCompare(right.name);
    });

    return sorted;
  }, [assetFilter, classFilter, data, sortMode]);

  const topAsset = useMemo(() => {
    if (!visibleAssets.length) {
      return null;
    }

    return [...visibleAssets].sort(
      (left, right) => right.estimatedValueUsd - left.estimatedValueUsd,
    )[0];
  }, [visibleAssets]);

  const refreshWalletSession = async (token: string) => {
    if (!token) {
      setWalletAuthUser(null);
      return;
    }

    try {
      const payload = await apiRequest<WalletAuthSessionResponse>(
        "/api/auth/wallet/session",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      setWalletAuthUser(payload.user);
    } catch (sessionError) {
      setWalletAuthToken("");
      setWalletAuthUser(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("walletAuthToken");
      }
      console.error(sessionError);
    }
  };

  const loadBridgeAccessMe = async (token: string) => {
    if (!token) {
      setHasBridgeAccess(false);
      setBridgeAccessChecked(true);
      return;
    }

    try {
      const payload = await apiRequest<BridgeAccessMeResponse>("/api/bridge/access/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setHasBridgeAccess(payload.hasBridgeAccess);
    } catch (error) {
      setHasBridgeAccess(false);
      console.error(error);
    } finally {
      setBridgeAccessChecked(true);
    }
  };

  const loadBridgeAccessList = useCallback(async (token: string) => {
    if (!token || !walletAuthUser?.isAdmin) return;

    try {
      const payload = await apiRequest<BridgeAccessListResponse>(
        "/api/bridge/admin/access-list",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      setBridgeAccessList(payload.entries);
    } catch (error) {
      setBridgeAccessMessage(`Не удалось загрузить доступы Bridge: ${getErrorMessage(error)}`);
    }
  }, [walletAuthUser?.isAdmin]);

  const grantBridgeAccess = async () => {
    if (!walletAuthToken || !walletAuthUser?.isAdmin) {
      setBridgeAccessMessage("Доступно только для администратора.");
      return;
    }

    const walletToGrant = bridgeAccessWalletInput.trim();
    if (!walletToGrant) {
      setBridgeAccessMessage("Укажи кошелек для выдачи доступа.");
      return;
    }

    setBridgeAccessBusy(true);
    setBridgeAccessMessage(null);

    try {
      await apiRequest("/api/bridge/admin/access-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({ wallet: walletToGrant }),
      });

      setBridgeAccessWalletInput("");
      setBridgeAccessMessage("Доступ выдан.");
      await loadBridgeAccessList(walletAuthToken);
    } catch (error) {
      setBridgeAccessMessage(`Ошибка выдачи доступа: ${getErrorMessage(error)}`);
    } finally {
      setBridgeAccessBusy(false);
    }
  };

  const revokeBridgeAccess = async (walletToRevoke: string) => {
    if (!walletAuthToken || !walletAuthUser?.isAdmin) {
      setBridgeAccessMessage("Доступно только для администратора.");
      return;
    }

    setBridgeAccessBusy(true);
    setBridgeAccessMessage(null);

    try {
      await apiRequest(`/api/bridge/admin/access-list/${encodeURIComponent(walletToRevoke)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${walletAuthToken}`,
        },
      });
      setBridgeAccessMessage("Доступ отозван.");
      await loadBridgeAccessList(walletAuthToken);
    } catch (error) {
      setBridgeAccessMessage(`Ошибка отзыва доступа: ${getErrorMessage(error)}`);
    } finally {
      setBridgeAccessBusy(false);
    }
  };

  const registerAndVerifyWallet = async () => {
    if (!connected || !connectedWalletAddress) {
      setWalletAuthMessage("Подключи Solana wallet для регистрации и верификации.");
      return;
    }

    if (!signMessage) {
      setWalletAuthMessage(
        "Текущий кошелек/аккаунт не поддерживает подпись сообщений. Для Solflare Ledger обычно нужен не-Ledger аккаунт для signMessage.",
      );
      return;
    }

    setWalletAuthBusy(true);
    setWalletAuthMessage(null);

    try {
      let challengePayload: WalletAuthChallengeResponse;
      try {
        challengePayload = await apiRequest<WalletAuthChallengeResponse>(
          "/api/auth/wallet/challenge",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              wallet: connectedWalletAddress,
            }),
          },
        );
      } catch (challengeError) {
        setWalletAuthMessage(
          `Не удалось получить challenge: ${getErrorMessage(challengeError)}`,
        );
        return;
      }

      let signatureBase64 = "";
      try {
        const signed = await signMessage(
          new TextEncoder().encode(challengePayload.challenge.message),
        );
        signatureBase64 = btoa(String.fromCharCode(...signed));
      } catch (signError) {
        if (!signTransaction) {
          setWalletAuthMessage(
            `Ошибка подписи сообщения: ${getErrorMessage(signError)}. Проверь Solflare/Ledger и подтверди подпись на устройстве.`,
          );
          return;
        }

        try {
          const memoPayload = `star-atlas-auth:${challengePayload.challenge.challengeId}:${challengePayload.challenge.nonce}`;
          const memoInstruction = new TransactionInstruction({
            keys: [],
            programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            data: new TextEncoder().encode(memoPayload) as unknown as never,
          });

          let blockhash = "11111111111111111111111111111111";
          try {
            const latest = await connection.getLatestBlockhash("confirmed");
            if (latest?.blockhash) {
              blockhash = latest.blockhash;
            }
          } catch {
            // RPC can be forbidden/rate-limited in browser; use offline blockhash for local signing fallback.
          }
          const tx = new Transaction();
          tx.add(memoInstruction);
          tx.feePayer = new PublicKey(connectedWalletAddress);
          tx.recentBlockhash = blockhash;

          const signedTx = await signTransaction(tx);
          const signedTxBase64 = btoa(
            String.fromCharCode(
              ...signedTx.serialize({ verifySignatures: false, requireAllSignatures: false }),
            ),
          );

          let verifyByTxPayload: WalletAuthVerifyResponse;
          try {
            verifyByTxPayload = await apiRequest<WalletAuthVerifyResponse>(
              "/api/auth/wallet/verify-transaction",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  wallet: connectedWalletAddress,
                  challengeId: challengePayload.challenge.challengeId,
                  signedTransaction: signedTxBase64,
                }),
              },
            );
          } catch (verifyByTxError) {
            setWalletAuthMessage(
              `Ошибка fallback verify через transaction: ${getErrorMessage(verifyByTxError)}`,
            );
            return;
          }

          setWalletAuthToken(verifyByTxPayload.token);
          setWalletAuthUser(verifyByTxPayload.user);
          if (typeof window !== "undefined") {
            window.localStorage.setItem("walletAuthToken", verifyByTxPayload.token);
          }

          setWalletAuthMessage(
            verifyByTxPayload.isNewRegistration
              ? "Кошелек зарегистрирован и верифицирован."
              : "Кошелек успешно верифицирован. Сессия обновлена.",
          );
          return;
        } catch (transactionFallbackError) {
          setWalletAuthMessage(
            `Ошибка подписи сообщения: ${getErrorMessage(signError)}. Fallback через transaction тоже не прошел: ${getErrorMessage(transactionFallbackError)}`,
          );
          return;
        }
      }

      let verifyPayload: WalletAuthVerifyResponse;
      try {
        verifyPayload = await apiRequest<WalletAuthVerifyResponse>(
          "/api/auth/wallet/verify",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              wallet: connectedWalletAddress,
              challengeId: challengePayload.challenge.challengeId,
              signature: signatureBase64,
            }),
          },
        );
      } catch (verifyError) {
        setWalletAuthMessage(
          `Challenge подписан, но verify не прошел: ${getErrorMessage(verifyError)}`,
        );
        return;
      }

      setWalletAuthToken(verifyPayload.token);
      setWalletAuthUser(verifyPayload.user);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("walletAuthToken", verifyPayload.token);
      }

      setWalletAuthMessage(
        verifyPayload.isNewRegistration
          ? "Кошелек зарегистрирован и верифицирован."
          : "Кошелек успешно верифицирован. Сессия обновлена.",
      );
    } catch (authError) {
      setWalletAuthMessage(
        `Не удалось завершить регистрацию/верификацию: ${getErrorMessage(authError)}`,
      );
      console.error(authError);
    } finally {
      setWalletAuthBusy(false);
    }
  };

  const logoutWalletSession = async () => {
    if (!walletAuthToken) {
      setWalletAuthUser(null);
      setWalletAuthMessage("Сессия уже завершена.");
      return;
    }

    setWalletAuthBusy(true);
    setWalletAuthMessage(null);

    try {
      await apiRequest("/api/auth/wallet/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${walletAuthToken}`,
        },
      });
    } catch (logoutError) {
      console.error(logoutError);
    } finally {
      setWalletAuthToken("");
      setWalletAuthUser(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("walletAuthToken");
      }
      setWalletAuthBusy(false);
      setWalletAuthMessage("Сессия кошелька завершена.");
    }
  };

  const loginDevAdminByPassword = async () => {
    const password = devAdminPassword.trim();
    if (!password) {
      setWalletAuthMessage("Введи пароль администратора.");
      return;
    }

    setWalletAuthBusy(true);
    setWalletAuthMessage(null);

    try {
      const payload = await apiRequest<WalletAuthVerifyResponse>("/api/auth/dev-admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
        }),
      });

      setWalletAuthToken(payload.token);
      setWalletAuthUser(payload.user);
      setDevAdminPassword("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem("walletAuthToken", payload.token);
      }

      setWalletAuthMessage("Dev admin сессия открыта.");
    } catch (error) {
      setWalletAuthMessage(`Ошибка dev admin login: ${getErrorMessage(error)}`);
    } finally {
      setWalletAuthBusy(false);
    }
  };

  const loadDashboard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint =
        mode === "wallet"
          ? `/api/dashboard/wallet/${encodeURIComponent(wallet.trim())}`
          : `/api/dashboard/${encodeURIComponent(handle.trim())}`;
      const payload = await apiRequest<DashboardSnapshot>(endpoint);
      setData(payload);
    } catch (requestError) {
      const common = "Не удалось загрузить данные. Убедись, что API запущен.";
      const walletHint =
        " Для режима кошелька нужен корректный Solana-адрес (base58).";
      setError(mode === "wallet" ? `${common}${walletHint}` : common);
      setData(null);
      console.error(requestError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connectedWalletAddress) {
      setWallet(connectedWalletAddress);
    }
  }, [connectedWalletAddress]);

  useEffect(() => {
    if (walletAuthToken) {
      void refreshWalletSession(walletAuthToken);
      void loadBridgeAccessMe(walletAuthToken);
      return;
    }
    setWalletAuthUser(null);
    setHasBridgeAccess(false);
    setBridgeAccessChecked(true);
    setBridgeAccessList([]);
    setBridgeAccessMessage(null);
  }, [walletAuthToken]);

  useEffect(() => {
    if (activeTab === "bridge" && bridgeAccessChecked && !bridgeAccessActive) {
      setActiveTab("news");
    }
  }, [activeTab, bridgeAccessChecked, bridgeAccessActive]);

  useEffect(() => {
    if (activeTab !== "bridge") {
      setBridgeWorkspaceView(null);
    }
  }, [activeTab]);

  const loadMarketSettings = async () => {
    setSettingsBusy(true);
    setSettingsMessage(null);

    try {
      const payload = await apiRequest<MarketSettings>("/api/market/settings");
      setMarketSettings(payload);
      setCollectionsInput(payload.collections.join("\n"));
      setKeywordsInput(payload.keywords.join("\n"));
    } catch (loadError) {
      setSettingsMessage("Не удалось загрузить настройки рынка.");
      console.error(loadError);
    } finally {
      setSettingsBusy(false);
    }
  };

  const loadListings = useCallback(async () => {
    setListingsBusy(true);
    setListingsMessage(null);

    try {
      const params = new URLSearchParams();
      params.set("status", listingsStatus);
      params.set("itemClass", listingsClass);
      if (listingsSearch.trim()) {
        params.set("search", listingsSearch.trim());
      }

      const payload = await apiRequest<MarketListing[]>(
        `/api/market/listings?${params.toString()}`,
      );
      setListings(payload);
    } catch (listError) {
      setListingsMessage("Не удалось загрузить листинги рынка.");
      console.error(listError);
    } finally {
      setListingsBusy(false);
    }
  }, [listingsClass, listingsSearch, listingsStatus]);

  const loadSellPickerNfts = async (token: string) => {
    setSellPickerLoading(true);
    setSellPickerError(null);
    try {
      const data = await apiRequest<MarketWalletNftsResponse>("/api/market/wallet-nfts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSellPickerNfts(data.nfts);
    } catch (err) {
      setSellPickerError(
        err instanceof Error ? err.message : "Не удалось загрузить NFT из кошелька.",
      );
    } finally {
      setSellPickerLoading(false);
    }
  };

  const loadMarketConfig = async () => {
    try {
      const data = await apiRequest<MarketConfig>("/api/market/config");
      setMarketConfig(data);
    } catch {
      // optional
    }
  };

  const filteredSellPickerNfts = useMemo(() => {
    const q = sellPickerSearch.trim().toLowerCase();
    if (!q) return sellPickerNfts;
    return sellPickerNfts.filter((nft) => {
      const name = (nft.name ?? "").toLowerCase();
      const mint = nft.mint.toLowerCase();
      return name.includes(q) || mint.includes(q);
    });
  }, [sellPickerNfts, sellPickerSearch]);

  const createListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setListingsMessage(null);

    if (!walletAuthToken) {
      setListingsMessage("Сначала зарегистрируй и верифицируй кошелек.");
      return;
    }

    if (!connected || !publicKey || !signTransaction) {
      setListingsMessage("Подключи кошелек, который выставляет NFT, и подпиши транзакцию.");
      return;
    }

    const sellerWallet = marketWallet.trim();
    if (!sellerWallet) {
      setListingsMessage("Сначала укажи кошелек в разделе Market.");
      return;
    }

    if (!isLikelySolanaAddress(sellerWallet)) {
      setListingsMessage("Некорректный адрес кошелька для продажи.");
      return;
    }

    if (sellerWallet !== publicKey.toBase58()) {
      setListingsMessage("Для escrow нужно, чтобы подключенный кошелек совпадал с кошельком продавца.");
      return;
    }

    if (!sellPickerSelected) {
      setListingsMessage("Выбери NFT из списка кошелька.");
      return;
    }

    const priceUsd = parseNonNegativeNumber(newListing.priceUsd);
    if (priceUsd === null || priceUsd <= 0) {
      setListingsMessage("Цена должна быть числом больше 0.");
      return;
    }

    try {
      setListingsMessage("Переводим NFT в escrow кошелек рынка...");

      const mintPubkey = new PublicKey(sellPickerSelected.mint);
      const escrowOwner = new PublicKey(
        marketConfig?.escrowWallet ?? "YQmg9nTsvVLUgtj35pY8WUPRVGHaz7KfmaCgPuS6bwY",
      );
      const sellerAta = getAta(mintPubkey, publicKey);
      const escrowAta = getAta(mintPubkey, escrowOwner);

      const escrowTx = new Transaction();
      escrowTx.add(createAtaIdempotentInstruction(publicKey, escrowAta, escrowOwner, mintPubkey));
      escrowTx.add(splTransferInstruction(sellerAta, escrowAta, publicKey, 1n));
      escrowTx.feePayer = publicKey;

      const { blockhash } = await getLatestBlockhashSafe(connection);
      escrowTx.recentBlockhash = blockhash;

      const signedEscrowTx = await signTransaction(escrowTx);
      const escrowSignature = await sendRawTransactionSafe(
        connection,
        signedEscrowTx.serialize(),
      );

      setListingsMessage("Escrow подтвержден. Создаем листинг...");

      await apiRequest<MarketListing>("/api/market/listings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({
          itemName: sellPickerSelected.name ?? sellPickerSelected.mint,
          itemClass: "NFT",
          quantity: 1,
          priceUsd,
          paymentToken: "USDC",
          sellerWallet,
          note: newListing.note.trim(),
          mint: sellPickerSelected.mint,
          image: sellPickerSelected.image ?? undefined,
          escrowTxSignature: escrowSignature,
        }),
      });

      setNewListing({
        itemName: "",
        itemClass: "Resource",
        quantity: "1",
        priceUsd: "",
        paymentToken: "USDC",
        note: "",
      });
      setSellPickerSelected(null);
      setListingsMessage("NFT переведен в escrow и выставлен на рынок.");
      await loadListings();
      await loadSellPickerNfts(walletAuthToken);
    } catch (createError) {
      setListingsMessage(`Ошибка создания листинга: ${getErrorMessage(createError)}`);
      console.error(createError);
    }
  };

  const buyListing = async (listingId: string, txSignature?: string) => {
    setListingsMessage(null);

    if (!walletAuthToken) {
      setListingsMessage("Сначала зарегистрируй и верифицируй кошелек.");
      return;
    }

    try {
      const result = await apiRequest<MarketBuyResponse>(`/api/market/listings/${listingId}/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({ txSignature }),
      });

      if (result.settlement?.status === "completed") {
        setListingsMessage("Оплата подтверждена, NFT автоматически передан покупателю.");
      } else if (result.settlement?.status === "pending") {
        setListingsMessage(
          `Оплата подтверждена, но settlement в ожидании: ${result.settlement.reason ?? "без причины"}`,
        );
      } else {
        setListingsMessage(result.message || "Покупка подтверждена.");
      }
      await loadListings();
    } catch (buyError) {
      setListingsMessage("Ошибка покупки лота.");
      console.error(buyError);
    }
  };

  const buyListingWithUsdc = async (listing: MarketListing) => {
    if (!connected || !publicKey || !signTransaction) {
      setListingsMessage("Подключи кошелек для оплаты USDC.");
      return;
    }

    if (!walletAuthToken) {
      setListingsMessage("Сначала зарегистрируй и верифицируй кошелек.");
      return;
    }

    if (listing.sellerWallet === publicKey.toBase58()) {
      setListingsMessage("Нельзя купить собственный лот.");
      return;
    }

    setListingsBusy(true);
    setListingsMessage("Подготовка USDC транзакции...");

    try {
      const usdcMint = new PublicKey(
        marketConfig?.usdcMint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      );
      const platformWallet = new PublicKey(
        marketConfig?.platformFeeWallet ?? "7BNFxaeXA2DPLRnYeRLEMqA5gAWgMGdG3tcJBFrbzH5v",
      );
      const feeBps = marketConfig?.platformFeeBps ?? 100;
      const sellerWallet = new PublicKey(listing.sellerWallet);

      const buyerAta = getAta(usdcMint, publicKey);
      const sellerAta = getAta(usdcMint, sellerWallet);
      const platformAta = getAta(usdcMint, platformWallet);

      const totalRaw = BigInt(Math.round(listing.priceUsd * 1_000_000));
      const feeRaw = BigInt(Math.round(Number(totalRaw) * feeBps / 10_000));
      const sellerRaw = totalRaw - feeRaw;

      const tx = new Transaction();
      tx.add(createAtaIdempotentInstruction(publicKey, sellerAta, sellerWallet, usdcMint));
      if (feeRaw > 0n) {
        tx.add(createAtaIdempotentInstruction(publicKey, platformAta, platformWallet, usdcMint));
      }
      tx.add(splTransferInstruction(buyerAta, sellerAta, publicKey, sellerRaw));
      if (feeRaw > 0n) {
        tx.add(splTransferInstruction(buyerAta, platformAta, publicKey, feeRaw));
      }

      tx.feePayer = publicKey;
      const { blockhash } = await getLatestBlockhashSafe(connection);
      tx.recentBlockhash = blockhash;

      const signed = await signTransaction(tx);
      const signature = await sendRawTransactionSafe(connection, signed.serialize());

      await buyListing(listing.id, signature);
    } catch (buyError) {
      setListingsMessage(`Ошибка оплаты: ${getErrorMessage(buyError)}`);
    } finally {
      setListingsBusy(false);
    }
  };

  const loadBarters = useCallback(async () => {
    setBartersBusy(true);
    setBartersMessage(null);

    try {
      const payload = await apiRequest<BarterOffer[]>(
        `/api/market/barters?status=${bartersStatus}`,
      );
      setBarters(payload);
    } catch (barterError) {
      setBartersMessage("Не удалось загрузить офферы обмена.");
      console.error(barterError);
    } finally {
      setBartersBusy(false);
    }
  }, [bartersStatus]);

  const createBarter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBartersMessage(null);

    if (!walletAuthToken) {
      setBartersMessage("Сначала зарегистрируй и верифицируй кошелек.");
      return;
    }

    const fromWallet = marketWallet.trim();
    if (!fromWallet) {
      setBartersMessage("Сначала укажи кошелек в разделе Market.");
      return;
    }

    if (!isLikelySolanaAddress(fromWallet)) {
      setBartersMessage("Некорректный адрес кошелька для обмена.");
      return;
    }

    const offerItem = newBarter.offerItem.trim();
    const wantItem = newBarter.wantItem.trim();

    if (!offerItem || !wantItem) {
      setBartersMessage("Заполни поля «Что отдаю» и «Что хочу получить».");
      return;
    }

    if (offerItem.toLowerCase() === wantItem.toLowerCase()) {
      setBartersMessage("Одинаковые активы для обмена указаны некорректно.");
      return;
    }

    const extraUsd = parseNonNegativeNumber(newBarter.extraUsd || "0");
    if (extraUsd === null) {
      setBartersMessage("Доплата должна быть числом 0 или больше.");
      return;
    }

    try {
      await apiRequest<BarterOffer>("/api/market/barters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({
          fromWallet,
          offerItem,
          wantItem,
          extraUsd,
          note: newBarter.note.trim(),
        }),
      });

      setNewBarter({ offerItem: "", wantItem: "", extraUsd: "0", note: "" });
      setBartersMessage("Оффер обмена создан.");
      await loadBarters();
    } catch (createError) {
      setBartersMessage("Ошибка создания оффера обмена.");
      console.error(createError);
    }
  };

  const respondBarter = async (id: string, action: "accept" | "decline") => {
    setBartersMessage(null);

    if (!walletAuthToken) {
      setBartersMessage("Сначала зарегистрируй и верифицируй кошелек.");
      return;
    }

    const responderWallet = marketWallet.trim();
    if (!responderWallet) {
      setBartersMessage("Для ответа на обмен укажи кошелек.");
      return;
    }

    if (!isLikelySolanaAddress(responderWallet)) {
      setBartersMessage("Некорректный адрес кошелька для ответа на обмен.");
      return;
    }

    try {
      await apiRequest(`/api/market/barters/${id}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({ responderWallet, action }),
      });

      setBartersMessage(
        action === "accept" ? "Обмен принят (симуляция)." : "Обмен отклонен.",
      );
      await loadBarters();
    } catch (respondError) {
      setBartersMessage("Ошибка ответа на оффер.");
      console.error(respondError);
    }
  };

  const saveMarketSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSettingsBusy(true);
    setSettingsMessage(null);

    const collections = parseListInput(collectionsInput);
    const keywords = parseListInput(keywordsInput);

    if (!collections.length) {
      setSettingsBusy(false);
      setSettingsMessage("Добавь хотя бы одну collection для сохранения.");
      return;
    }

    if (!keywords.length) {
      setSettingsBusy(false);
      setSettingsMessage("Добавь хотя бы одно ключевое слово для сохранения.");
      return;
    }

    try {
      const payload = await apiRequest<MarketSettings>("/api/market/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collections,
          keywords,
        }),
      });
      setMarketSettings(payload);
      setCollectionsInput(payload.collections.join("\n"));
      setKeywordsInput(payload.keywords.join("\n"));
      setSettingsMessage("Настройки успешно сохранены.");
    } catch (saveError) {
      setSettingsMessage("Ошибка сохранения настроек рынка.");
      console.error(saveError);
    } finally {
      setSettingsBusy(false);
    }
  };

  const loadIntelOverview = async () => {
    setIntelLoading(true);
    setIntelError(null);

    try {
      const payload = await apiRequest<IntelOverview>("/api/intel/overview?limit=50");
      setIntelData(payload);
    } catch (overviewError) {
      setIntelError("Не удалось загрузить обзор каналов Star Atlas.");
      console.error(overviewError);
    } finally {
      setIntelLoading(false);
    }
  };

  const loadNewsArchive = async () => {
    setArchiveLoading(true);
    setArchiveError(null);

    try {
      const payload = await apiRequest<NewsArchiveResponse>(
        "/api/news/archive?limit=40",
      );
      setArchiveData(payload);
    } catch (requestError) {
      setArchiveError("Не удалось загрузить архив новостей.");
      console.error(requestError);
    } finally {
      setArchiveLoading(false);
    }
  };

  const loadMiningMetrics = useCallback(async (quiet = false) => {
    if (!quiet) {
      setMiningLoading(true);
      setMiningError(null);
    }

    try {
      const payload = await apiRequest<BridgeMiningMetrics>("/api/bridge/resources");
      setMiningMetrics(payload);
      if (!quiet) {
        setMiningError(null);
      }
    } catch (requestError) {
      if (!quiet) {
        setMiningError("Не удалось загрузить метрики добычи.");
      }
      console.error(requestError);
    } finally {
      if (!quiet) {
        setMiningLoading(false);
      }
    }
  }, []);

  const loadR4Metrics = useCallback(async (quiet = false) => {
    if (!quiet) {
      setR4Loading(true);
      setR4Error(null);
    }

    try {
      const payload = await apiRequest<BridgeR4Metrics>("/api/bridge/resources-r4");
      setR4Metrics(payload);
      if (!quiet) {
        setR4Error(null);
      }
    } catch (requestError) {
      if (!quiet) {
        setR4Error("Не удалось загрузить метрики R4.");
      }
      console.error(requestError);
    } finally {
      if (!quiet) {
        setR4Loading(false);
      }
    }
  }, []);

  const loadCraftCatalog = useCallback(async (quiet = false) => {
    if (!quiet) {
      setCraftCatalogLoading(true);
      setCraftCatalogError(null);
    }

    try {
      const payload = await apiRequest<BridgeCraftCatalogResponse>("/api/bridge/craft-catalog");
      setCraftCatalog(payload);
      if (!quiet) {
        setCraftCatalogError(null);
      }
    } catch (requestError) {
      if (!quiet) {
        setCraftCatalogError("Не удалось загрузить каталог крафта. Используем локальный черновик.");
      }
      console.error(requestError);
    } finally {
      if (!quiet) {
        setCraftCatalogLoading(false);
      }
    }
  }, []);

  const loadWhales = useCallback(async () => {
    setWhalesLoading(true);
    setWhalesError(null);
    try {
      const payload = await apiRequest<WhalesSnapshot>("/api/whales");
      setWhalesData(payload);
    } catch (requestError) {
      setWhalesError("Не удалось загрузить данные по китам. Попробуй позже.");
      console.error(requestError);
    } finally {
      setWhalesLoading(false);
    }
  }, []);

  const loadTicker = useCallback(async () => {
    setTickerLoading(true);
    try {
      const payload = await apiRequest<StarAtlasTickerSnapshot>("/api/market/star-atlas-ticker");
      setTickerData(payload);
    } catch (requestError) {
      console.error(requestError);
    } finally {
      setTickerLoading(false);
    }
  }, []);

  const loadBridgeRuntime = useCallback(async (
    role: BridgeRole = bridgeRole,
    profile: BridgeC4Profile = bridgeProfile,
  ) => {
    if (!walletAuthToken) {
      setBridgeMessage("Сначала войди в wallet-сессию для доступа к Captain's Bridge.");
      return;
    }

    setBridgeLoading(true);
    setBridgeMessage(null);

    try {
      const [config, alerts, audit] = await Promise.all([
        apiRequest<BridgeConfig>(
          `/api/bridge/config?role=${encodeURIComponent(role)}&profile=${encodeURIComponent(profile)}`,
          {
            headers: {
              Authorization: `Bearer ${walletAuthToken}`,
            },
          },
        ),
        apiRequest<BridgeAlertsResponse>(
          `/api/bridge/alerts?role=${encodeURIComponent(role)}&limit=12`,
          {
            headers: {
              Authorization: `Bearer ${walletAuthToken}`,
            },
          },
        ),
        apiRequest<BridgeAuditResponse>(
          `/api/bridge/audit?role=${encodeURIComponent(role)}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${walletAuthToken}`,
            },
          },
        ),
      ]);

      setBridgeConfig(config);
      setBridgeRole(config.role);
      setBridgeProfile(config.activeProfile);
      setBridgeAlertsData(alerts.items);
      setBridgeAuditData(audit.items);
    } catch (bridgeError) {
      setBridgeMessage("Не удалось загрузить C4 runtime для Captain Bridge.");
      console.error(bridgeError);
    } finally {
      setBridgeLoading(false);
    }
  }, [bridgeProfile, bridgeRole, walletAuthToken]);

  const loadBridgeLiveMap = useCallback(async (
    role: BridgeRole = bridgeRole,
    profile: BridgeC4Profile = bridgeProfile,
    quiet = false,
  ) => {
    if (!walletAuthToken) return;

    if (!quiet) {
      setBridgeLiveMapLoading(true);
    }
    setBridgeLiveMapError(null);

    try {
      const payload = await apiRequest<BridgeLiveMapResponse>(
        `/api/bridge/live-map?role=${encodeURIComponent(role)}&profile=${encodeURIComponent(profile)}&windowMinutes=90`,
        {
          headers: {
            Authorization: `Bearer ${walletAuthToken}`,
          },
        },
      );
      setBridgeLiveMap(payload);
    } catch (error) {
      setBridgeLiveMapError(getErrorMessage(error));
    } finally {
      if (!quiet) {
        setBridgeLiveMapLoading(false);
      }
    }
  }, [bridgeProfile, bridgeRole, walletAuthToken]);

  const runBridgePreflight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!walletAuthToken) {
      setBridgeMessage("Сначала войди в wallet-сессию для доступа к Captain's Bridge.");
      return;
    }

    setBridgeBusy(true);
    setBridgeMessage(null);

    const operationValueUsd = Number(bridgePreflightForm.operationValueUsd);
    const routeComplexity = Number(bridgePreflightForm.routeComplexity);

    if (!Number.isFinite(operationValueUsd) || operationValueUsd <= 0) {
      setBridgeBusy(false);
      setBridgeMessage("Для pre-flight укажи operation value больше 0.");
      return;
    }

    if (!Number.isFinite(routeComplexity) || routeComplexity < 1 || routeComplexity > 5) {
      setBridgeBusy(false);
      setBridgeMessage("Сложность маршрута должна быть от 1 до 5.");
      return;
    }

    try {
      const payload = await apiRequest<BridgePreflight>("/api/bridge/preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({
          role: bridgeRole,
          profile: bridgeProfile,
          operationType: bridgePreflightForm.operationType,
          operationValueUsd,
          routeComplexity,
          riskTolerance: bridgePreflightForm.riskTolerance,
        }),
      });

      setBridgePreflight(payload);
      setBridgeMessage("Pre-flight расчет обновлен.");
      const audit = await apiRequest<BridgeAuditResponse>(
        `/api/bridge/audit?role=${encodeURIComponent(bridgeRole)}&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${walletAuthToken}`,
          },
        },
      );
      setBridgeAuditData(audit.items);
    } catch (bridgeError) {
      setBridgeMessage("Ошибка pre-flight расчета.");
      console.error(bridgeError);
    } finally {
      setBridgeBusy(false);
    }
  };

  const ackBridgeAlert = async (alertId: string) => {
    if (!walletAuthToken) {
      setBridgeMessage("Сначала войди в wallet-сессию для доступа к Captain's Bridge.");
      return;
    }

    setBridgeBusy(true);
    setBridgeMessage(null);

    try {
      await apiRequest(`/api/bridge/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({
          role: bridgeRole,
          profile: bridgeProfile,
          actorWallet: marketWallet || undefined,
        }),
      });

      const [alerts, audit] = await Promise.all([
        apiRequest<BridgeAlertsResponse>(
          `/api/bridge/alerts?role=${encodeURIComponent(bridgeRole)}&limit=12`,
          {
            headers: {
              Authorization: `Bearer ${walletAuthToken}`,
            },
          },
        ),
        apiRequest<BridgeAuditResponse>(
          `/api/bridge/audit?role=${encodeURIComponent(bridgeRole)}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${walletAuthToken}`,
            },
          },
        ),
      ]);
      setBridgeAlertsData(alerts.items);
      setBridgeAuditData(audit.items);
      setBridgeMessage("Alert подтвержден.");
    } catch (bridgeError) {
      setBridgeMessage("Не удалось подтвердить alert.");
      console.error(bridgeError);
    } finally {
      setBridgeBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === "market" && !marketSettings && !settingsBusy) {
      void loadMarketSettings();
    }
  }, [activeTab, marketSettings, settingsBusy]);

  useEffect(() => {
    if (activeTab === "market" && marketSection === "trade") {
      void loadListings();
    }
  }, [activeTab, loadListings, marketSection]);

  useEffect(() => {
    if (activeTab === "market" && marketSection === "trade" && !marketConfig) {
      void loadMarketConfig();
    }
  }, [activeTab, marketSection, marketConfig]);

  useEffect(() => {
    if (activeTab !== "market" || marketSection !== "trade") return;
    if (!walletAuthToken) return;
    void loadSellPickerNfts(walletAuthToken);
  }, [activeTab, marketSection, walletAuthToken]);

  useEffect(() => {
    if (activeTab === "market" && marketSection === "barter") {
      void loadBarters();
    }
  }, [activeTab, loadBarters, marketSection]);

  useEffect(() => {
    if ((activeTab === "news" || activeTab === "intel") && !intelData && !intelLoading) {
      void loadIntelOverview();
    }
  }, [activeTab, intelData, intelLoading]);

  useEffect(() => {
    if (activeTab === "resources" && !miningMetrics && !miningLoading) {
      void loadMiningMetrics();
    }
  }, [activeTab, loadMiningMetrics, miningMetrics, miningLoading]);

  useEffect(() => {
    if (activeTab === "resources" && !r4Metrics && !r4Loading) {
      void loadR4Metrics();
    }
  }, [activeTab, loadR4Metrics, r4Metrics, r4Loading]);

  useEffect(() => {
    if (activeTab === "resources" && !craftCatalog && !craftCatalogLoading) {
      void loadCraftCatalog();
    }
  }, [activeTab, craftCatalog, craftCatalogLoading, loadCraftCatalog]);

  useEffect(() => {
    if (activeTab === "whales" && !whalesData && !whalesLoading) {
      void loadWhales();
    }
  }, [activeTab, whalesData, whalesLoading, loadWhales]);

  useEffect(() => {
    if (!tickerData && !tickerLoading) {
      void loadTicker();
    }
  }, [loadTicker, tickerData, tickerLoading]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadTicker();
    }, 10 * 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadTicker]);

  useEffect(() => {
    if (activeTab === "archive" && !archiveData && !archiveLoading) {
      void loadNewsArchive();
    }
  }, [activeTab, archiveData, archiveLoading]);

  useEffect(() => {
    if (activeTab === "bridge" && !bridgeConfig && !bridgeLoading) {
      void loadBridgeRuntime();
    }
  }, [activeTab, bridgeAccessActive, bridgeConfig, bridgeLoading, loadBridgeRuntime]);

  useEffect(() => {
    if (activeTab !== "bridge" || !bridgeAccessActive || !walletAuthToken) {
      return;
    }

    void loadBridgeLiveMap(bridgeRole, bridgeProfile, false);
    const intervalId = window.setInterval(() => {
      void loadBridgeLiveMap(bridgeRole, bridgeProfile, true);
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTab, bridgeAccessActive, bridgeProfile, bridgeRole, loadBridgeLiveMap, walletAuthToken]);

  useEffect(() => {
    if (
      activeTab === "market" &&
      marketSection === "settings" &&
      walletAuthToken &&
      walletAuthUser?.isAdmin
    ) {
      void loadBridgeAccessList(walletAuthToken);
    }
  }, [activeTab, loadBridgeAccessList, marketSection, walletAuthToken, walletAuthUser?.isAdmin]);

  const sourceLabel: Record<IntelSourceKey, string> = {
    official: "Official",
    medium: "Medium",
    x: "X",
    discord: "Discord",
  };

  const bridgeMapPresets = useMemo<Array<{
    name: BridgeMapPresetKey;
    payload: string;
    layers: BridgeMapLayers;
  }>>(
    () => [
      {
        name: "Tactical",
        payload: "Флоты ДАК, враги, риск-зоны, hot-ивенты 5-15с",
        layers: { fleets: true, enemies: true, resources: false, routes: true, riskZones: true },
      },
      {
        name: "Logistics",
        payload: "Маршруты, груз, ETA, bottleneck и ресурсы в пути",
        layers: { fleets: true, enemies: false, resources: true, routes: true, riskZones: true },
      },
      {
        name: "Economy",
        payload: "NAV, спреды, burn rate, маржа крафта vs market",
        layers: { fleets: false, enemies: false, resources: true, routes: false, riskZones: true },
      },
      {
        name: "Threat",
        payload: "Вражеские контакты, аномалии, риск-зоны и периметр безопасности",
        layers: { fleets: true, enemies: true, resources: false, routes: false, riskZones: true },
      },
      {
        name: "Command",
        payload: "Сводка командования: все ключевые слои на одной карте",
        layers: { fleets: true, enemies: true, resources: true, routes: true, riskZones: true },
      },
    ],
    [],
  );

  const bridgeMapPresetByName = useMemo(
    () => new Map(bridgeMapPresets.map((preset) => [preset.name, preset])),
    [bridgeMapPresets],
  );
  const bridgeVisiblePresetNames = useMemo(() => {
    const visiblePresets = bridgeConfig?.capabilities.visiblePresets as BridgeMapPresetKey[] | undefined;
    return visiblePresets?.length
      ? visiblePresets
      : bridgeMapPresets.map((preset) => preset.name);
  }, [bridgeConfig?.capabilities.visiblePresets, bridgeMapPresets]);
  const bridgePresetSummary =
    bridgeMapPresetByName.get(bridgeMapPreset)?.payload ||
    "Выбери пресет, чтобы быстро настроить слои под задачу роли.";

  const bridgeMapFallbackFleets = [
    { id: "f-1", label: "EV Alpha", x: 180, y: 150 },
    { id: "f-2", label: "EV Cargo", x: 360, y: 220 },
    { id: "f-3", label: "EV Scout", x: 690, y: 170 },
    { id: "f-4", label: "EV Shield", x: 840, y: 355 },
  ];
  const bridgeMapFallbackEnemies = [
    { id: "e-1", label: "Raid Cell", x: 760, y: 115 },
    { id: "e-2", label: "Hostile Wing", x: 580, y: 360 },
  ];
  const bridgeMapFallbackResources = [
    { id: "r-1", label: "Fuel Node", x: 280, y: 330 },
    { id: "r-2", label: "Ore Field", x: 510, y: 120 },
    { id: "r-3", label: "Food Depot", x: 905, y: 245 },
  ];
  const bridgeMapFallbackRoutes = [
    { id: "rt-1", points: "180,150 260,180 360,220 450,245" },
    { id: "rt-2", points: "360,220 450,175 570,150 690,170" },
    { id: "rt-3", points: "690,170 760,210 810,290 840,355" },
  ];
  const bridgeFallbackRiskZones = [
    { id: "z-1", x: 590, y: 340, r: 95 },
    { id: "z-2", x: 770, y: 125, r: 72 },
  ];

  const bridgeMapImageUrl =
    bridgeLiveMap?.mapImageUrl || "https://cdn.staratlas.com/sage-labs/map-hires-dark.jpg";
  const bridgeMapFleets = bridgeLiveMap?.fleets?.length
    ? bridgeLiveMap.fleets
    : bridgeMapFallbackFleets;
  const bridgeMapEnemies = bridgeLiveMap?.enemies?.length
    ? bridgeLiveMap.enemies
    : bridgeMapFallbackEnemies;
  const bridgeMapResources = bridgeLiveMap?.resources?.length
    ? bridgeLiveMap.resources
    : bridgeMapFallbackResources;
  const bridgeMapRoutes = bridgeLiveMap?.routes?.length
    ? bridgeLiveMap.routes
    : bridgeMapFallbackRoutes;
  const bridgeRiskZones = bridgeLiveMap?.riskZones?.length
    ? bridgeLiveMap.riskZones
    : bridgeFallbackRiskZones;
  const bridgeConnectedWalletMetrics = bridgeLiveMap?.connectedWalletMetrics;
  const bridgeSageActiveProfilesMetric = bridgeLiveMap?.sageActiveProfilesMetric;

  const applyBridgePreset = (presetName: BridgeMapPresetKey) => {
    const preset = bridgeMapPresetByName.get(presetName);
    if (!preset) return;
    setBridgeMapPreset(preset.name);
    setBridgeMapLayers({ ...preset.layers });
  };

  const toggleBridgeLayer = (layer: keyof BridgeMapLayers) => {
    setBridgeMapLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  };

  const bridgeLayerLabels: Record<keyof BridgeMapLayers, string> = {
    fleets: "Флоты",
    enemies: "Угрозы",
    resources: "Ресурсы",
    routes: "Маршруты",
    riskZones: "Риск-зоны",
  };

  const bridgeLayerOrder: Array<keyof BridgeMapLayers> = [
    "fleets",
    "enemies",
    "resources",
    "routes",
    "riskZones",
  ];

  useEffect(() => {
    if (!bridgeVisiblePresetNames.length) {
      return;
    }
    if (bridgeVisiblePresetNames.includes(bridgeMapPreset)) {
      return;
    }
    const fallback = bridgeVisiblePresetNames[0];
    const preset = bridgeMapPresetByName.get(fallback);
    if (!preset) {
      return;
    }
    setBridgeMapPreset(fallback);
    setBridgeMapLayers({ ...preset.layers });
  }, [bridgeVisiblePresetNames, bridgeMapPreset, bridgeMapPresetByName]);

  const bridgeOps = [
    "Отправка/возврат флота",
    "Логистический рейс",
    "Разведка risk-зон",
    "Торговый ордер",
    "Ремонт после операции",
  ];

  const bridgeAlertPolicy = [
    "Critical: потеря флота, срыв операции, недоступность источников",
    "High: аномальные движения рынка, вход в risk-зону",
    "Normal: завершение рейса, готовность крафта",
    "Info: ежедневные сводки и soft-сигналы",
  ];

  const bridgeSecurity = [
    "Wallet-only login + строгий allowlist",
    "Access token 15м, refresh 7д с ротацией",
    "Step-up подтверждение для Captain+ действий",
    "Аудит команд и действий с correlation id",
  ];

  const bridgeMvp2Checklist = [
    "2D карта с role-presets и ручными слоями",
    "Базовые операции с pre-flight оценкой риска",
    "In-app уведомления по уровням срочности",
    "История минимум 30 дней + KPI по операциям",
  ];

  const bridgeRoles: BridgeRole[] = [
    "Fleet Admiral",
    "Admiral",
    "Captain",
    "Chief Specialist",
    "Logistics Officer",
    "Data Analyst",
    "Market Trader",
    "Threat Scout",
    "Ensign",
    "Allied Observer",
  ];

  const bridgeOperations: Array<{ key: BridgeOperationType; label: string }> = [
    { key: "fleet-dispatch", label: "Fleet Dispatch" },
    { key: "logistics-route", label: "Logistics Route" },
    { key: "recon", label: "Recon" },
    { key: "market-order", label: "Market Order" },
    { key: "repair", label: "Repair" },
  ];

  const openBridgeAccessCenter = () => {
    if (bridgeAccessActive) {
      setActiveTab("bridge");
      return;
    }

    setActiveTab("market");

    if (!connected && !walletAuthUser?.isAdmin) {
      setWalletAuthMessage("Подключи кошелек и открой wallet-сессию для доступа к Captain's Bridge.");
      return;
    }

    if (!walletAuthToken) {
      setWalletAuthMessage(
        "Открой wallet-сессию: после верификации можно запросить доступ к Captain's Bridge.",
      );
      return;
    }

    if (walletAuthUser?.isAdmin) {
      setMarketSection("settings");
      setBridgeAccessMessage("Здесь можно выдать доступ к Captain's Bridge нужным кошелькам.");
      return;
    }

    setWalletAuthMessage(
      "Доступ к Captain's Bridge выдаёт Fleet Admiral. Передай ему адрес своего кошелька.",
    );
  };

  const toggleBridgeWorkspaceView = (view: BridgeWorkspaceView) => {
    setBridgeWorkspaceView((current) => (current === view ? null : view));
  };

  const closeBridgeWorkspaceView = () => {
    setBridgeWorkspaceView(null);
  };

  const formatTickerPriceUsd = (value: number) => {
    if (value >= 1) {
      return value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
    }

    return value.toLocaleString("ru-RU", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
    });
  };

  const buildSparklinePath = (values: number[], width: number, height: number) => {
    if (!values.length) return "";
    if (values.length === 1) return `M 0 ${height / 2} L ${width} ${height / 2}`;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / spread) * height;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const getTrendMinMax = (values: number[]) => {
    if (!values.length) {
      return null;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }

    return { min, max };
  };

  return (
    <main className="page">
      <section className="global-ticker" aria-label="Курс ATLAS и POLIS">
        <div className="global-ticker-inner">
          <div className="global-ticker-title">SA Market Pulse</div>
          {tickerData ? (
            <>
              {tickerData.tokens.map((token) => {
                const isUp = (token.change24hPct ?? 0) >= 0;
                const changeLabel =
                  token.change24hPct == null
                    ? "n/a"
                    : `${isUp ? "+" : ""}${token.change24hPct.toFixed(2)}%`;
                const chartPath = buildSparklinePath(token.trend24h, 240, 64);
                const minMax = getTrendMinMax(token.trend24h);

                return (
                  <div className="ticker-card" key={token.symbol}>
                    <div className="ticker-card-head">
                      <div className="ticker-card-symbol">{token.symbol}</div>
                      {token.placeholder ? <div className="ticker-card-badge">заглушка</div> : null}
                    </div>
                    <div className="ticker-card-price">
                      {token.placeholder ? "скоро" : `$${formatTickerPriceUsd(token.priceUsd)}`}
                    </div>
                    <div
                      className={
                        isUp
                          ? "ticker-card-change ticker-card-change-up"
                          : "ticker-card-change ticker-card-change-down"
                      }
                    >
                      {token.placeholder ? "n/a" : changeLabel}
                    </div>
                    <div className="ticker-card-minmax">
                      <span>
                        min 24h:{" "}
                        {token.placeholder || !minMax
                          ? "n/a"
                          : `$${formatTickerPriceUsd(minMax.min)}`}
                      </span>
                      <span>
                        max 24h:{" "}
                        {token.placeholder || !minMax
                          ? "n/a"
                          : `$${formatTickerPriceUsd(minMax.max)}`}
                      </span>
                    </div>
                    <svg className="ticker-chart" viewBox="0 0 240 64" role="img" aria-label={`${token.symbol} price trend 24h`}>
                      <path
                        d={chartPath}
                        className={
                          isUp
                            ? "ticker-chart-line ticker-chart-line-up"
                            : "ticker-chart-line ticker-chart-line-down"
                        }
                      />
                    </svg>
                  </div>
                );
              })}
              <div className="ticker-meta">
                24ч • обновление каждые {tickerData.refreshIntervalMinutes} минут •
                {" "}
                {new Date(tickerData.updatedAt).toLocaleString("ru-RU", { timeZone: "UTC", hour12: false })} UTC
              </div>
            </>
          ) : (
            <div className="ticker-meta">{tickerLoading ? "Загрузка курса..." : "Курс временно недоступен"}</div>
          )}
        </div>
      </section>

      <header className="hero">
        <p className="tag">Star Atlas Command Center</p>
        <h1>
          {activeTab === "bridge"
            ? "Economic Vanguard"
            : "Аналитика флота и активов"}
        </h1>
        <p className="subtitle">
          Первый MVP: дашборд по аккаунту с расчетом стоимости, дневной
          доходности и окупаемости.
        </p>
      </header>

      <section className="section-tabs" aria-label="Навигация">
        <button
          type="button"
          className={activeTab === "news" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("news")}
        >
          Новости
        </button>
        <button
          type="button"
          className={activeTab === "archive" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("archive")}
        >
          Архив
        </button>
        <button
          type="button"
          className={
            activeTab === "dashboard" ? "section-tab active" : "section-tab"
          }
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        {bridgeAccessActive ? (
          <button
            type="button"
            className={activeTab === "bridge" ? "section-tab active" : "section-tab"}
            onClick={() => setActiveTab("bridge")}
          >
            Капитанский Мостик
          </button>
        ) : null}
        <button
          type="button"
          className={activeTab === "market" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("market")}
        >
          Market
        </button>
        <button
          type="button"
          className={activeTab === "intel" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("intel")}
        >
          Intel
        </button>
        <button
          type="button"
          className={activeTab === "resources" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("resources")}
        >
          Ресурсы
        </button>
        <button
          type="button"
          className={activeTab === "whales" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("whales")}
        >
          🐋 КИТЫ SA
        </button>
        <button
          type="button"
          className="section-tab-status"
          aria-live="polite"
          onClick={openBridgeAccessCenter}
        >
          <span
            className={
              bridgeAccessActive
                ? "section-tab-status-dot section-tab-status-dot-ok"
                : "section-tab-status-dot section-tab-status-dot-off"
            }
            aria-hidden="true"
          />
          {walletAuthToken && connected
            ? bridgeAccessChecked
              ? bridgeAccessActive
                ? "Bridge: access"
                : "Bridge: no access"
              : "Bridge: checking"
            : walletAuthToken && !connected
              ? "Bridge: connect wallet"
            : "Bridge: no session"}
        </button>
      </section>

      {activeTab === "news" ? (
        <section className="panel intel-panel">
          <h2>Новости Star Atlas</h2>
          <p className="subtitle">
            Лента последних новостей из официальных каналов, Medium, X и Discord.
          </p>

          <div className="table-toolbar">
            <button
              type="button"
              disabled={intelLoading}
              onClick={() => {
                void loadIntelOverview();
              }}
            >
              {intelLoading ? "Обновление..." : "Обновить Новости"}
            </button>
          </div>

          {intelError ? <p className="error">{intelError}</p> : null}

          {intelData ? (
            <>
              <h3 className="market-subtitle">Анализ За Последние {intelData.windowHours} Часа</h3>
              <ul className="intel-list">
                {intelData.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3 className="market-subtitle">Итоговые Выводы</h3>
              <ul className="intel-list">
                {intelData.conclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3 className="market-subtitle">Сводка По Источникам (24ч)</h3>
              <div className="intel-source-grid">
                {intelData.sources.map((source) => (
                  <article key={source.key} className="intel-source-card">
                    <p className="intel-source-head">
                      <span>{sourceLabel[source.key]}</span>
                      <strong>{source.ok ? "OK" : "WARN"}</strong>
                    </p>
                    <p className="intel-source-note">
                      Новостей за {intelData.windowHours}ч: {intelData.sourceStats24h[source.key] || 0}
                    </p>
                    <p className="intel-source-note">{source.note}</p>
                  </article>
                ))}
              </div>

              <h3 className="market-subtitle">Новости И Ссылки</h3>
              <div className="intel-items">
                {intelData.items.map((item) => (
                  <article
                    key={`${item.source}:${item.url}:${item.title}`}
                    className="intel-item-card"
                  >
                    <p className="intel-item-meta">
                      <span className="intel-badge">{sourceLabel[item.source]}</span>
                      {item.publishedAt ? <span>{item.publishedAt}</span> : null}
                    </p>
                    <h4>{item.title}</h4>
                    {item.summary ? <p>{item.summary}</p> : null}
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Открыть источник
                    </a>
                  </article>
                ))}
              </div>

              {intelData.items.length === 0 ? (
                <p className="placeholder">Пока нет новостей. Нажмите «Обновить Новости».</p>
              ) : null}

              <p className="timestamp">
                Обновлено: {new Date(intelData.generatedAt).toLocaleString("ru-RU")}
              </p>
            </>
          ) : (
            <p className="placeholder">
              Загружаем новостную ленту Star Atlas...
            </p>
          )}
        </section>
      ) : null}

      {activeTab === "archive" ? (
        <section className="panel intel-panel">
          <h2>Архив Новостей Star Atlas</h2>
          <p className="subtitle">
            Первая историческая статья и еженедельные выпуски с накопительным
            анализом изменений по проекту.
          </p>

          <div className="table-toolbar">
            <button
              type="button"
              disabled={archiveLoading}
              onClick={() => {
                void loadNewsArchive();
              }}
            >
              {archiveLoading ? "Обновление..." : "Обновить Архив"}
            </button>
          </div>

          {archiveError ? <p className="error">{archiveError}</p> : null}

          {archiveData ? (
            <div className="intel-items">
              {archiveData.entries.map((entry) => (
                <article key={entry.id} className="intel-item-card archive-item-card">
                  <p className="intel-item-meta">
                    <span className="intel-badge">
                      {entry.type === "genesis" ? "Первая статья" : "Еженедельный выпуск"}
                    </span>
                    <span>
                      {new Date(entry.periodStart).toLocaleDateString("ru-RU")} - {" "}
                      {new Date(entry.periodEnd).toLocaleDateString("ru-RU")}
                    </span>
                  </p>
                  <h4>{entry.title}</h4>
                  <p>{entry.summary}</p>
                  <p className="archive-source-line">
                    Сигналы: {entry.totalSignals} · Discord {entry.sourceStats.discord} · Medium {entry.sourceStats.medium} · X {entry.sourceStats.x}
                  </p>
                  <div className="archive-content">{entry.content}</div>
                  <p className="timestamp">
                    Сформировано: {new Date(entry.generatedAt).toLocaleString("ru-RU")}
                  </p>
                </article>
              ))}

              {archiveData.entries.length === 0 ? (
                <p className="placeholder">Архив пока пуст. Нажмите «Обновить Архив».</p>
              ) : null}
            </div>
          ) : (
            <p className="placeholder">Загружаем архив статей...</p>
          )}
        </section>
      ) : null}

      {activeTab === "dashboard" ? <section className="panel">
        <form className="controls" onSubmit={loadDashboard}>
          <div className="mode-switch" role="tablist" aria-label="Источник данных">
            <button
              type="button"
              className={mode === "handle" ? "mode-btn active" : "mode-btn"}
              onClick={() => setMode("handle")}
            >
              Handle (demo)
            </button>
            <button
              type="button"
              className={mode === "wallet" ? "mode-btn active" : "mode-btn"}
              onClick={() => setMode("wallet")}
            >
              Solana wallet (real)
            </button>
          </div>

          <label htmlFor="input-main">
            {mode === "wallet" ? "Адрес кошелька Solana" : "Игровой handle"}
          </label>
          <div className="row">
            <input
              id="input-main"
              value={mode === "wallet" ? wallet : handle}
              onChange={(event) =>
                mode === "wallet"
                  ? setWallet(event.target.value)
                  : setHandle(event.target.value)
              }
              placeholder={
                mode === "wallet"
                  ? "например: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
                  : "например: pilot"
              }
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? "Загрузка..." : "Обновить"}
            </button>
          </div>
        </form>

        {error ? <p className="error">{error}</p> : null}

        {data ? (
          <>
            <div className="stats">
              <article>
                <p>Общая стоимость</p>
                <h2>${data.totalValueUsd.toLocaleString()}</h2>
              </article>
              <article>
                <p>Дневной профит</p>
                <h2>${data.dailyProfitUsd.toLocaleString()}</h2>
              </article>
              <article>
                <p>Окупаемость</p>
                <h2>{data.roiDays} дней</h2>
              </article>
            </div>

            <div className="table-wrap">
              <div className="table-toolbar">
                <label htmlFor="asset-filter">Фильтр активов</label>
                <select
                  id="asset-filter"
                  value={assetFilter}
                  onChange={(event) =>
                    setAssetFilter(
                      event.target.value as "all" | "priced" | "star-atlas",
                    )
                  }
                >
                  <option value="all">Все</option>
                  <option value="priced">Только с ценой</option>
                  <option value="star-atlas">Только Star Atlas</option>
                </select>

                <label htmlFor="class-filter">Класс</label>
                <select
                  id="class-filter"
                  value={classFilter}
                  onChange={(event) =>
                    setClassFilter(
                      event.target.value as "all" | FleetAsset["class"],
                    )
                  }
                >
                  <option value="all">Все</option>
                  <option value="Ship">Ship</option>
                  <option value="Crew">Crew</option>
                  <option value="Resource">Resource</option>
                  <option value="NFT">NFT</option>
                </select>

                <label htmlFor="sort-mode">Сортировка</label>
                <select
                  id="sort-mode"
                  value={sortMode}
                  onChange={(event) =>
                    setSortMode(
                      event.target.value as
                        | "value-desc"
                        | "value-asc"
                        | "qty-desc"
                        | "qty-asc"
                        | "name-asc"
                        | "class",
                    )
                  }
                >
                  <option value="value-desc">Стоимость: по убыванию</option>
                  <option value="value-asc">Стоимость: по возрастанию</option>
                  <option value="qty-desc">Количество: по убыванию</option>
                  <option value="qty-asc">Количество: по возрастанию</option>
                  <option value="name-asc">Имя: A-Z</option>
                  <option value="class">По классу</option>
                </select>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Класс</th>
                    <th>Кол-во</th>
                    <th>Стоимость, $</th>
                    <th>Yield/день, $</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>{asset.name}</td>
                      <td>{asset.class}</td>
                      <td>{asset.quantity}</td>
                      <td>{asset.estimatedValueUsd.toLocaleString()}</td>
                      <td>{asset.dailyYieldUsd.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!visibleAssets.length ? (
                <p className="placeholder">По текущему фильтру активы не найдены.</p>
              ) : null}
            </div>

            {topAsset ? (
              <p className="note">
                Крупнейший актив: <strong>{topAsset.name}</strong> ($
                {topAsset.estimatedValueUsd.toLocaleString()})
              </p>
            ) : null}

            <p className="timestamp">
              Обновлено: {new Date(data.generatedAt).toLocaleString("ru-RU")}
            </p>
          </>
        ) : (
          <p className="placeholder">
            Выбери источник данных, введи handle или кошелек и нажми «Обновить».
          </p>
        )}
      </section> : null}

      {activeTab === "bridge" && !bridgeAccessActive ? (
        <section className="panel bridge-panel">
          <h2>Captain&apos;s Bridge</h2>
          <p className="subtitle">
            Доступ к мостику недоступен. Нужны активная wallet-сессия и подключенный кошелек с выданным доступом.
          </p>
        </section>
      ) : null}

      {activeTab === "bridge" && bridgeAccessActive ? (
        <section
          className={
            bridgeWorkspaceView
              ? "panel bridge-panel bridge-workspace-active"
              : "panel bridge-panel"
          }
        >
          <div className="bridge-atmosphere" aria-hidden="true">
            <span className="bridge-orb bridge-orb-a" />
            <span className="bridge-orb bridge-orb-b" />
            <span className="bridge-orb bridge-orb-c" />
            <span className="bridge-grid" />
            <span className="bridge-scan" />
          </div>

          <div className="bridge-brand" aria-label="EV brand">
            <div className="bridge-logo" aria-hidden="true">
              <span>+EV</span>
            </div>
            <div className="bridge-brand-text">
              <p className="bridge-brand-kicker">Операционный центр</p>
              <h2>+EV</h2>
              <p className="bridge-brand-note">
                Economic Vanguard: единый контур управления аналитикой, рынком
                и оперативными решениями гильдии.
              </p>
            </div>
          </div>

          <h2>Гильдия Economic Vanguard</h2>
          <p className="subtitle">
            Командный мостик +EV: быстрый доступ к флоту, рынку и разведданным
            для ежедневного управления операциями.
          </p>

          <div className="table-toolbar">
            <button type="button" onClick={() => setActiveTab("dashboard")}>
              Открыть Dashboard
            </button>
            <button type="button" onClick={() => setActiveTab("market")}>
              Открыть Market
            </button>
            <button type="button" onClick={() => setActiveTab("intel")}>
              Открыть Intel
            </button>
          </div>

          <div className="stats">
            <article>
              <p>Статус API</p>
              <h2>{intelError ? "Нужно проверить" : "Доступен"}</h2>
            </article>
            <article>
              <p>Связанный кошелек</p>
              <h2>{marketWallet ? `${marketWallet.slice(0, 4)}...${marketWallet.slice(-4)}` : "Не задан"}</h2>
            </article>
            <article>
              <p>Последнее обновление Intel</p>
              <h2>{intelData ? new Date(intelData.generatedAt).toLocaleTimeString("ru-RU") : "Нет данных"}</h2>
            </article>
          </div>

          <div className="bridge-runtime-controls">
            <label htmlFor="bridge-role">Роль</label>
            <select
              id="bridge-role"
              value={bridgeRole}
              onChange={(event) => setBridgeRole(event.target.value as BridgeRole)}
            >
              {bridgeRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>

            <label htmlFor="bridge-profile">C4 профиль</label>
            <select
              id="bridge-profile"
              value={bridgeProfile}
              onChange={(event) =>
                setBridgeProfile(event.target.value as BridgeC4Profile)
              }
            >
              {(bridgeConfig?.availableProfiles || []).map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={bridgeLoading || bridgeBusy}
              onClick={() => {
                void loadBridgeRuntime(bridgeRole, bridgeProfile);
              }}
            >
              {bridgeLoading ? "Обновление..." : "Обновить Runtime"}
            </button>
          </div>

          {bridgeConfig ? (
            <p className="bridge-runtime-note">
              Профиль: <strong>{bridgeConfig.profileRules.label}</strong> · Политика
              флота: <strong>{bridgeConfig.profileRules.fleetCapacityPolicy}</strong>
              {" "}· Presets роли: {bridgeConfig.capabilities.visiblePresets.join(", ")}
            </p>
          ) : null}

          {bridgeMessage ? <p className="note">{bridgeMessage}</p> : null}

          {bridgeWorkspaceView ? (
            <div className="bridge-workspace-toolbar">
              <button type="button" onClick={closeBridgeWorkspaceView}>
                Назад к мостику
              </button>
              <p>Режим фокуса: {bridgeWorkspaceView}</p>
            </div>
          ) : null}

          <div className="bridge-live-layout">
            <article
              className="bridge-card"
              data-bridge-view="preflight"
              data-active={bridgeWorkspaceView === "preflight" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Pre-Flight Симуляция</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("preflight")}
                  aria-label="Развернуть Pre-Flight на весь экран"
                >
                  {bridgeWorkspaceView === "preflight" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                C4-ready оценка перед запуском операции: риск, вероятность успеха
                и ожидаемый PnL.
              </p>

              <form className="bridge-preflight-form" onSubmit={runBridgePreflight}>
                <label htmlFor="bridge-op">Операция</label>
                <select
                  id="bridge-op"
                  value={bridgePreflightForm.operationType}
                  onChange={(event) =>
                    setBridgePreflightForm((current) => ({
                      ...current,
                      operationType: event.target.value as BridgeOperationType,
                    }))
                  }
                >
                  {bridgeOperations.map((operation) => (
                    <option key={operation.key} value={operation.key}>
                      {operation.label}
                    </option>
                  ))}
                </select>

                <label htmlFor="bridge-value">Operation Value USD</label>
                <input
                  id="bridge-value"
                  type="number"
                  min="100"
                  step="100"
                  value={bridgePreflightForm.operationValueUsd}
                  onChange={(event) =>
                    setBridgePreflightForm((current) => ({
                      ...current,
                      operationValueUsd: event.target.value,
                    }))
                  }
                />

                <label htmlFor="bridge-complexity">Route Complexity (1-5)</label>
                <input
                  id="bridge-complexity"
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={bridgePreflightForm.routeComplexity}
                  onChange={(event) =>
                    setBridgePreflightForm((current) => ({
                      ...current,
                      routeComplexity: event.target.value,
                    }))
                  }
                />

                <label htmlFor="bridge-risk">Risk Tolerance</label>
                <select
                  id="bridge-risk"
                  value={bridgePreflightForm.riskTolerance}
                  onChange={(event) =>
                    setBridgePreflightForm((current) => ({
                      ...current,
                      riskTolerance: event.target.value as BridgeRiskTolerance,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>

                <button type="submit" disabled={bridgeBusy}>
                  {bridgeBusy ? "Расчет..." : "Запустить Pre-Flight"}
                </button>
              </form>

              {bridgePreflight ? (
                <div className="bridge-preflight-result">
                  <p>
                    Risk Score: <strong>{bridgePreflight.riskScore}</strong> · Success:
                    <strong> {bridgePreflight.successProbability}%</strong>
                  </p>
                  <p>
                    ETA: <strong>{bridgePreflight.etaMinutes} мин</strong> · Expected PnL:
                    <strong> ${bridgePreflight.expectedPnlUsd.toLocaleString()}</strong>
                  </p>
                  <p>
                    Best/Worst: <strong>${bridgePreflight.bestCaseUsd.toLocaleString()}</strong>
                    {" / "}
                    <strong>${bridgePreflight.worstCaseUsd.toLocaleString()}</strong>
                  </p>
                </div>
              ) : null}
            </article>

            <article
              className="bridge-card"
              data-bridge-view="alerts"
              data-active={bridgeWorkspaceView === "alerts" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Live Alerts</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("alerts")}
                  aria-label="Развернуть Live Alerts на весь экран"
                >
                  {bridgeWorkspaceView === "alerts" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Ролевой поток событий с подтверждением (ack) для оперативного
                цикла.
              </p>

              <div className="bridge-alerts-list">
                {bridgeAlertsData.map((alert) => (
                  <div key={alert.id} className={`bridge-alert bridge-alert-${alert.level}`}>
                    <p className="bridge-alert-meta">
                      <span>{alert.level.toUpperCase()}</span>
                      <span>{alert.domain}</span>
                    </p>
                    <h4>{alert.title}</h4>
                    <p>{alert.details}</p>
                    <p className="bridge-alert-time">
                      {new Date(alert.createdAt).toLocaleString("ru-RU")}
                    </p>
                    <button
                      type="button"
                      disabled={alert.acknowledged || bridgeBusy}
                      onClick={() => {
                        void ackBridgeAlert(alert.id);
                      }}
                    >
                      {alert.acknowledged ? "Подтверждено" : "Подтвердить"}
                    </button>
                  </div>
                ))}

                {!bridgeAlertsData.length ? (
                  <p className="placeholder">Для роли нет активных alerts.</p>
                ) : null}
              </div>
            </article>

            <article
              className="bridge-card"
              data-bridge-view="audit"
              data-active={bridgeWorkspaceView === "audit" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Audit Trail</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("audit")}
                  aria-label="Развернуть Audit Trail на весь экран"
                >
                  {bridgeWorkspaceView === "audit" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                История pre-flight и подтверждений alert по текущей роли Captain
                Bridge.
              </p>

              <div className="bridge-audit-toolbar">
                <label>
                  Тип события
                  <select
                    value={bridgeAuditTypeFilter}
                    onChange={(event) =>
                      setBridgeAuditTypeFilter(event.target.value as BridgeAuditFilterType)
                    }
                  >
                    <option value="all">Все</option>
                    <option value="preflight-run">Preflight</option>
                    <option value="alert-ack">Alert Ack</option>
                  </select>
                </label>

                <label>
                  Период
                  <select
                    value={bridgeAuditPeriodFilter}
                    onChange={(event) =>
                      setBridgeAuditPeriodFilter(event.target.value as BridgeAuditPeriod)
                    }
                  >
                    <option value="24h">24 часа</option>
                    <option value="7d">7 дней</option>
                    <option value="30d">30 дней</option>
                    <option value="all">Все время</option>
                  </select>
                </label>

                <div className="bridge-audit-actions">
                  <button type="button" onClick={() => exportBridgeAudit("json")}>
                    Export JSON
                  </button>
                  <button type="button" onClick={() => exportBridgeAudit("csv")}>
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="bridge-audit-list">
                {bridgeFilteredAuditData.map((event) => (
                  <div key={event.id} className="bridge-audit-item">
                    <p className="bridge-alert-meta">
                      <span>{event.eventType === "preflight-run" ? "PREFLIGHT" : "ACK"}</span>
                      <span>{event.profile || "n/a"}</span>
                    </p>
                    <p className="bridge-audit-title">
                      {event.eventType === "preflight-run"
                        ? `Операция ${String(event.details.operationType || "unknown")}`
                        : `Alert ${String(event.details.alertId || "unknown")}`}
                    </p>
                    <p className="bridge-alert-time">
                      {new Date(event.createdAt).toLocaleString("ru-RU")}
                    </p>
                  </div>
                ))}

                {!bridgeFilteredAuditData.length ? (
                  <p className="placeholder">Нет событий для выбранных фильтров.</p>
                ) : null}
              </div>
            </article>
          </div>

          <div className="bridge-grid-layout">
            <article
              className="bridge-card"
              data-bridge-view="map"
              data-active={bridgeWorkspaceView === "map" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>2D Карта: Presets + Layers</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("map")}
                  aria-label="Развернуть карту на весь экран"
                >
                  {bridgeWorkspaceView === "map" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Тактический слой мостика: role-presets и ручное управление
                слоями поверх live-карты с конфигурацией под конкретную задачу.
              </p>

              <div className="bridge-map-presets" role="group" aria-label="Map presets">
                {bridgeMapPresets
                  .filter((preset) => bridgeVisiblePresetNames.includes(preset.name))
                  .map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className={
                        preset.name === bridgeMapPreset
                          ? "bridge-map-preset active"
                          : "bridge-map-preset"
                      }
                      onClick={() => applyBridgePreset(preset.name)}
                    >
                      {preset.name}
                    </button>
                  ))}
              </div>

              <p className="bridge-runtime-note">{bridgePresetSummary}</p>

              <p className="bridge-runtime-note">
                Live sync: {bridgeLiveMapLoading ? "обновление..." : "online"}
                {bridgeLiveMap?.generatedAt
                  ? ` · ${new Date(bridgeLiveMap.generatedAt).toLocaleTimeString("ru-RU")}`
                  : ""}
                {bridgeLiveMap?.source ? ` · source ${bridgeLiveMap.source}` : ""}
                {bridgeLiveMap?.activityScore
                  ? ` · activity ${bridgeLiveMap.activityScore}/100`
                  : ""}
                {bridgeLiveMapError ? ` · error: ${bridgeLiveMapError}` : ""}
              </p>

              {bridgeConnectedWalletMetrics ? (
                <p className="bridge-runtime-note">
                  SAGE кошельков подключено: {bridgeConnectedWalletMetrics.totalConnectedWallets}
                  {` · MUD ${bridgeConnectedWalletMetrics.byFaction.MUD}`}
                  {` · ONI ${bridgeConnectedWalletMetrics.byFaction.ONI}`}
                  {` · USTUR ${bridgeConnectedWalletMetrics.byFaction.USTUR}`}
                </p>
              ) : null}

              <p className="bridge-runtime-note">
                Активных игроков SAGE за сегодня: {bridgeSageActiveProfilesMetric?.activeProfiles ?? "n/a"}
                {bridgeSageActiveProfilesMetric?.source === "upstream"
                  ? " · realtime"
                  : bridgeSageActiveProfilesMetric?.source === "estimated"
                    ? " · estimate"
                    : " · source unavailable"}
              </p>

              <div className="bridge-layer-switches" role="group" aria-label="Map layers">
                {bridgeLayerOrder.map((layer) => (
                  <label key={layer} className="bridge-layer-toggle">
                    <input
                      type="checkbox"
                      checked={bridgeMapLayers[layer]}
                      onChange={() => toggleBridgeLayer(layer)}
                    />
                    <span>{bridgeLayerLabels[layer]}</span>
                  </label>
                ))}
              </div>

              <div
                className="bridge-map-shell"
                onClick={() => toggleBridgeWorkspaceView("map")}
                role="button"
                tabIndex={0}
                aria-label="Открыть карту в полноэкранном режиме"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleBridgeWorkspaceView("map");
                  }
                }}
              >
                <svg
                  className="bridge-map-canvas"
                  viewBox="0 0 1000 500"
                  role="img"
                  aria-label="Captain Bridge tactical map"
                >
                  <defs>
                    <linearGradient id="routeGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#6ee7f7" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="#8ca8ff" stopOpacity="0.85" />
                    </linearGradient>
                  </defs>

                  <image
                    href={bridgeMapImageUrl}
                    x="0"
                    y="0"
                    width="1000"
                    height="500"
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <rect x="0" y="0" width="1000" height="500" fill="rgba(0, 0, 0, 0.3)" />

                  {bridgeMapLayers.riskZones
                    ? bridgeRiskZones.map((zone) => (
                        <circle
                          key={zone.id}
                          cx={zone.x}
                          cy={zone.y}
                          r={zone.r}
                          className="bridge-map-risk"
                        />
                      ))
                    : null}

                  {bridgeMapLayers.routes
                    ? bridgeMapRoutes.map((route) => (
                        <polyline
                          key={route.id}
                          points={route.points}
                          fill="none"
                          stroke="url(#routeGradient)"
                          strokeWidth="3"
                          strokeDasharray="7 6"
                          className="bridge-map-route"
                        />
                      ))
                    : null}

                  {bridgeMapLayers.resources
                    ? bridgeMapResources.map((resource) => (
                        <g key={resource.id} transform={`translate(${resource.x},${resource.y})`}>
                          <rect
                            x="-8"
                            y="-8"
                            width="16"
                            height="16"
                            rx="3"
                            className="bridge-map-resource"
                          />
                          <text x="12" y="4" className="bridge-map-label">
                            {resource.label}
                          </text>
                        </g>
                      ))
                    : null}

                  {bridgeMapLayers.enemies
                    ? bridgeMapEnemies.map((enemy) => (
                        <g key={enemy.id} transform={`translate(${enemy.x},${enemy.y})`}>
                          <polygon points="0,-10 10,10 -10,10" className="bridge-map-enemy" />
                          <text x="12" y="4" className="bridge-map-label">
                            {enemy.label}
                          </text>
                        </g>
                      ))
                    : null}

                  {bridgeMapLayers.fleets
                    ? bridgeMapFleets.map((fleet) => (
                        <g key={fleet.id} transform={`translate(${fleet.x},${fleet.y})`}>
                          <circle r="7" className="bridge-map-fleet" />
                          <text x="11" y="4" className="bridge-map-label">
                            {fleet.label}
                          </text>
                        </g>
                      ))
                    : null}
                </svg>

                <p className="bridge-map-meta">
                  Активные слои: {bridgeLayerOrder.filter((layer) => bridgeMapLayers[layer]).length}/
                  {bridgeLayerOrder.length}
                </p>
              </div>
            </article>

            <article
              className="bridge-card"
              data-bridge-view="ops"
              data-active={bridgeWorkspaceView === "ops" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Операции MVP 2</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("ops")}
                  aria-label="Развернуть операции на весь экран"
                >
                  {bridgeWorkspaceView === "ops" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Контур запуска с pre-flight проверкой: ETA, риск,
                профит/убыток, вероятность успеха.
              </p>
              <ul className="bridge-list">
                {bridgeOps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article
              className="bridge-card"
              data-bridge-view="notify"
              data-active={bridgeWorkspaceView === "notify" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Уведомления И Эскалации</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("notify")}
                  aria-label="Развернуть уведомления на весь экран"
                >
                  {bridgeWorkspaceView === "notify" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Приоритетная модель Critical/High/Normal/Info с ролевой
                доставкой и подтверждением для критичных кейсов.
              </p>
              <ul className="bridge-list">
                {bridgeAlertPolicy.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article
              className="bridge-card"
              data-bridge-view="security"
              data-active={bridgeWorkspaceView === "security" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>Доступ И Безопасность</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("security")}
                  aria-label="Развернуть безопасность на весь экран"
                >
                  {bridgeWorkspaceView === "security" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Приватный контур одной ДАК с аудитом, allowlist и
                управлением сессиями.
              </p>
              <ul className="bridge-list">
                {bridgeSecurity.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article
              className="bridge-card bridge-card-wide"
              data-bridge-view="readiness"
              data-active={bridgeWorkspaceView === "readiness" ? "true" : "false"}
            >
              <div className="bridge-card-head">
                <h3>MVP 2 Readiness</h3>
                <button
                  type="button"
                  className="bridge-card-expand"
                  onClick={() => toggleBridgeWorkspaceView("readiness")}
                  aria-label="Развернуть readiness на весь экран"
                >
                  {bridgeWorkspaceView === "readiness" ? "×" : "⤢"}
                </button>
              </div>
              <p className="bridge-card-lead">
                Операционный baseline из QA: что должно быть в первом рабочем
                релизе мостика.
              </p>
              <ul className="bridge-list bridge-list-compact">
                {bridgeMvp2Checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === "market" ? (
        <section className="panel market-panel">
          <h2>Рынок, Торговля И Обмен</h2>
          <p className="subtitle">
            Просматривай предложения на рынке, выставляй активы на продажу и
            создавай офферы обмена с доплатой или без.
          </p>

          <div className="market-wallet-row">
            <label>Кошелек для торговли</label>
            <div className="wallet-connect-row">
              <WalletMultiButton className="wallet-btn" />
              <span className="wallet-status">
                {connected
                  ? `Connected: ${marketWallet.slice(0, 4)}...${marketWallet.slice(-4)}`
                  : "Не подключен"}
              </span>
            </div>
            {!connected ? (
              <input
                id="market-wallet"
                value={manualMarketWallet}
                onChange={(event) => setManualMarketWallet(event.target.value)}
                placeholder="Введи кошелек вручную (fallback)"
              />
            ) : null}

            <div className="wallet-auth-card">
              <p className="wallet-auth-title">Регистрация и верификация по кошельку</p>
              <p className="wallet-auth-subtitle">
                Подпиши challenge в кошельке, чтобы создать/подтвердить аккаунт и открыть сессию.
              </p>
              <div className="wallet-auth-dev-login">
                <label htmlFor="dev-admin-password">Dev Admin Login (пароль, без кошелька)</label>
                <div className="wallet-auth-dev-login-row">
                  <input
                    id="dev-admin-password"
                    type="password"
                    value={devAdminPassword}
                    onChange={(event) => setDevAdminPassword(event.target.value)}
                    placeholder="Пароль администратора (dev-only)"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="wallet-auth-secondary"
                    onClick={() => {
                      void loginDevAdminByPassword();
                    }}
                    disabled={walletAuthBusy}
                  >
                    {walletAuthBusy ? "Вход..." : "Войти как Admin"}
                  </button>
                </div>
              </div>
              <div className="wallet-auth-actions">
                <button
                  type="button"
                  onClick={() => {
                    void registerAndVerifyWallet();
                  }}
                  disabled={!connected || walletAuthBusy}
                >
                  {walletAuthBusy ? "Подпись..." : "Зарегистрировать и верифицировать"}
                </button>
                <button
                  type="button"
                  className="wallet-auth-secondary"
                  onClick={() => {
                    void logoutWalletSession();
                  }}
                  disabled={walletAuthBusy || !walletAuthToken}
                >
                  Выйти из сессии
                </button>
              </div>

              {walletAuthUser ? (
                <p className="wallet-auth-state">
                  Верифицирован: {walletAuthUser.wallet.slice(0, 4)}...{walletAuthUser.wallet.slice(-4)} ·
                  входов: {walletAuthUser.loginCount} · роль: {walletAuthUser.isAdmin ? "Admin" : "Member"}
                </p>
              ) : (
                <p className="wallet-auth-state">Сессия не активна.</p>
              )}

              {walletAuthUser ? (
                <p
                  className={
                    bridgeAccessActive
                      ? "wallet-auth-state wallet-auth-state-access-ok"
                      : "wallet-auth-state wallet-auth-state-access-denied"
                  }
                >
                  Captain&apos;s Bridge: {bridgeAccessChecked
                    ? bridgeAccessActive
                      ? "доступ есть"
                      : "доступ не выдан"
                    : "проверка доступа..."}
                </p>
              ) : null}

              {walletAuthMessage ? <p className="wallet-auth-message">{walletAuthMessage}</p> : null}
            </div>
          </div>

          <div className="section-tabs market-subtabs">
            <button
              type="button"
              className={
                marketSection === "trade" ? "section-tab active" : "section-tab"
              }
              onClick={() => setMarketSection("trade")}
            >
              Торговля
            </button>
            <button
              type="button"
              className={
                marketSection === "barter" ? "section-tab active" : "section-tab"
              }
              onClick={() => setMarketSection("barter")}
            >
              Обмен
            </button>
            <button
              type="button"
              className={
                marketSection === "settings"
                  ? "section-tab active"
                  : "section-tab"
              }
              onClick={() => setMarketSection("settings")}
            >
              Настройки
            </button>
          </div>

          {marketSection === "trade" ? (
            <>
              <div className="table-toolbar">
                <label htmlFor="listing-search">Поиск</label>
                <input
                  id="listing-search"
                  value={listingsSearch}
                  onChange={(event) => setListingsSearch(event.target.value)}
                  placeholder="Корабль, ресурс, NFT..."
                />

                <label htmlFor="listing-class">Класс</label>
                <select
                  id="listing-class"
                  value={listingsClass}
                  onChange={(event) =>
                    setListingsClass(
                      event.target.value as "all" | FleetAsset["class"],
                    )
                  }
                >
                  <option value="all">Все</option>
                  <option value="Ship">Ship</option>
                  <option value="Crew">Crew</option>
                  <option value="Resource">Resource</option>
                  <option value="NFT">NFT</option>
                </select>

                <label htmlFor="listing-status">Статус</label>
                <select
                  id="listing-status"
                  value={listingsStatus}
                  onChange={(event) =>
                    setListingsStatus(event.target.value as "active" | "all")
                  }
                >
                  <option value="active">Только активные</option>
                  <option value="all">Все</option>
                </select>

                <button
                  type="button"
                  disabled={listingsBusy}
                  onClick={() => {
                    void loadListings();
                  }}
                >
                  Обновить Лоты
                </button>
                <button
                  type="button"
                  disabled={sellPickerLoading || !walletAuthToken}
                  onClick={() => {
                    if (walletAuthToken) {
                      void loadSellPickerNfts(walletAuthToken);
                    }
                  }}
                >
                  {sellPickerLoading ? "Загрузка NFT..." : "Обновить NFT Кошелька"}
                </button>
              </div>

              {listingsMessage ? <p className="note">{listingsMessage}</p> : null}

              <div className="market-listings-grid">
                {listings.map((listing) => (
                  <article key={listing.id} className="market-listing-card">
                    {listing.image ? (
                      <img className="market-listing-img" src={listing.image} alt={listing.itemName} loading="lazy" />
                    ) : (
                      <div className="market-listing-img market-listing-img-placeholder" />
                    )}
                    <div className="market-listing-body">
                      <h4>{listing.itemName}</h4>
                      <p className="market-listing-meta">{listing.itemClass} · {listing.status}</p>
                      <p className="market-listing-escrow">
                        Escrow: {listing.escrowTxSignature ? "On-chain" : "Not confirmed"}
                      </p>
                      <p className="market-listing-settlement">
                        Settlement: {listing.settlementTxSignature ? "Completed" : listing.status === "sold" ? "Pending" : "Not started"}
                      </p>
                      <p className="market-listing-price">{listing.priceUsd.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</p>
                      <p className="market-listing-wallet">Продавец: {listing.sellerWallet.slice(0, 4)}...{listing.sellerWallet.slice(-4)}</p>
                      {listing.escrowTxSignature ? (
                        <a href={`https://solscan.io/tx/${listing.escrowTxSignature}`} target="_blank" rel="noreferrer">Escrow Tx в Solscan</a>
                      ) : null}
                      {listing.settlementTxSignature ? (
                        <a href={`https://solscan.io/tx/${listing.settlementTxSignature}`} target="_blank" rel="noreferrer">Settlement Tx в Solscan</a>
                      ) : null}
                      {listing.settlementError ? (
                        <p className="market-listing-settlement-error">{listing.settlementError}</p>
                      ) : null}
                      {listing.status === "sold" && listing.txSignature ? (
                        <a href={`https://solscan.io/tx/${listing.txSignature}`} target="_blank" rel="noreferrer">Tx в Solscan</a>
                      ) : null}
                      <button
                        type="button"
                        disabled={listing.status !== "active" || listingsBusy}
                        onClick={() => {
                          void buyListingWithUsdc(listing);
                        }}
                      >
                        Купить за USDC
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <h3 className="market-subtitle">Выставить На Продажу</h3>
              <form className="market-settings-form" onSubmit={createListing}>
                <label htmlFor="sell-picker-search">Поиск NFT в кошельке</label>
                <input
                  id="sell-picker-search"
                  value={sellPickerSearch}
                  onChange={(event) => setSellPickerSearch(event.target.value)}
                  placeholder="Название или mint"
                />

                {sellPickerError ? <p className="error">{sellPickerError}</p> : null}

                <div className="market-wallet-nft-grid">
                  {filteredSellPickerNfts.map((nft) => {
                    const selected = sellPickerSelected?.mint === nft.mint;
                    return (
                      <button
                        type="button"
                        key={nft.mint}
                        className={selected ? "market-wallet-nft active" : "market-wallet-nft"}
                        onClick={() => {
                          setSellPickerSelected(nft);
                        }}
                      >
                        {nft.image ? (
                          <img className="market-wallet-nft-img" src={nft.image} alt={nft.name ?? nft.mint} loading="lazy" />
                        ) : (
                          <div className="market-wallet-nft-img market-wallet-nft-img-placeholder" />
                        )}
                        <span className="market-wallet-nft-name">{nft.name ?? "Unknown"}</span>
                        <span className="market-wallet-nft-mint">{nft.mint.slice(0, 4)}...{nft.mint.slice(-4)}</span>
                      </button>
                    );
                  })}
                </div>

                {sellPickerSelected ? (
                  <p className="note">Выбран NFT: <strong>{sellPickerSelected.name ?? sellPickerSelected.mint}</strong></p>
                ) : (
                  <p className="note">Выбери NFT из кошелька перед созданием ордера.</p>
                )}

                <div className="market-grid-3">
                  <div>
                    <label htmlFor="new-listing-price">Цена USD</label>
                    <input
                      id="new-listing-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={newListing.priceUsd}
                      onChange={(event) =>
                        setNewListing((current) => ({
                          ...current,
                          priceUsd: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                </div>

                <p className="note">
                  Оплата только в USDC. Комиссия платформы: {(marketConfig?.platformFeeBps ?? 100) / 100}%. Auto-settlement: {marketConfig?.autoSettlementEnabled ? "включен" : "выключен"}.
                </p>

                <label htmlFor="new-listing-note">Комментарий</label>
                <input
                  id="new-listing-note"
                  value={newListing.note}
                  onChange={(event) =>
                    setNewListing((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Опционально"
                />

                <button type="submit" disabled={!sellPickerSelected || listingsBusy}>Выставить NFT за USDC</button>
              </form>
            </>
          ) : null}

          {marketSection === "barter" ? (
            <>
              <div className="table-toolbar">
                <label htmlFor="barter-status">Статус</label>
                <select
                  id="barter-status"
                  value={bartersStatus}
                  onChange={(event) =>
                    setBartersStatus(event.target.value as "open" | "all")
                  }
                >
                  <option value="open">Только открытые</option>
                  <option value="all">Все</option>
                </select>

                <button
                  type="button"
                  disabled={bartersBusy}
                  onClick={() => {
                    void loadBarters();
                  }}
                >
                  Обновить Обмены
                </button>
              </div>

              {bartersMessage ? <p className="note">{bartersMessage}</p> : null}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Отдает</th>
                      <th>Хочет</th>
                      <th>Доплата</th>
                      <th>Автор</th>
                      <th>Статус</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barters.map((offer) => (
                      <tr key={offer.id}>
                        <td>{offer.offerItem}</td>
                        <td>{offer.wantItem}</td>
                        <td>${offer.extraUsd.toLocaleString()}</td>
                        <td>{offer.fromWallet}</td>
                        <td>{offer.status}</td>
                        <td className="barter-actions-cell">
                          <button
                            type="button"
                            disabled={offer.status !== "open"}
                            onClick={() => {
                              void respondBarter(offer.id, "accept");
                            }}
                          >
                            Принять
                          </button>
                          <button
                            type="button"
                            disabled={offer.status !== "open"}
                            onClick={() => {
                              void respondBarter(offer.id, "decline");
                            }}
                          >
                            Отклонить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="market-subtitle">Создать Оффер Обмена</h3>
              <form className="market-settings-form" onSubmit={createBarter}>
                <label htmlFor="barter-offer-item">Что отдаю</label>
                <input
                  id="barter-offer-item"
                  value={newBarter.offerItem}
                  onChange={(event) =>
                    setNewBarter((current) => ({
                      ...current,
                      offerItem: event.target.value,
                    }))
                  }
                  required
                />

                <label htmlFor="barter-want-item">Что хочу получить</label>
                <input
                  id="barter-want-item"
                  value={newBarter.wantItem}
                  onChange={(event) =>
                    setNewBarter((current) => ({
                      ...current,
                      wantItem: event.target.value,
                    }))
                  }
                  required
                />

                <label htmlFor="barter-extra-usd">Доплата (USD)</label>
                <input
                  id="barter-extra-usd"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newBarter.extraUsd}
                  onChange={(event) =>
                    setNewBarter((current) => ({
                      ...current,
                      extraUsd: event.target.value,
                    }))
                  }
                />

                <label htmlFor="barter-note">Комментарий</label>
                <input
                  id="barter-note"
                  value={newBarter.note}
                  onChange={(event) =>
                    setNewBarter((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  placeholder="Опционально"
                />

                <button type="submit">Создать Оффер</button>
              </form>
            </>
          ) : null}

          {marketSection === "settings" ? (
            <>
              <form className="market-settings-form" onSubmit={saveMarketSettings}>
                <label htmlFor="collections-input">
                  Star Atlas Collections (по одному значению в строке)
                </label>
                <textarea
                  id="collections-input"
                  rows={8}
                  value={collectionsInput}
                  onChange={(event) => setCollectionsInput(event.target.value)}
                  placeholder="staratlas\nstar atlas ships\nsage labs"
                />

                <label htmlFor="keywords-input">
                  Keywords (по одному значению в строке)
                </label>
                <textarea
                  id="keywords-input"
                  rows={6}
                  value={keywordsInput}
                  onChange={(event) => setKeywordsInput(event.target.value)}
                  placeholder="star atlas\nsage\nfimbul"
                />

                <div className="market-actions">
                  <button type="submit" disabled={settingsBusy}>
                    {settingsBusy ? "Сохранение..." : "Сохранить Настройки"}
                  </button>
                  <button
                    type="button"
                    disabled={settingsBusy}
                    onClick={() => {
                      void loadMarketSettings();
                    }}
                  >
                    Обновить Из API
                  </button>
                </div>
              </form>

              {walletAuthUser?.isAdmin ? (
                <div className="market-settings-form">
                  <h3 className="market-subtitle">Captain&apos;s Bridge: Доступы</h3>
                  <label htmlFor="bridge-access-wallet">Кошелек для выдачи доступа</label>
                  <input
                    id="bridge-access-wallet"
                    value={bridgeAccessWalletInput}
                    onChange={(event) => setBridgeAccessWalletInput(event.target.value)}
                    placeholder="Solana wallet address"
                  />

                  <div className="market-actions">
                    <button
                      type="button"
                      disabled={bridgeAccessBusy}
                      onClick={() => {
                        void grantBridgeAccess();
                      }}
                    >
                      {bridgeAccessBusy ? "Обработка..." : "Выдать Доступ"}
                    </button>
                    <button
                      type="button"
                      disabled={bridgeAccessBusy || !walletAuthToken}
                      onClick={() => {
                        if (walletAuthToken) {
                          void loadBridgeAccessList(walletAuthToken);
                        }
                      }}
                    >
                      Обновить Список
                    </button>
                  </div>

                  {bridgeAccessMessage ? <p className="note">{bridgeAccessMessage}</p> : null}

                  <div className="bridge-audit-list">
                    {bridgeAccessList.map((entry) => (
                      <div key={entry.wallet} className="bridge-audit-item">
                        <p className="bridge-audit-title">
                          {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-6)}
                        </p>
                        <p className="bridge-alert-time">
                          Выдан: {new Date(entry.grantedAt).toLocaleString("ru-RU")}
                        </p>
                        <p className="bridge-alert-time">
                          Кем: {entry.grantedBy.slice(0, 6)}...{entry.grantedBy.slice(-6)}
                        </p>
                        <button
                          type="button"
                          disabled={bridgeAccessBusy || entry.wallet === walletAuthUser.wallet}
                          onClick={() => {
                            void revokeBridgeAccess(entry.wallet);
                          }}
                        >
                          Отозвать
                        </button>
                      </div>
                    ))}

                    {!bridgeAccessList.length ? (
                      <p className="placeholder">Список доступов пуст.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {settingsMessage ? <p className="note">{settingsMessage}</p> : null}
              {marketSettings ? (
                <p className="timestamp">
                  Последнее обновление: {new Date(marketSettings.updatedAt).toLocaleString("ru-RU")}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === "intel" ? (
        <section className="panel intel-panel">
          <h2>Star Atlas Intelligence Overview</h2>
          <p className="subtitle">
            Единый обзор официальных новостей, соцсетей и Discord с итоговыми
            выводами для оперативной оценки состояния проекта.
          </p>

          <div className="table-toolbar">
            <button
              type="button"
              disabled={intelLoading}
              onClick={() => {
                void loadIntelOverview();
              }}
            >
              {intelLoading ? "Обновление..." : "Обновить Обзор"}
            </button>
          </div>

          {intelError ? <p className="error">{intelError}</p> : null}

          {intelData ? (
            <>
              <div className="intel-source-grid">
                {intelData.sources.map((source) => (
                  <article key={source.key} className="intel-source-card">
                    <p className="intel-source-head">
                      <span>{sourceLabel[source.key]}</span>
                      <strong>{source.ok ? "OK" : "WARN"}</strong>
                    </p>
                    <p className="intel-source-note">{source.note}</p>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.url}
                    </a>
                  </article>
                ))}
              </div>

              <h3 className="market-subtitle">Highlights</h3>
              <ul className="intel-list">
                {intelData.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3 className="market-subtitle">Итоговые Выводы</h3>
              <ul className="intel-list">
                {intelData.conclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3 className="market-subtitle">Последние Сигналы</h3>
              <div className="intel-items">
                {intelData.items.map((item) => (
                  <article key={`${item.source}:${item.url}:${item.title}`} className="intel-item-card">
                    <p className="intel-item-meta">
                      <span className="intel-badge">{sourceLabel[item.source]}</span>
                      {item.publishedAt ? <span>{item.publishedAt}</span> : null}
                    </p>
                    <h4>{item.title}</h4>
                    {item.summary ? <p>{item.summary}</p> : null}
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Открыть источник
                    </a>
                  </article>
                ))}
              </div>

              <p className="timestamp">
                Обновлено: {new Date(intelData.generatedAt).toLocaleString("ru-RU")}
              </p>
            </>
          ) : (
            <p className="placeholder">
              Нажмите «Обновить Обзор», чтобы собрать свежие сигналы по проекту.
            </p>
          )}
        </section>
      ) : null}

      {activeTab === "resources" ? (
        <section className="panel resources-panel">
          <h2>Добыча Ресурсов SAGE</h2>
          <p className="subtitle">
            Реальное время активности добычи по ресурсам и фракциям. Счетчики сбрасываются в 00:00 UTC.
          </p>

          <div className="table-toolbar">
            <button
              type="button"
              disabled={miningLoading}
              onClick={() => {
                void loadMiningMetrics();
                void loadCraftCatalog();
              }}
            >
              {miningLoading ? "Обновление..." : "Обновить Данные"}
            </button>
            <button
              type="button"
              disabled={!miningMetrics?.resources?.length}
              onClick={exportResourcesCsv}
            >
              Экспорт CSV
            </button>
            <button
              type="button"
              onClick={() => void loadR4Metrics()}
              disabled={r4Loading}
            >
              {r4Loading ? "R4..." : "Обновить R4"}
            </button>
          </div>

          {miningError ? <p className="error">{miningError}</p> : null}

          {miningMetrics ? (
            <>
              <p className="timestamp">
                Источник: 
                <strong className={`source-badge source-badge-${miningMetrics.source || "unknown"}`}>
                  {miningMetrics.source === "sage-onchain" ? "✓ On-chain" : miningMetrics.source === "rydn-fallback" ? "⚠ Fallback" : miningMetrics.source || "unknown"}
                </strong>
              </p>
              {miningMetrics.source === "rydn-fallback" ? (
                <p className="source-warning">
                  Данные оценочные (fallback). Для точных метрик по фракциям нужен источник
                  <strong> sage-onchain</strong>.
                </p>
              ) : null}

              {miningMetrics.reserveSummary ? (
                <div className="resource-supply-summary">
                  <p>
                    On-chain total mined: <strong>{formatIntegerString(miningMetrics.reserveSummary.totalEstimatedReserves)}</strong>
                  </p>
                  <p>
                    На кошельках игроков: <strong>{renderMetricWithTooltip(
                      formatCompactTokenAmount(miningMetrics.reserveSummary.totalPlayerWalletBalance),
                      formatTokenAmount(miningMetrics.reserveSummary.totalPlayerWalletBalance),
                    )}</strong>
                    {" | "}
                    На кошельках разработчиков: <strong>{renderMetricWithTooltip(
                      formatCompactTokenAmount(miningMetrics.reserveSummary.totalDeveloperWalletBalance),
                      formatTokenAmount(miningMetrics.reserveSummary.totalDeveloperWalletBalance),
                    )}</strong>
                  </p>
                  <p>
                    Покрытие mint-картой: <strong>{miningMetrics.reserveSummary.walletCoverageResources}</strong> из <strong>{miningMetrics.resources.length}</strong>
                    {" | "}
                    Игроков в скане: <strong>{miningMetrics.reserveSummary.playerWalletsScanned}</strong>
                    {" | "}
                    Dev-кошельков: <strong>{miningMetrics.reserveSummary.developerWalletsScanned}</strong>
                  </p>
                  <div className="resource-supply-badges">
                    <span className="reserve-signal-badge deficit-risk">
                      Дефицит: {miningMetrics.reserveSummary.deficitRiskCount}
                    </span>
                    <span className="reserve-signal-badge balanced">
                      Баланс: {miningMetrics.reserveSummary.balancedCount}
                    </span>
                    <span className="reserve-signal-badge surplus-risk">
                      Избыток: {miningMetrics.reserveSummary.surplusRiskCount}
                    </span>
                  </div>
                </div>
              ) : null}

              {miningMetrics.source === "sage-onchain" ? (
                <div className="planetary-pool-summary">
                  <p>
                    Планетные пулы добычи (on-chain):
                    {" "}
                    Total mined <strong>{formatIntegerString(planetaryPoolTotals.totalMined)}</strong>
                    {" | "}
                    За сутки <strong>{formatIntegerString(planetaryPoolTotals.totalDailyMined)}</strong>
                  </p>
                  <p>
                    Ресурсов с данными добычи: <strong>{planetaryPoolTotals.resourcesWithMiningData}</strong>
                  </p>
                </div>
              ) : null}

              {miningMetrics.resources && miningMetrics.resources.length > 0 ? (
                <div className="resources-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Ресурс</th>
                        <th>Всего Флотов</th>
                        <th>Total Mined</th>
                        <th>У Игроков</th>
                        <th>За сутки</th>
                        <th>Сигнал</th>
                        <th>Hardness</th>
                        <th>Avg Richness</th>
                        <th>MUD</th>
                        <th>ONI</th>
                        <th>USTUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {miningMetrics.resources.map((resource, idx: number) => {
                        const totalMinedFull = formatIntegerString(resource.totalMined);
                        const totalMinedCompact = formatCompactIntegerString(resource.totalMined);
                        const playerFull = formatTokenAmount(resource.playerWalletBalance);
                        const playerCompact = formatTokenAmountWithCoverage(
                          resource.playerWalletBalance,
                          miningMetrics.reserveSummary?.playerWalletsScanned || 0,
                        );
                        const dailyMinedFull = formatIntegerString(resource.dailyMined);
                        const dailyMinedCompact = formatCompactIntegerString(resource.dailyMined);

                        return (
                        <tr
                          key={idx}
                          className={resource.resourceMint ? "" : "resource-row-no-mint"}
                        >
                          <td className="resource-name">
                            {resource.resourceMint ? (
                              <a
                                href={`https://solscan.io/token/${resource.resourceMint}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {resource.resource}
                              </a>
                            ) : (
                              resource.resource
                            )}
                            <div className="mint-source">
                              {resource.resourceMint
                                ? `${formatMintSourceLabel(resource.resourceMintSource)} · ${formatMintShort(resource.resourceMint)}`
                                : "missing"}
                            </div>
                          </td>
                          <td className="resource-total">
                            <strong>{resource.totalFleets}</strong>
                          </td>
                          <td className="metric-compact">
                            {renderMetricWithTooltip(totalMinedCompact, totalMinedFull)}
                          </td>
                          <td className="metric-compact">
                            {renderMetricWithTooltip(playerCompact, playerFull)}
                          </td>
                          <td className="metric-compact">
                            {renderMetricWithTooltip(dailyMinedCompact, dailyMinedFull)}
                          </td>
                          <td>
                            {(() => {
                              const signal = resource.consumptionSignal || resource.reserveSignal || "balanced";
                              const tooltipParts = [];

                              if (resource.consumptionReason) {
                                tooltipParts.push(resource.consumptionReason);
                              }

                              if (resource.estimatedCoverageDays != null && resource.consumptionSignal === "deficit-risk") {
                                const days = Math.ceil(resource.estimatedCoverageDays);
                                tooltipParts.push(`Coverage: ~${days} day${days !== 1 ? "s" : ""}`);
                              }

                              if (resource.avgProductionLast7d != null && resource.avgConsumptionLast7d != null) {
                                const prod = resource.avgProductionLast7d.toFixed(1);
                                const cons = resource.avgConsumptionLast7d.toFixed(1);
                                tooltipParts.push(`Prod: ${prod}/day · Cons: ${cons}/day`);
                              }

                              const tooltip = tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined;

                              return (
                                <span
                                  className={`reserve-signal-badge ${signal}`}
                                  title={tooltip}
                                  tabIndex={0}
                                >
                                  {formatReserveSignal(signal)}
                                </span>
                              );
                            })()}
                          </td>
                          <td>{resource.resourceHardness ?? "-"}</td>
                          <td>
                            {resource.averageSystemRichness != null
                              ? resource.averageSystemRichness.toLocaleString("ru-RU")
                              : "-"}
                          </td>
                          <td className="faction mud">{resource.byFaction.MUD || 0}</td>
                          <td className="faction oni">{resource.byFaction.ONI || 0}</td>
                          <td className="faction ustur">{resource.byFaction.USTUR || 0}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="placeholder">Нет активной добычи.</p>
              )}

              <div className="resources-meta">
                <p className="timestamp">
                  Обновлено: {new Date(miningMetrics.updatedAt).toLocaleString("ru-RU")}
                </p>
                <p className="reset-info">
                  Следующий сброс: {new Date(miningMetrics.resetAt).toLocaleString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
              </div>
            </>
          ) : (
            <p className="placeholder">
              Нажмите «Обновить Данные» для загрузки on-chain метрик добычи.
            </p>
          )}

          <div className="r4-panel">
            <h3>Ресурсы R4</h3>
            <p className="subtitle">
              Ключевые расходники: Еда, Патроны, Инструменты, Топливо.
              Ресурсы учитываются как on-chain PDA-состояние (не SPL mint): показываем выпуск,
              расход, остаток, сигналы и рынок.
            </p>

            {r4Error ? <p className="error">{r4Error}</p> : null}

            {r4Metrics ? (
              <>
                <div className="r4-summary">
                  {r4Metrics.summary.totalCreatedIsLowerBound ? (
                    <p className="note">
                      Важно: "Создано всего" сейчас показывается как нижняя граница (не all-time),
                      покрытие истории: {r4Metrics.summary.createdCoverageDays} дн.
                      {" "}
                      ({r4Metrics.summary.createdCoverageStartUtcDate || "-"}
                      {" "}→{" "}
                      {r4Metrics.summary.createdCoverageEndUtcDate || "-"}).
                    </p>
                  ) : null}
                  <p>
                    Создано всего: <strong>{renderMetricWithTooltip(
                      formatCompactTokenAmount(r4Metrics.summary.totalCreated),
                      formatTokenAmount(r4Metrics.summary.totalCreated),
                    )}</strong>
                    {" | "}
                    Израсходовано: <strong>{renderMetricWithTooltip(
                      formatCompactTokenAmount(r4Metrics.summary.totalConsumed),
                      formatTokenAmount(r4Metrics.summary.totalConsumed),
                    )}</strong>
                    {" | "}
                    Остаток у игроков: <strong>{r4Metrics.summary.totalPlayerBalanceKnown
                      ? renderMetricWithTooltip(
                        formatCompactTokenAmount(r4Metrics.summary.totalPlayerBalance),
                        formatTokenAmount(r4Metrics.summary.totalPlayerBalance),
                      )
                      : "н/д"}</strong>
                  </p>
                  <p>
                    Дефицит: <strong>{r4Metrics.summary.deficitRiskCount}</strong>
                    {" | "}
                    Баланс: <strong>{r4Metrics.summary.balancedCount}</strong>
                    {" | "}
                    Избыток: <strong>{r4Metrics.summary.surplusRiskCount}</strong>
                    {" | "}
                    Аномалий: <strong>{r4Metrics.summary.anomalyCount}</strong>
                  </p>
                  <p>
                    Program IDs (Mainnet):
                    {" "}
                    <a href={`https://solscan.io/account/${r4Metrics.programIds.sage}`} target="_blank" rel="noreferrer">SAGE</a>
                    {" | "}
                    <a href={`https://solscan.io/account/${r4Metrics.programIds.cargo}`} target="_blank" rel="noreferrer">Cargo</a>
                    {" | "}
                    <a href={`https://solscan.io/account/${r4Metrics.programIds.crafting}`} target="_blank" rel="noreferrer">Crafting</a>
                    {" | "}
                    <a href={`https://solscan.io/account/${r4Metrics.programIds.playerProfile}`} target="_blank" rel="noreferrer">Player Profile</a>
                    {" | "}
                    <a href={r4Metrics.programIds.sourceUrl} target="_blank" rel="noreferrer">Build Docs</a>
                  </p>
                </div>

                <div className="resources-table r4-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Ресурс</th>
                        <th>Создано всего</th>
                        <th>Создано сегодня</th>
                        <th>Остаток</th>
                        <th>Расход 24ч</th>
                        <th>Покрытие (дни)</th>
                        <th>Цена $</th>
                        <th>24ч %</th>
                        <th>BUY объём</th>
                        <th>SELL объём</th>
                        <th>Сигнал</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r4Metrics.resources.map((resource) => {
                        const mintInfo = resource.mint
                          ? `${formatR4MintSourceLabel(resource.mintSource)} · ${formatMintShort(resource.mint)}`
                          : "on-chain PDA";
                        const solscanUrl = resource.mint
                          ? `https://solscan.io/token/${resource.mint}`
                          : undefined;

                        return (
                          <tr key={resource.key} className={resource.mint ? "" : "resource-row-no-mint"}>
                            <td className="resource-name">
                              {solscanUrl ? (
                                <a
                                  href={solscanUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {resource.label}
                                </a>
                              ) : (
                                <span>{resource.label}</span>
                              )}
                              <div className="mint-source">{mintInfo}</div>
                            </td>
                            <td className="metric-compact">{renderMetricWithTooltip(
                              formatCompactTokenAmount(resource.totalCreated),
                              `${formatTokenAmount(resource.totalCreated)}${resource.totalCreatedIsLowerBound ? " (нижняя граница)" : ""}`,
                            )}</td>
                            <td className="metric-compact">{renderMetricWithTooltip(
                              formatCompactTokenAmount(resource.createdToday),
                              formatTokenAmount(resource.createdToday),
                            )}</td>
                            <td className="metric-compact">{renderMetricWithTooltip(
                              formatCompactTokenAmount(resource.totalConsumed),
                              formatTokenAmount(resource.totalConsumed),
                            )}</td>
                            <td className="metric-compact">{resource.playerBalanceKnown
                              ? renderMetricWithTooltip(
                                formatCompactTokenAmount(resource.playerBalance),
                                formatTokenAmount(resource.playerBalance),
                              )
                              : "н/д"}</td>
                            <td className="metric-compact">{renderMetricWithTooltip(
                              formatCompactTokenAmount(resource.dailyConsumption),
                              formatTokenAmount(resource.dailyConsumption),
                            )}</td>
                            <td className="metric-compact">{renderMetricWithTooltip(
                              formatCompactTokenAmount(resource.avgDailyConsumption7d),
                              formatTokenAmount(resource.avgDailyConsumption7d),
                            )}</td>
                            <td>{resource.daysOfCover != null ? resource.daysOfCover.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "-"}</td>
                            <td>{resource.priceUsd > 0 ? resource.priceUsd.toLocaleString("ru-RU", { minimumFractionDigits: 6, maximumFractionDigits: 6 }) : "-"}</td>
                            <td>{formatPercentDelta(resource.priceChange24hPct)}</td>

                            <td>{resource.buyOrderVolume.toLocaleString("ru-RU")}</td>
                            <td>{resource.sellOrderVolume.toLocaleString("ru-RU")}</td>
                            <td>
                              <span
                                className={`reserve-signal-badge ${resource.signal}`}
                                title={resource.signalReason}
                                tabIndex={0}
                              >
                                {formatR4Signal(resource.signal)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="timestamp">
                  Обновлено R4: {new Date(r4Metrics.updatedAt).toLocaleString("ru-RU")}
                  {" | "}
                  Игроков в скане: {r4Metrics.summary.playerWalletsScanned}
                  {" | "}
                  Dev-кошельков: {r4Metrics.summary.developerWalletsScanned}
                </p>
              </>
            ) : (
              <p className="placeholder">Нажмите «Обновить R4», чтобы загрузить аналитику расходников.</p>
            )}
          </div>

          <div className="craft-reference">
            <h3>Крафт: Материалы И Компоненты</h3>
            <p className="subtitle">
              Подготовили рабочий черновик: материалы и компоненты + база под рецепты,
              выход и экономику. Тиры показываются только для verified-записей.
            </p>

            {craftCatalog ? (
              <p className="timestamp">
                Каталог: <strong>{craftCatalog.source}</strong>
                {craftCatalog.verifiedAt ? ` | verifiedAt: ${new Date(craftCatalog.verifiedAt).toLocaleString("ru-RU")}` : " | verifiedAt: pending"}
              </p>
            ) : null}
            {craftCatalogError ? <p className="note">{craftCatalogError}</p> : null}

            <div className="craft-reference-groups">
              {craftReferenceCategories.map((category) => (
                <details key={category.key} className="craft-group" open>
                  <summary>{category.title}</summary>
                  <ul>
                    {category.items.map((item) => (
                      <li key={item.name}>
                        <span className="craft-item-dot" aria-hidden="true">•</span>
                        <span>{item.name}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>

            <div className="resources-table craft-table">
              <table>
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Предмет</th>
                    <th>Тир (verified)</th>
                    <th>Рецепт (черновик)</th>
                    <th>Выход</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {craftReferenceRows.map((row) => (
                    <tr key={`${row.category}-${row.item}`} className={row.verified ? "craft-verified" : "craft-pending"}>
                      <td>{row.category}</td>
                      <td className="resource-name">{row.item}</td>
                      <td>
                        <div className="tier-cell">
                          {row.tier ? (
                            <span className="verified-badge">✓ {row.tier}</span>
                          ) : (
                            <span className="pending-badge">⊘ pending</span>
                          )}
                        </div>
                      </td>
                      <td>{row.recipeDraft}</td>
                      <td>{row.output}</td>
                      <td>
                        <span className="craft-status">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "whales" ? (
        <section className="section whales-section">
          <div className="section-header">
            <h2>🐋 КИТЫ SA</h2>
            <div className="section-header-actions">
              {whalesData ? (
                <span className="data-freshness">
                  Обновлено: {new Date(whalesData.fetchedAt).toLocaleString("ru-RU", { timeZone: "UTC", hour12: false })} UTC
                </span>
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setWhalesData(null); void loadWhales(); }}
                disabled={whalesLoading}
              >
                {whalesLoading ? "Загрузка…" : "↻ Обновить"}
              </button>
            </div>
          </div>

          {whalesError ? (
            <div className="error-banner">{whalesError}</div>
          ) : null}

          {whalesLoading && !whalesData ? (
            <div className="loading-state">Загружаем данные по китам…</div>
          ) : null}

          {whalesData ? (
            <div className="whales-grid">
              {/* ── ATLAS column ── */}
              <div className="whales-col">
                {/* Top-10 ATLAS holders */}
                <div className="whale-panel">
                  <h3 className="whale-panel-title">
                    <span className="whale-token-badge atlas-badge">ATLAS</span>
                    Топ-10 холдеров
                  </h3>
                  <table className="whale-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Кошелёк</th>
                        <th>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whalesData.atlasHolders.length === 0 ? (
                        <tr><td colSpan={3} className="no-data">Нет данных</td></tr>
                      ) : whalesData.atlasHolders.map((h) => (
                        <tr key={h.tokenAccount}>
                          <td className="rank-cell">{h.rank}</td>
                          <td className="wallet-cell">
                            <a
                              href={`https://solscan.io/account/${h.wallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="wallet-link"
                              title={h.wallet}
                            >
                              {h.wallet.slice(0, 4)}…{h.wallet.slice(-4)}
                            </a>
                          </td>
                          <td className="amount-cell">{Number(h.uiAmount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Top-10 ATLAS large trades */}
                <div className="whale-panel">
                  <h3 className="whale-panel-title">
                    <span className="whale-token-badge atlas-badge">ATLAS</span>
                    Крупные сделки 24ч
                  </h3>
                  <table className="whale-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Время UTC</th>
                        <th>Тип</th>
                        <th>Кол-во</th>
                        <th>От</th>
                        <th>Кому</th>
                        <th>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whalesData.atlasTrades.length === 0 ? (
                        <tr><td colSpan={7} className="no-data">Нет крупных сделок за 24ч</td></tr>
                      ) : whalesData.atlasTrades.map((t) => (
                        <tr key={`${t.signature}-${t.direction}`} className={`trade-row trade-${t.direction}`}>
                          <td className="rank-cell">{t.rank}</td>
                          <td className="time-cell">
                            {new Date(t.timestamp * 1000).toLocaleTimeString("ru-RU", { timeZone: "UTC", hour12: false })}
                          </td>
                          <td className="dir-cell">
                            <span className={`direction-badge direction-${t.direction}`}>
                              {t.direction === "buy" ? "🟢 BUY" : t.direction === "sell" ? "🔴 SELL" : "↔ MOVE"}
                            </span>
                          </td>
                          <td className="amount-cell">{t.uiAmount}</td>
                          <td className="wallet-cell">
                            {t.fromWallet ? (
                              <a href={`https://solscan.io/account/${t.fromWallet}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.fromWallet}>
                                {t.fromWallet.slice(0, 4)}…{t.fromWallet.slice(-4)}
                              </a>
                            ) : "—"}
                          </td>
                          <td className="wallet-cell">
                            {t.toWallet ? (
                              <a href={`https://solscan.io/account/${t.toWallet}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.toWallet}>
                                {t.toWallet.slice(0, 4)}…{t.toWallet.slice(-4)}
                              </a>
                            ) : "—"}
                          </td>
                          <td className="tx-cell">
                            <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.signature}>
                              {t.signature.slice(0, 6)}…
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── POLIS column ── */}
              <div className="whales-col">
                {/* Top-10 POLIS holders */}
                <div className="whale-panel">
                  <h3 className="whale-panel-title">
                    <span className="whale-token-badge polis-badge">POLIS</span>
                    Топ-10 холдеров
                  </h3>
                  <table className="whale-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Кошелёк</th>
                        <th>Кол-во</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whalesData.polisHolders.length === 0 ? (
                        <tr><td colSpan={3} className="no-data">Нет данных</td></tr>
                      ) : whalesData.polisHolders.map((h) => (
                        <tr key={h.tokenAccount}>
                          <td className="rank-cell">{h.rank}</td>
                          <td className="wallet-cell">
                            <a
                              href={`https://solscan.io/account/${h.wallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="wallet-link"
                              title={h.wallet}
                            >
                              {h.wallet.slice(0, 4)}…{h.wallet.slice(-4)}
                            </a>
                          </td>
                          <td className="amount-cell">{Number(h.uiAmount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Top-10 POLIS large trades */}
                <div className="whale-panel">
                  <h3 className="whale-panel-title">
                    <span className="whale-token-badge polis-badge">POLIS</span>
                    Крупные сделки 24ч
                  </h3>
                  <table className="whale-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Время UTC</th>
                        <th>Тип</th>
                        <th>Кол-во</th>
                        <th>От</th>
                        <th>Кому</th>
                        <th>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whalesData.polisTrades.length === 0 ? (
                        <tr><td colSpan={7} className="no-data">Нет крупных сделок за 24ч</td></tr>
                      ) : whalesData.polisTrades.map((t) => (
                        <tr key={`${t.signature}-${t.direction}`} className={`trade-row trade-${t.direction}`}>
                          <td className="rank-cell">{t.rank}</td>
                          <td className="time-cell">
                            {new Date(t.timestamp * 1000).toLocaleTimeString("ru-RU", { timeZone: "UTC", hour12: false })}
                          </td>
                          <td className="dir-cell">
                            <span className={`direction-badge direction-${t.direction}`}>
                              {t.direction === "buy" ? "🟢 BUY" : t.direction === "sell" ? "🔴 SELL" : "↔ MOVE"}
                            </span>
                          </td>
                          <td className="amount-cell">{t.uiAmount}</td>
                          <td className="wallet-cell">
                            {t.fromWallet ? (
                              <a href={`https://solscan.io/account/${t.fromWallet}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.fromWallet}>
                                {t.fromWallet.slice(0, 4)}…{t.fromWallet.slice(-4)}
                              </a>
                            ) : "—"}
                          </td>
                          <td className="wallet-cell">
                            {t.toWallet ? (
                              <a href={`https://solscan.io/account/${t.toWallet}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.toWallet}>
                                {t.toWallet.slice(0, 4)}…{t.toWallet.slice(-4)}
                              </a>
                            ) : "—"}
                          </td>
                          <td className="tx-cell">
                            <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noopener noreferrer" className="wallet-link" title={t.signature}>
                              {t.signature.slice(0, 6)}…
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

export default App;
