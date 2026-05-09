import Fastify from "fastify";
import cors from "@fastify/cors";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import type {
  DashboardSnapshot,
  FleetAsset,
  HealthResponse,
} from "@star-atlas/shared";

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
    },
  };
});

app.get(
  "/health",
  async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "star-atlas-api",
    time: new Date().toISOString(),
  }),
);

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
}>("/api/intel/overview", async (request) => {
  const limit = Number(request.query.limit || 12);
  return buildIntelOverview(Number.isFinite(limit) ? limit : 12);
});

app.get<{
  Querystring: {
    limit?: number;
  };
}>("/api/news/archive", async (request): Promise<NewsArchiveResponse> => {
  await syncNewsArchiveIfNeeded();
  const requestedLimit = Number(request.query.limit || 30);
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 120))
    : 30;
  const entries = sortByPeriodEndDesc(await readNewsArchiveEntries()).slice(0, safeLimit);
  return {
    generatedAt: new Date().toISOString(),
    entries,
  };
});

app.post<{ Querystring: { force?: string } }>("/api/news/archive/sync", async (request) => {
  const force = String(request.query.force || "0") === "1";
  await syncNewsArchiveIfNeeded({ forceGenesis: force });
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
  };
}>("/api/market/listings", async (request, reply) => {
  const { itemName, itemClass, quantity, priceUsd, paymentToken, sellerWallet, note } =
    request.body || {};

  if (!itemName || !itemClass || !quantity || !priceUsd || !paymentToken || !sellerWallet) {
    return reply.code(400).send({ error: "Missing required listing fields" });
  }

  const listing: MarketListing = {
    id: createId("lst"),
    itemName: String(itemName).trim(),
    itemClass,
    quantity: Number(quantity),
    priceUsd: Number(priceUsd),
    paymentToken,
    sellerWallet: String(sellerWallet).trim(),
    note: note ? String(note).trim() : undefined,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  marketListings.unshift(listing);
  return reply.code(201).send(listing);
});

app.post<{
  Params: { id: string };
  Body: { buyerWallet?: string };
}>("/api/market/listings/:id/buy", async (request, reply) => {
  const listing = marketListings.find((item) => item.id === request.params.id);

  if (!listing) {
    return reply.code(404).send({ error: "Listing not found" });
  }

  if (listing.status !== "active") {
    return reply.code(409).send({ error: "Listing is no longer active" });
  }

  const buyerWallet = String(request.body?.buyerWallet || "").trim();
  if (!buyerWallet) {
    return reply.code(400).send({ error: "buyerWallet is required" });
  }

  if (buyerWallet === listing.sellerWallet) {
    return reply.code(400).send({ error: "Seller cannot buy own listing" });
  }

  listing.status = "sold";
  listing.buyerWallet = buyerWallet;

  return {
    success: true,
    listing,
    message: "Purchase simulated successfully",
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
  const { fromWallet, offerItem, wantItem, extraUsd = 0, note } = request.body || {};

  if (!fromWallet || !offerItem || !wantItem) {
    return reply.code(400).send({ error: "Missing required barter fields" });
  }

  const offer: BarterOffer = {
    id: createId("bar"),
    fromWallet: String(fromWallet).trim(),
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
  const offer = barterOffers.find((item) => item.id === request.params.id);

  if (!offer) {
    return reply.code(404).send({ error: "Barter offer not found" });
  }

  if (offer.status !== "open") {
    return reply.code(409).send({ error: "Offer is no longer open" });
  }

  const responderWallet = String(request.body?.responderWallet || "").trim();
  const action = request.body?.action;

  if (!responderWallet || (action !== "accept" && action !== "decline")) {
    return reply.code(400).send({ error: "responderWallet and valid action are required" });
  }

  offer.responderWallet = responderWallet;
  offer.status = action === "accept" ? "accepted" : "declined";

  return {
    success: true,
    offer,
  };
});

const start = async () => {
  try {
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
