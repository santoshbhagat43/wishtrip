"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorMessage, unwrap, type Schemas } from "@/lib/api/client";

type Option = Schemas["CoverOption"];

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

const SOURCE: Record<Option["source"], string> = {
  video: "From your video",
  reel_cover: "The reel's cover",
  upload: "Uploaded by you",
};

/** Pick the trip's cover image: a frame from the creator's own video, the reel's cover, or an
 *  image they upload. Used on the itinerary page and in the trip editor. */
export function CoverPicker({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ["cover-options", tripId],
    queryFn: async () =>
      unwrap(await api.GET("/creator/trips/{trip_id}/cover-options", { params: { path: { trip_id: tripId } } })),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["trip", tripId] }),
      queryClient.invalidateQueries({ queryKey: ["creator-links"] }),
      queryClient.invalidateQueries({ queryKey: ["cover-options", tripId] }),
    ]);
    onClose();
  };

  const choose = useMutation({
    mutationFn: async (key: string) =>
      unwrap(
        await api.PATCH("/creator/trips/{trip_id}", {
          params: { path: { trip_id: tripId } },
          body: { cover_image_key: key },
        }),
      ),
    onSuccess: done,
    onError: (e) => setProblem(errorMessage(e)),
  });

  const upload = useMutation({
    mutationFn: async (image: File) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("That image couldn't be read."));
        reader.readAsDataURL(image);
      });
      return unwrap(
        await api.POST("/creator/trips/{trip_id}/cover", {
          params: { path: { trip_id: tripId } },
          body: { filename: image.name, data_base64: data },
        }),
      );
    },
    onSuccess: done,
    onError: (e) => setProblem(errorMessage(e)),
  });

  const busy = choose.isPending || upload.isPending;
  const list = options.data ?? [];
  const video = list.filter((o) => o.source === "video");

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-navy/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a cover image"
        className="flex max-h-[90dvh] w-full max-w-[860px] flex-col overflow-hidden rounded-[28px] bg-surface text-text shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="font-sans! m-0 text-[22px] font-bold tracking-tight">Choose a cover image</h2>
            <p className="m-0 mt-1 text-[13px] text-muted">
              {video.length > 0
                ? "Frames from your video. Pick the one that makes people want to open the trip."
                : "Pick the reel's cover, or upload an image of your own."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 flex-none place-items-center rounded-full border border-border hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {options.isLoading && <p className="m-0 text-sm text-muted">Loading images…</p>}
          {options.isSuccess && video.length === 0 && (
            <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-muted">
              No frames were kept from this video: it was read before we saved them. Upload an image, or paste the
              reel again to get frames to choose from.
            </p>
          )}
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 md:grid-cols-4">
            {list.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (o.current ? onClose() : choose.mutate(o.key))}
                  aria-pressed={o.current}
                  className={`group relative block w-full overflow-hidden rounded-[18px] bg-surface-2 text-left transition ${
                    o.current ? "ring-[3px] ring-brand" : "ring-1 ring-border hover:ring-2 hover:ring-brand"
                  } disabled:opacity-60`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- backend media */}
                  <img src={o.url} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-navy/80 to-transparent px-3 pb-2 pt-6 text-[11.5px] font-semibold text-white">
                    <span>{o.t != null ? `At ${mmss(o.t)}` : SOURCE[o.source]}</span>
                    {o.current && (
                      <span className="grid size-5 place-items-center rounded-full bg-brand text-white">
                        <Check className="size-3" />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2/50 px-6 py-4">
          <span className="text-[13px] text-muted">{problem ?? "JPG, PNG or WebP, up to 4 MB."}</span>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Upload a cover image"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) {
                setProblem(null);
                upload.mutate(picked);
              }
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => file.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60"
          >
            <ImagePlus className="size-4" /> {upload.isPending ? "Uploading…" : "Upload an image"}
          </button>
        </div>
      </div>
    </div>
  );
}
