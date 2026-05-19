import { spawn } from "node:child_process";
import { getClientIp, hitRateLimit, publicErrorMessage } from "@/lib/api-security";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

type YtDlpMetadata = {
  title?: string;
  duration?: number;
  webpage_url?: string;
  thumbnail?: string;
};

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rate = hitRateLimit(`metadata:${ip}`, 20, 60_000);
  if (rate.blocked) {
    return Response.json({ error: "Muitas requisicoes. Tente novamente em alguns instantes." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url")?.trim() ?? "";

  if (!isYouTubeUrl(url)) {
    return Response.json({ error: "URL do YouTube invalida." }, { status: 400 });
  }

  try {
    const metadata = await getVideoMetadata(url);
    return Response.json({
      title: metadata.title ?? "Video sem titulo",
      durationSeconds: Number.isFinite(metadata.duration) ? metadata.duration : 0,
      thumbnail: metadata.thumbnail ?? null,
      url: metadata.webpage_url ?? url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar metadados.";
    console.error("[metadata-route]", message);
    const safeMessage = publicErrorMessage("Falha ao carregar metadados. Tente novamente.") ?? message;
    return Response.json({ error: safeMessage }, { status: 500 });
  }
}

async function getVideoMetadata(url: string) {
  const output = await runYtDlpWithOutput(["--no-playlist", "--dump-single-json", "--skip-download", url]);
  return JSON.parse(output) as YtDlpMetadata;
}

async function runYtDlpWithOutput(args: string[]) {
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
      return await runProcessCapture(candidate.command, candidate.args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.command}: ${message}`);
    }
  }

  throw new Error(
    [
      "Nao foi possivel executar yt-dlp.",
      "Instale yt-dlp no host (ou configure YTDLP_PATH) e tente novamente.",
      ...errors,
    ].join(" ")
  );
}

async function runProcessCapture(command: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr || "Falha ao executar yt-dlp."));
    });
  });
}

function isYouTubeUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return YOUTUBE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
