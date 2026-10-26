export const STAGE_LABEL: Record<string, string> = {
  downloading: "Downloading",
  reading_screen: "Screen + voice",
  finding_places: "Places + trip",
};

export function seconds(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 60) return `${value.toFixed(1)} s`;
  const m = Math.floor(value / 60);
  return `${m} min ${Math.round(value - m * 60)} s`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const STATUS_TONE = { queued: "neutral", running: "info", done: "ok", failed: "danger" } as const;
