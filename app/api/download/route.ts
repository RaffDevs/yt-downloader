import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  getClientIp,
  hitRateLimit,
  publicErrorMessage,
  releaseDownloadLock,
  tryAcquireDownloadLock,
} from "@/lib/api-security";

type MediaType = "video" | "audio";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rate = hitRateLimit(`download:${ip}`, 10, 60_000);
  if (rate.blocked) {
    return Response.json({ error: "Muitas requisicoes. Tente novamente em alguns instantes." }, { status: 429 });
  }

  if (!tryAcquireDownloadLock()) {
    return Response.json({ error: "Ja existe um download em andamento. Aguarde finalizar." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);

  const url = searchParams.get("url")?.trim() ?? "";
  const mediaType = (searchParams.get("mediaType") ?? "video") as MediaType;
  const format = searchParams.get("format")?.trim() || "bestvideo+bestaudio/best";

  if (!isYouTubeUrl(url)) {
    return Response.json({ error: "URL do YouTube invalida." }, { status: 400 });
  }

  if (mediaType !== "video" && mediaType !== "audio") {
    return Response.json({ error: "Tipo de midia invalido." }, { status: 400 });
  }

  let workDir = "";

  try {
    workDir = await mkdtemp(join(tmpdir(), "yt-download-"));
    const outputTemplate = join(workDir, "%(title).180B.%(ext)s");
    const args = mediaType === "audio"
      ? ["--no-playlist", "-x", "--audio-format", "mp3", "-f", "bestaudio", "-o", outputTemplate, url]
      : [
          "--no-playlist",
          "-f",
          format,
          "--merge-output-format",
          "mp4",
          "--recode-video",
          "mp4",
          "-o",
          outputTemplate,
          url,
        ];

    await runYtDlp(withYtDlpDefaults(args));

    const filePath = await getSingleFilePath(workDir);
    const content = await readFile(filePath);
    const extension = filePath.split(".").pop()?.toLowerCase() ?? "bin";
    const fileName = sanitizeDownloadFileName(basename(filePath), extension);

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFromExt(extension),
        "Content-Disposition": buildContentDisposition(fileName),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao preparar download.";
    console.error("[download-route]", message);
    const safeMessage = publicErrorMessage("Falha ao preparar download. Tente novamente.") ?? message;
    return Response.json({ error: safeMessage }, { status: 500 });
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
    releaseDownloadLock();
  }
}

async function getSingleFilePath(directory: string) {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(directory);
  const first = files.at(0);
  if (!first) {
    throw new Error("Nao foi possivel gerar o arquivo de download.");
  }

  return join(directory, first);
}

async function runProcess(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || "Falha ao executar yt-dlp."));
    });
  });
}

async function runYtDlp(args: string[]) {
  const preferred = process.env.YTDLP_PATH?.trim();
  const candidates: Array<{ command: string; args: string[] }> = [
    ...(preferred ? [{ command: preferred, args }] : []),
    { command: "yt-dlp", args },
    { command: "python3", args: ["-m", "yt_dlp", ...args] },
    { command: "python", args: ["-m", "yt_dlp", ...args] },
  ];

  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      await runProcess(candidate.command, candidate.args);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.command}: ${message}`);
    }
  }

  throw new Error(buildYtDlpErrorMessage(errors));
}

function contentTypeFromExt(ext: string) {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function buildContentDisposition(fileName: string) {
  const escaped = fileName.replace(/"/g, "");
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${escaped}"; filename*=UTF-8''${encoded}`;
}

function sanitizeDownloadFileName(fileName: string, extension: string) {
  const cleaned = fileName
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();

  if (!cleaned) {
    return `youtube-download.${extension}`;
  }

  const hasExtension = cleaned.toLowerCase().endsWith(`.${extension}`);
  return hasExtension ? cleaned : `${cleaned}.${extension}`;
}

function isYouTubeUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return YOUTUBE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function withYtDlpDefaults(args: string[]) {
  const defaults = ["--no-warnings"];
  const cookiesPath = process.env.YTDLP_COOKIES_PATH?.trim();

  if (cookiesPath) {
    defaults.push("--cookies", cookiesPath);
  }

  return [...defaults, ...args];
}

function buildYtDlpErrorMessage(errors: string[]) {
  const joined = errors.join(" ");
  const allMissingBinary = errors.length > 0 && errors.every((e) => e.includes("ENOENT"));

  if (allMissingBinary) {
    return [
      "Nao foi possivel executar yt-dlp.",
      "Instale yt-dlp no host (ou configure YTDLP_PATH) e tente novamente.",
      ...errors,
    ].join(" ");
  }

  if (joined.includes("Sign in to confirm you’re not a bot") || joined.includes("Sign in to confirm you're not a bot")) {
    return [
      "O YouTube bloqueou esta requisicao (anti-bot).",
      "Atualize o yt-dlp e configure cookies com YTDLP_COOKIES_PATH apontando para um arquivo cookies.txt valido.",
      ...errors,
    ].join(" ");
  }

  return ["Falha ao processar com yt-dlp.", ...errors].join(" ");
}
