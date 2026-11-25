import { NextResponse } from "next/server";

const NO_STORE = "no-store";

export function jsonNoStore<T>(
  body: T,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": NO_STORE, ...(init?.headers ?? {}) },
  });
}

export function errorNoStore(status: number, message: string): NextResponse {
  return jsonNoStore({ error: message }, { status });
}

function requestHost(req: Request): string | null {
  const header = req.headers.get("host");
  if (header) {
    return header;
  }
  try {
    return new URL(req.url).host;
  } catch {
    return null;
  }
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return true;
  }
  const host = requestHost(req);
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") ?? "desconhecido";
}

export function deriveBaseUrl(req: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  const host = requestHost(req);
  if (!host) {
    return "";
  }
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = req.headers.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie");
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}
