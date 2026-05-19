"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type MediaType = "video" | "audio";
type UiState = "idle" | "loading" | "ready" | "error";

type HistoryItem = {
  url: string;
  mediaType: MediaType;
  format: string;
  title: string;
  durationLabel: string;
  downloadedAt: string;
  relativeText: string;
};

type VideoPreview = {
  title: string;
  durationSeconds: number;
  durationLabel: string;
  thumbnail: string | null;
};

const STORAGE_KEY = "yt_downloader_history";

const videoOptions = [
  { value: "bestvideo+bestaudio/best", label: "Melhor qualidade (video + audio)" },
  { value: "best[ext=mp4]", label: "MP4 padrao" },
];

const audioOptions = [
  { value: "bestaudio", label: "Melhor qualidade de audio (MP3)" },
  { value: "bestaudio[ext=m4a]", label: "Audio M4A" },
];

function toDurationLabel(totalSeconds: number) {
  if (!totalSeconds || totalSeconds < 0) {
    return "Duracao indisponivel";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("video");
  const [format, setFormat] = useState(videoOptions[0].value);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [isPreparing, setIsPreparing] = useState(false);
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as HistoryItem[];
    } catch {
      return [];
    }
  });

  const options = useMemo(() => (mediaType === "audio" ? audioOptions : videoOptions), [mediaType]);
  const selectedQualityLabel =
    options.find((option) => option.value === format)?.label ?? "Selecione a qualidade";

  const saveHistory = (items: HistoryItem[]) => {
    setHistory(items);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  };

  const addHistory = (item: HistoryItem) => {
    const next = [item, ...history].slice(0, 20);
    saveHistory(next);
  };

  const clearHistory = () => {
    saveHistory([]);
    window.sessionStorage.removeItem(STORAGE_KEY);
  };

  const isYouTubeUrl = (value: string) => {
    try {
      const parsed = new URL(value);
      return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname);
    } catch {
      return false;
    }
  };

  const onMediaTypeChange = (nextType: MediaType) => {
    setMediaType(nextType);
    setFormat(nextType === "audio" ? audioOptions[0].value : videoOptions[0].value);
    setPreview(null);
    setUiState("idle");
  };

  const fetchPreview = async (targetUrl: string) => {
    const response = await fetch(`/api/metadata?url=${encodeURIComponent(targetUrl)}`);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Nao foi possivel obter metadados.");
    }

    const data = (await response.json()) as {
      title: string;
      durationSeconds: number;
      thumbnail: string | null;
      url: string;
    };

    return {
      title: data.title,
      durationSeconds: data.durationSeconds,
      durationLabel: toDurationLabel(data.durationSeconds),
      thumbnail: data.thumbnail,
    } satisfies VideoPreview;
  };

  const prepareDownload = async () => {
    const finalUrl = url;

    if (!isYouTubeUrl(finalUrl)) {
      setUiState("error");
      toast.error("Informe um link valido do YouTube.");
      return;
    }

    setIsPreparing(true);
    setUiState("loading");

    try {
      const metadata = await fetchPreview(finalUrl);
      setPreview(metadata);
      setUiState("ready");
      toast.success("Preview carregado.");
    } catch (error) {
      setUiState("error");
      const message = error instanceof Error ? error.message : "Falha ao processar link.";
      toast.error(message);
    } finally {
      setIsPreparing(false);
    }
  };

  const startDownload = async (custom?: Partial<HistoryItem>) => {
    const finalUrl = custom?.url ?? url;
    const finalMediaType = custom?.mediaType ?? mediaType;
    const finalFormat = custom?.format ?? format;

    const historyItem: HistoryItem = {
      url: finalUrl,
      mediaType: finalMediaType,
      format: finalMediaType === "audio" ? "MP3" : "MP4",
      title: custom?.title ?? preview?.title ?? "Video sem titulo",
      durationLabel: custom?.durationLabel ?? preview?.durationLabel ?? "Duracao nao informada",
      downloadedAt: new Date().toISOString(),
      relativeText: "Agora",
    };

    addHistory(historyItem);

    const query = new URLSearchParams({
      url: finalUrl,
      mediaType: finalMediaType,
      format: finalFormat,
    });

    window.location.href = `/api/download?${query.toString()}`;
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">YT Media Downloader</h1>
          <p className="text-sm text-slate-600">Baixe video ou audio com rapidez</p>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Preparar download</span>
                {uiState === "loading" && <Badge variant="secondary">Analisando link</Badge>}
                {uiState === "ready" && <Badge className="bg-sky-600">Arquivo pronto</Badge>}
                {uiState === "error" && <Badge variant="destructive">Erro</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600">Link do YouTube</p>
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600">Tipo de midia</p>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                  <Button
                    type="button"
                    className="h-11"
                    variant={mediaType === "video" ? "default" : "ghost"}
                    onClick={() => onMediaTypeChange("video")}
                  >
                    Video
                  </Button>
                  <Button
                    type="button"
                    className="h-11"
                    variant={mediaType === "audio" ? "default" : "ghost"}
                    onClick={() => onMediaTypeChange("audio")}
                  >
                    Audio
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600">Qualidade</p>
                <Select value={format} onValueChange={(value) => value && setFormat(value)}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue>{selectedQualityLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => prepareDownload()}
                className="h-12 w-full bg-sky-600 hover:bg-sky-700"
                disabled={isPreparing}
              >
                {isPreparing ? "Processando..." : "Preparar download"}
              </Button>

              {preview && (
                <div className="space-y-3 rounded-xl border bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-600">Preview</p>
                  <div className="flex items-start gap-3">
                    {preview.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.thumbnail}
                        alt={preview.title}
                        className="h-16 w-28 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="h-16 w-28 rounded-md border bg-slate-200" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{preview.title}</p>
                      <p className="text-xs text-slate-500">Duracao: {preview.durationLabel}</p>
                    </div>
                  </div>
                  <Button onClick={() => startDownload()} className="h-11 w-full bg-sky-700 hover:bg-sky-800">
                    Baixar agora
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Historico da sessao</span>
                <Button variant="ghost" size="sm" onClick={clearHistory}>
                  Limpar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                  Nenhum download ainda. Seus downloads recentes aparecem aqui.
                </div>
              ) : (
                history.map((item, index) => (
                  <article key={`${item.url}-${index}`} className="space-y-2 rounded-xl border bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      <Badge variant="outline">
                        {item.mediaType.toUpperCase()} {item.format}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-slate-500">{item.url}</p>
                    <p className="text-xs text-slate-500">Duracao: {item.durationLabel}</p>
                    <p className="text-xs text-slate-400">{item.relativeText || "Recente"}</p>
                    <Separator />
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        size="sm"
                        className="text-xs bg-sky-600 hover:bg-sky-700"
                        onClick={() =>
                          startDownload({
                            url: item.url,
                            mediaType: item.mediaType,
                            format: item.mediaType === "audio" ? "bestaudio" : "bestvideo+bestaudio/best",
                            title: item.title,
                            durationLabel: item.durationLabel,
                          })
                        }
                      >
                        Rebaixar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(item.url);
                            toast.success("Link copiado.");
                          } catch {
                            toast.error("Nao foi possivel copiar o link.");
                          }
                        }}
                      >
                        Copiar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-red-600"
                        onClick={() => {
                          const next = [...history];
                          next.splice(index, 1);
                          saveHistory(next);
                        }}
                      >
                        Remover
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
