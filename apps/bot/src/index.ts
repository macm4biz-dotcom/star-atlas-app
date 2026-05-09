import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

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

type IntelSourceKey = "official" | "medium" | "x" | "discord";

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

const BOT_SRC_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_ROOT_DIR = resolve(BOT_SRC_DIR, "..");
const POSTED_IDS_FILE = resolve(BOT_ROOT_DIR, "data", "posted-archive-ids.json");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ARCHIVE_CHAT_ID = process.env.TELEGRAM_ARCHIVE_CHAT_ID || "";
const STAR_ATLAS_API_BASE = process.env.STAR_ATLAS_API_BASE || "http://127.0.0.1:4100";
const PUBLISH_INTERVAL_MS = 15 * 60 * 1000;
const UPSTASH_REDIS_REST_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
const UPSTASH_REDIS_REST_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const BOT_POSTED_IDS_REDIS_KEY =
  (process.env.BOT_POSTED_IDS_REDIS_KEY || "star-atlas:bot:posted_ids").trim();
const BOT_SHARED_STATE_ENABLED = Boolean(
  UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN,
);

async function upstashCommand<T>(command: string[]) {
  if (!BOT_SHARED_STATE_ENABLED) {
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

async function readPostedIds() {
  const sharedValue = await upstashCommand<string[]>(["SMEMBERS", BOT_POSTED_IDS_REDIS_KEY]);
  if (Array.isArray(sharedValue)) {
    return new Set(sharedValue);
  }

  try {
    const raw = await readFile(POSTED_IDS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { ids?: string[] };
    return new Set(Array.isArray(parsed.ids) ? parsed.ids : []);
  } catch {
    return new Set<string>();
  }
}

async function writePostedIds(ids: Set<string>) {
  if (BOT_SHARED_STATE_ENABLED) {
    await upstashCommand(["DEL", BOT_POSTED_IDS_REDIS_KEY]);
    const values = Array.from(ids);
    if (values.length > 0) {
      await upstashCommand(["SADD", BOT_POSTED_IDS_REDIS_KEY, ...values]);
    }
    return;
  }

  await mkdir(dirname(POSTED_IDS_FILE), { recursive: true });
  await writeFile(
    POSTED_IDS_FILE,
    JSON.stringify({ ids: Array.from(ids).sort() }, null, 2),
    "utf-8",
  );
}

async function fetchNewsArchive() {
  const response = await fetch(`${STAR_ATLAS_API_BASE}/api/news/archive?limit=40`);
  if (!response.ok) {
    throw new Error(`Archive fetch failed: HTTP ${response.status}`);
  }
  return (await response.json()) as NewsArchiveResponse;
}

function buildTelegramMessage(entry: NewsArchiveEntry) {
  const period = `${new Date(entry.periodStart).toLocaleDateString("ru-RU")} - ${new Date(
    entry.periodEnd,
  ).toLocaleDateString("ru-RU")}`;
  const tags = entry.tags.length ? `#${entry.tags.join(" #")}` : "#StarAtlas";
  const body = entry.content.replace(/\s+/g, " ").slice(0, 2300);

  return [
    `🛰 ${entry.title}`,
    `Период: ${period}`,
    `Сигналы: ${entry.totalSignals} (Discord ${entry.sourceStats.discord}, Medium ${entry.sourceStats.medium}, X ${entry.sourceStats.x})`,
    "",
    entry.summary,
    "",
    body,
    "",
    tags,
  ].join("\n");
}

async function sendTelegramMessage(text: string) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_ARCHIVE_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram send failed: HTTP ${response.status}`);
  }
}

async function publishNewArchiveEntries() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ARCHIVE_CHAT_ID) {
    console.log(
      "[bot] Archive publisher disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ARCHIVE_CHAT_ID.",
    );
    return;
  }

  const postedIds = await readPostedIds();
  const archive = await fetchNewsArchive();
  const pending = [...archive.entries]
    .filter((entry) => !postedIds.has(entry.id))
    .sort(
      (left, right) =>
        new Date(left.periodEnd).getTime() - new Date(right.periodEnd).getTime(),
    );

  if (pending.length === 0) {
    return;
  }

  for (const entry of pending) {
    const message = buildTelegramMessage(entry);
    await sendTelegramMessage(message);
    postedIds.add(entry.id);
    console.log(`[bot] Published archive article: ${entry.id}`);
  }

  await writePostedIds(postedIds);
}

async function runPublisherCycle() {
  try {
    await publishNewArchiveEntries();
  } catch (error) {
    console.error("[bot] publisher cycle failed", error);
  }
}

console.log("[bot] Star Atlas Telegram archive publisher is ready.");
console.log(`[bot] deployVersion=${process.env.RAILWAY_GIT_COMMIT_SHA || "local"}`);
console.log(
  `[bot] Posted IDs backend: ${BOT_SHARED_STATE_ENABLED ? "Upstash shared state" : "local file"}`,
);
void runPublisherCycle();
setInterval(() => {
  void runPublisherCycle();
}, PUBLISH_INTERVAL_MS);
