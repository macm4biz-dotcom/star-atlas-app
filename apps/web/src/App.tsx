import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
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
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1Y");
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

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
    ],
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
  });
}

function App() {
  const { connection } = useConnection();
  const { publicKey, connected, signMessage, signTransaction } = useWallet();
  const [activeTab, setActiveTab] = useState<
    "news" | "archive" | "dashboard" | "bridge" | "market" | "intel"
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
  const [bridgePreflight, setBridgePreflight] = useState<BridgePreflight | null>(null);
  const [bridgePreflightForm, setBridgePreflightForm] = useState({
    operationType: "fleet-dispatch" as BridgeOperationType,
    operationValueUsd: "3500",
    routeComplexity: "3",
    riskTolerance: "medium" as BridgeRiskTolerance,
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

  const bridgeFilteredAuditData = useMemo(() => {
    const now = Date.now();
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

      return now - createdAtMs <= maxAgeMs;
    });
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
      return;
    }
    setWalletAuthUser(null);
  }, [walletAuthToken]);

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

  const loadListings = async () => {
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
  };

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

    const sellerWallet = marketWallet.trim();
    if (!sellerWallet) {
      setListingsMessage("Сначала укажи кошелек в разделе Market.");
      return;
    }

    if (!isLikelySolanaAddress(sellerWallet)) {
      setListingsMessage("Некорректный адрес кошелька для продажи.");
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
      setListingsMessage("NFT выставлен на рынок.");
      await loadListings();
    } catch (createError) {
      setListingsMessage("Ошибка создания листинга.");
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
      await apiRequest(`/api/market/listings/${listingId}/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${walletAuthToken}`,
        },
        body: JSON.stringify({ txSignature }),
      });

      setListingsMessage("Покупка подтверждена.");
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
        marketConfig?.platformFeeWallet ?? "YQmg9nTsvVLUgtj35pY8WUPRVGHaz7KfmaCgPuS6bwY",
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
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;

      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
      await connection.confirmTransaction(signature, "confirmed");

      await buyListing(listing.id, signature);
    } catch (buyError) {
      setListingsMessage(`Ошибка оплаты: ${getErrorMessage(buyError)}`);
    } finally {
      setListingsBusy(false);
    }
  };

  const loadBarters = async () => {
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
  };

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

  const loadBridgeRuntime = async (
    role: BridgeRole = bridgeRole,
    profile: BridgeC4Profile = bridgeProfile,
  ) => {
    setBridgeLoading(true);
    setBridgeMessage(null);

    try {
      const [config, alerts, audit] = await Promise.all([
        apiRequest<BridgeConfig>(
          `/api/bridge/config?role=${encodeURIComponent(role)}&profile=${encodeURIComponent(profile)}`,
        ),
        apiRequest<BridgeAlertsResponse>(
          `/api/bridge/alerts?role=${encodeURIComponent(role)}&limit=12`,
        ),
        apiRequest<BridgeAuditResponse>(
          `/api/bridge/audit?role=${encodeURIComponent(role)}&limit=10`,
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
  };

  const runBridgePreflight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    setBridgeBusy(true);
    setBridgeMessage(null);

    try {
      await apiRequest(`/api/bridge/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
        ),
        apiRequest<BridgeAuditResponse>(
          `/api/bridge/audit?role=${encodeURIComponent(bridgeRole)}&limit=10`,
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
  }, [activeTab, marketSection, listingsClass, listingsSearch, listingsStatus]);

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
  }, [activeTab, marketSection, bartersStatus]);

  useEffect(() => {
    if ((activeTab === "news" || activeTab === "intel") && !intelData && !intelLoading) {
      void loadIntelOverview();
    }
  }, [activeTab, intelData, intelLoading]);

  useEffect(() => {
    if (activeTab === "archive" && !archiveData && !archiveLoading) {
      void loadNewsArchive();
    }
  }, [activeTab, archiveData, archiveLoading]);

  useEffect(() => {
    if (activeTab === "bridge" && !bridgeConfig && !bridgeLoading) {
      void loadBridgeRuntime();
    }
  }, [activeTab, bridgeConfig, bridgeLoading]);

  const sourceLabel: Record<IntelSourceKey, string> = {
    official: "Official",
    medium: "Medium",
    x: "X",
    discord: "Discord",
  };

  const bridgeMapPresets = [
    {
      name: "Tactical",
      payload: "Флоты ДАК, враги, риск-зоны, hot-ивенты 5-15с",
    },
    {
      name: "Logistics",
      payload: "Маршруты, груз, ETA, bottleneck и ресурсы в пути",
    },
    {
      name: "Economy",
      payload: "NAV, спреды, burn rate, маржа крафта vs market",
    },
    {
      name: "Command",
      payload: "Сводка по операциям, рискам и статусу API/воркеров",
    },
  ];

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

  return (
    <main className="page">
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
        <button
          type="button"
          className={activeTab === "bridge" ? "section-tab active" : "section-tab"}
          onClick={() => setActiveTab("bridge")}
        >
          Капитанский Мостик
        </button>
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

      {activeTab === "bridge" ? (
        <section className="panel bridge-panel">
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

          <div className="bridge-live-layout">
            <article className="bridge-card">
              <h3>Pre-Flight Симуляция</h3>
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

            <article className="bridge-card">
              <h3>Live Alerts</h3>
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

            <article className="bridge-card">
              <h3>Audit Trail</h3>
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
            <article className="bridge-card">
              <h3>Карта И Пресеты Ролей</h3>
              <p className="bridge-card-lead">
                Режим 2D top-down, все пространство Star Atlas, read-only карта в
                MVP с профильными пресетами.
              </p>
              <ul className="bridge-list">
                {bridgeMapPresets.map((preset) => (
                  <li key={preset.name}>
                    <strong>{preset.name}:</strong> {preset.payload}
                  </li>
                ))}
              </ul>
            </article>

            <article className="bridge-card">
              <h3>Операции MVP 2</h3>
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

            <article className="bridge-card">
              <h3>Уведомления И Эскалации</h3>
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

            <article className="bridge-card">
              <h3>Доступ И Безопасность</h3>
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

            <article className="bridge-card bridge-card-wide">
              <h3>MVP 2 Readiness</h3>
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
                      <p className="market-listing-price">{listing.priceUsd.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</p>
                      <p className="market-listing-wallet">Продавец: {listing.sellerWallet.slice(0, 4)}...{listing.sellerWallet.slice(-4)}</p>
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

                <p className="note">Оплата только в USDC. Комиссия платформы: {(marketConfig?.platformFeeBps ?? 100) / 100}%.</p>

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
    </main>
  );
}

export default App;
