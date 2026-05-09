import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { apiRequest } from "./apiClient";
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
  createdAt: string;
};

type BarterStatus = "open" | "accepted" | "declined";

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

function parsePositiveInteger(input: string) {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseNonNegativeNumber(input: string) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function isLikelySolanaAddress(address: string) {
  return /^Demo[A-Za-z0-9_-]{2,}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function App() {
  const { publicKey, connected } = useWallet();
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

  const connectedWalletAddress = publicKey?.toBase58() || "";
  const marketWallet = connectedWalletAddress || manualMarketWallet;

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

  const createListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setListingsMessage(null);

    const sellerWallet = marketWallet.trim();
    if (!sellerWallet) {
      setListingsMessage("Сначала укажи кошелек в разделе Market.");
      return;
    }

    if (!isLikelySolanaAddress(sellerWallet)) {
      setListingsMessage("Некорректный адрес кошелька для продажи.");
      return;
    }

    const itemName = newListing.itemName.trim();
    if (!itemName) {
      setListingsMessage("Укажи название актива.");
      return;
    }

    const quantity = parsePositiveInteger(newListing.quantity);
    if (quantity === null) {
      setListingsMessage("Количество должно быть целым числом больше 0.");
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
        },
        body: JSON.stringify({
          itemName,
          itemClass: newListing.itemClass,
          quantity,
          priceUsd,
          paymentToken: newListing.paymentToken,
          sellerWallet,
          note: newListing.note.trim(),
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
      setListingsMessage("Лот выставлен на рынок.");
      await loadListings();
    } catch (createError) {
      setListingsMessage("Ошибка создания листинга.");
      console.error(createError);
    }
  };

  const buyListing = async (listingId: string) => {
    setListingsMessage(null);

    const buyerWallet = marketWallet.trim();
    if (!buyerWallet) {
      setListingsMessage("Для покупки укажи кошелек в разделе Market.");
      return;
    }

    if (!isLikelySolanaAddress(buyerWallet)) {
      setListingsMessage("Некорректный адрес кошелька для покупки.");
      return;
    }

    try {
      await apiRequest(`/api/market/listings/${listingId}/buy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ buyerWallet }),
      });

      setListingsMessage("Покупка успешно симулирована.");
      await loadListings();
    } catch (buyError) {
      setListingsMessage("Ошибка покупки лота.");
      console.error(buyError);
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

  const sourceLabel: Record<IntelSourceKey, string> = {
    official: "Official",
    medium: "Medium",
    x: "X",
    discord: "Discord",
  };

  return (
    <main className="page">
      <header className="hero">
        <p className="tag">Star Atlas Command Center</p>
        <h1>Аналитика флота и активов</h1>
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
        <section className="panel">
          <h2>Капитанский Мостик</h2>
          <p className="subtitle">
            Быстрый центр управления: переходи к ключевым разделам и следи за
            текущим состоянием приложения.
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
              </div>

              {listingsMessage ? <p className="note">{listingsMessage}</p> : null}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Лот</th>
                      <th>Класс</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Продавец</th>
                      <th>Статус</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listings.map((listing) => (
                      <tr key={listing.id}>
                        <td>{listing.itemName}</td>
                        <td>{listing.itemClass}</td>
                        <td>{listing.quantity}</td>
                        <td>
                          ${listing.priceUsd.toLocaleString()} {listing.paymentToken}
                        </td>
                        <td>{listing.sellerWallet}</td>
                        <td>{listing.status}</td>
                        <td>
                          <button
                            type="button"
                            disabled={listing.status !== "active"}
                            onClick={() => {
                              void buyListing(listing.id);
                            }}
                          >
                            Купить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="market-subtitle">Выставить На Продажу</h3>
              <form className="market-settings-form" onSubmit={createListing}>
                <label htmlFor="new-listing-name">Название актива</label>
                <input
                  id="new-listing-name"
                  value={newListing.itemName}
                  onChange={(event) =>
                    setNewListing((current) => ({
                      ...current,
                      itemName: event.target.value,
                    }))
                  }
                  required
                />

                <div className="market-grid-3">
                  <div>
                    <label htmlFor="new-listing-class">Класс</label>
                    <select
                      id="new-listing-class"
                      value={newListing.itemClass}
                      onChange={(event) =>
                        setNewListing((current) => ({
                          ...current,
                          itemClass: event.target.value as FleetAsset["class"],
                        }))
                      }
                    >
                      <option value="Ship">Ship</option>
                      <option value="Crew">Crew</option>
                      <option value="Resource">Resource</option>
                      <option value="NFT">NFT</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="new-listing-qty">Количество</label>
                    <input
                      id="new-listing-qty"
                      type="number"
                      min="1"
                      value={newListing.quantity}
                      onChange={(event) =>
                        setNewListing((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>

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

                <label htmlFor="new-listing-token">Токен оплаты</label>
                <select
                  id="new-listing-token"
                  value={newListing.paymentToken}
                  onChange={(event) =>
                    setNewListing((current) => ({
                      ...current,
                      paymentToken: event.target.value as PaymentToken,
                    }))
                  }
                >
                  <option value="USDC">USDC</option>
                  <option value="ATLAS">ATLAS</option>
                  <option value="SOL">SOL</option>
                </select>

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

                <button type="submit">Выставить Лот</button>
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
