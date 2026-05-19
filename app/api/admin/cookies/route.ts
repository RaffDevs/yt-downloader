import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

const MAX_COOKIE_SIZE_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const adminToken = process.env.COOKIE_ADMIN_TOKEN?.trim();
  if (!adminToken) {
    return Response.json({ error: "Endpoint de cookies desabilitado." }, { status: 403 });
  }

  const providedToken = request.headers.get("x-admin-token")?.trim();
  if (!providedToken || providedToken !== adminToken) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type deve ser application/json." }, { status: 415 });
  }

  const body = (await request.json().catch(() => null)) as { cookies?: string } | null;
  const cookies = body?.cookies?.trim() ?? "";

  if (!cookies) {
    return Response.json({ error: "Payload de cookies vazio." }, { status: 400 });
  }

  if (Buffer.byteLength(cookies, "utf8") > MAX_COOKIE_SIZE_BYTES) {
    return Response.json({ error: "Payload de cookies excede o limite permitido." }, { status: 413 });
  }

  if (!looksLikeNetscapeCookies(cookies)) {
    return Response.json({ error: "Formato invalido. Envie cookies.txt no formato Netscape." }, { status: 400 });
  }

  const configuredPath = process.env.YTDLP_COOKIES_PATH?.trim() || "/tmp/youtube-cookies.txt";
  const outputPath = isAbsolute(configuredPath) ? configuredPath : join("/tmp", configuredPath);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${cookies}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(outputPath, 0o600);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gravar cookies.";
    console.error("[admin-cookies-route]", message);
    return Response.json({ error: "Falha ao gravar cookies no servidor." }, { status: 500 });
  }

  return Response.json({ ok: true, path: outputPath });
}

function looksLikeNetscapeCookies(content: string) {
  const normalized = content.replace(/^\uFEFF/, "");
  if (normalized.includes("# Netscape HTTP Cookie File")) {
    return true;
  }

  const firstLines = normalized.split("\n").slice(0, 10).join("\n");
  return firstLines.includes("youtube.com") && firstLines.includes("\t");
}
