export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  code?: string;
  endpoint: string;

  constructor(message: string, status: number, endpoint: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.code = code;
  }
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 15000, retries = 2, ...fetchOptions } = options;
  const url = `${API_BASE_URL}${endpoint}`;

  // Use the authentication system token if available, otherwise fallback for dev testing
  const token = typeof window !== "undefined" ? localStorage.getItem("lm_auth_token") || "dev-inspector" : "dev-inspector";
  const headers = new Headers(fetchOptions.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const enhancedOptions = { ...fetchOptions, headers };
  let attempt = 0;

  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...enhancedOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Do not retry 4xx errors except 408 / 429
      if (!response.ok) {
        const isTransient = [408, 429, 500, 502, 503, 504].includes(response.status);
        if (isTransient && attempt <= retries) {
          await delay(attempt * 1000); // Exponential backoff
          continue;
        }

        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = null;
        }

        throw new ApiError(
          errorData?.error?.message || errorData?.message || response.statusText || "Request failed",
          response.status,
          endpoint,
          errorData?.error?.code
        );
      }

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await response.json();
        return data as T;
      }
      
      return response as any as T; // e.g. Blob or raw string
    } catch (err: any) {
      clearTimeout(timeoutId);
      
      // If AbortError (timeout) or network error, it's transient
      const isTransient = err.name === "AbortError" || err.message === "Failed to fetch";
      if (isTransient && attempt <= retries) {
        await delay(attempt * 1000);
        continue;
      }

      if (err instanceof ApiError) throw err;

      let msg = err.message;
      if (err.name === "AbortError") {
        msg = "Request timed out";
      } else if (msg === "Failed to fetch") {
        msg = "Network error: Unable to connect to server";
      }
      
      throw new ApiError(msg, 0, endpoint, "NETWORK_ERROR");
    }
  }

  throw new Error("Unreachable");
}

export interface BackendHealthResponse {
  status: "healthy" | "degraded";
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  system: { memoryMb: number; nodeVersion: string };
  dependencies: {
    supabase: { status: "connected" | "error"; latencyMs: number; error?: string };
  };
}

export async function checkBackendHealth(): Promise<BackendHealthResponse> {
  return apiClient<BackendHealthResponse>("/api/health", { retries: 0 });
}
