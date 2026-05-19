type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

let downloadInProgress = false;

export function getClientIp(request: Request) {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();

  return "unknown";
}

export function hitRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { blocked: false, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return { blocked: true, remaining: 0 };
  }

  bucket.count += 1;
  return { blocked: false, remaining: limit - bucket.count };
}

export function tryAcquireDownloadLock() {
  if (downloadInProgress) {
    return false;
  }

  downloadInProgress = true;
  return true;
}

export function releaseDownloadLock() {
  downloadInProgress = false;
}

export function publicErrorMessage(fallback: string) {
  return process.env.NODE_ENV === "production" ? fallback : undefined;
}
