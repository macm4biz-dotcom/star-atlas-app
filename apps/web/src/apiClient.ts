export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

const RAILWAY_API_BASE_BY_WEB_HOST: Record<string, string> = {
  "web-production-1b799.up.railway.app":
    "https://star-atlasapi-production.up.railway.app",
};

const runtimeApiBaseUrl =
  typeof window !== "undefined"
    ? RAILWAY_API_BASE_BY_WEB_HOST[window.location.hostname] || ""
    : "";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || runtimeApiBaseUrl || "").replace(
    /\/$/,
    "",
  );

const API_REQUEST_TIMEOUT_MS = 12_000;
const API_REQUEST_MAX_ATTEMPTS = 2;

function withApiBaseUrl(input: RequestInfo | URL) {
  if (!API_BASE_URL || typeof input !== "string") {
    return input;
  }

  if (input.startsWith("/")) {
    return `${API_BASE_URL}${input}`;
  }

  return input;
}

async function parseErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string; error?: string };
      return payload.message || payload.error || `HTTP ${response.status}`;
    }

    const text = await response.text();
    return text || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function createTimeoutSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const abortFromExternal = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

function shouldRetryRequest(error: unknown, attempt: number) {
  if (attempt >= API_REQUEST_MAX_ATTEMPTS) {
    return false;
  }

  if (error instanceof ApiRequestError) {
    return [408, 429, 502, 503, 504].includes(error.status);
  }

  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "TypeError";
  }

  return false;
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(
      API_REQUEST_TIMEOUT_MS,
      init?.signal ?? undefined,
    );

    try {
      const response = await fetch(withApiBaseUrl(input), {
        ...init,
        signal,
        cache: init?.cache ?? "no-store",
      });

      if (!response.ok) {
        const message = await parseErrorMessage(response);
        throw new ApiRequestError(message, response.status);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (!shouldRetryRequest(error, attempt)) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new ApiRequestError("Таймаут запроса к API", 408);
        }
        throw error;
      }
    } finally {
      cleanup();
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new ApiRequestError("Таймаут запроса к API", 408);
  }
  throw lastError;
}
