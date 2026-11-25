type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

// Melhor esforço em memória por instância (PRD 11: NÃO constitui proteção
// distribuída; o limite real por IP deve vir da infraestrutura de borda).
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
