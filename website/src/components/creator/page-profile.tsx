"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api/client";
import { WEBSITE_URL } from "@/lib/creator";

type Overview = Schemas["CreatorOverview"];
type Photo = "avatar" | "cover";

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("That image couldn't be read."));
    reader.readAsDataURL(file);
  });

const MAX_BYTES = 4 * 1024 * 1024;
// The smallest pictures the page looks good with (the server checks the same).
const MIN_SIZE: Record<Photo, [number, number]> = { cover: [1200, 400], avatar: [200, 200] };
const WHAT: Record<Photo, string> = { cover: "cover photo", avatar: "profile photo" };

const imageSize = (file: File) =>
  new Promise<[number, number]>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve([img.naturalWidth, img.naturalHeight]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be read."));
    };
    img.src = url;
  });

/** Say what is wrong with a picture before it is uploaded, or null when it is fine. */
async function photoProblem(photo: Photo, file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return `Your ${WHAT[photo]} is ${(file.size / 1048576).toFixed(1)} MB. Use one under 4 MB.`;
  try {
    const [w, h] = await imageSize(file);
    const [minW, minH] = MIN_SIZE[photo];
    if (w < minW || h < minH) return `Your ${WHAT[photo]} is ${w}×${h}px. Use one at least ${minW}×${minH}px.`;
  } catch (e) {
    return e instanceof Error ? e.message : "That image couldn't be read.";
  }
  return null;
}

/** "Your page": the profile photo, cover photo and name travellers see on the creator's public
 *  page (/creator/<handle>) and on the Creator trips page. */
export function PageProfile({ overview: o }: { overview: Overview }) {
  const queryClient = useQueryClient();
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(o.display_name);
  const [saved, setSaved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // The dashboard's numbers and the header's avatar and name both show these.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["creator-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["creator-me"] }),
    ]);

  const upload = useMutation({
    mutationFn: async ({ photo, file }: { photo: Photo; file: File }) =>
      unwrap(
        await api.POST(photo === "avatar" ? "/creators/me/avatar" : "/creators/me/cover", {
          body: { filename: file.name, data_base64: await readAsBase64(file) },
        }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (photo: Photo) =>
      unwrap(await api.DELETE(photo === "avatar" ? "/creators/me/avatar" : "/creators/me/cover")),
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: async () => unwrap(await api.PATCH("/creators/me", { body: { display_name: name } })),
    onSuccess: async () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await refresh();
    },
  });

  const busy = upload.isPending || remove.isPending;
  const problem = upload.error ?? remove.error ?? rename.error;
  const clean = name.trim().replace(/\s+/g, " ");
  const changed = clean !== o.display_name && clean.length >= 2;
  const pick = (photo: Photo) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bad = await photoProblem(photo, file);
    setPhotoError(bad);
    if (!bad) upload.mutate({ photo, file });
  };
  const pageUrl = o.handle ? `${WEBSITE_URL}/creator/${o.handle}` : null;

  return (
    <Card>
      <CardHeader
        title="Your page"
        description="The photos and name travellers see on your page and on Creator trips."
        action={
          pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm font-semibold hover:bg-surface-2"
            >
              View your page <ExternalLink className="size-3.5" />
            </a>
          )
        }
      />
      <div className="flex flex-col gap-5 px-5 pb-5 pt-4">
        <div className="relative">
          <div className="relative h-[150px] overflow-hidden rounded-[20px] bg-gradient-to-br from-[#072338] to-brand md:h-[190px]">
            {o.cover_url && (
              // eslint-disable-next-line @next/next/no-img-element -- backend media
              <img src={o.cover_url} alt="Your cover photo" className="absolute inset-0 size-full object-cover" />
            )}
            <span className="absolute right-3 top-3 flex gap-2">
              <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload a cover photo" className="sr-only" onChange={pick("cover")} />
              <button
                type="button"
                disabled={busy}
                onClick={() => coverInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[13px] font-semibold text-black shadow disabled:opacity-60"
              >
                <ImagePlus className="size-4" /> {o.cover_url ? "Change cover photo" : "Add a cover photo"}
              </button>
              {o.cover_url && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove.mutate("cover")}
                  aria-label="Remove cover photo"
                  className="grid size-9 place-items-center rounded-full bg-white text-black shadow disabled:opacity-60"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </span>
          </div>

          <div className="absolute -bottom-10 left-5 flex items-end gap-3">
            <span className="relative size-[92px] overflow-hidden rounded-full border-4 border-surface bg-gradient-to-br from-brand to-[#072338] shadow-md">
              {o.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- backend media
                <img src={o.avatar_url} alt="Your profile photo" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center font-display text-[38px] italic text-white" aria-hidden>
                  {(o.display_name || "W").trim().charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <span className="mb-1.5 flex gap-2">
              <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload a profile photo" className="sr-only" onChange={pick("avatar")} />
              <button
                type="button"
                disabled={busy}
                onClick={() => avatarInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-semibold hover:bg-surface-2 disabled:opacity-60"
              >
                <Camera className="size-4" /> {o.avatar_url ? "Change profile photo" : "Add a profile photo"}
              </button>
              {o.avatar_url && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove.mutate("avatar")}
                  className="rounded-full px-3 py-2 text-[13px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        </div>

        <form
          className="mt-11 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed) rename.mutate();
          }}
        >
          <label htmlFor="creator-name" className="text-[13px] font-semibold">
            Name on your page
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="creator-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="min-w-[220px] flex-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[14.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="submit"
              disabled={!changed || rename.isPending}
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
            >
              {rename.isPending ? "Saving…" : saved ? "Saved" : "Save name"}
            </button>
          </div>
          <p className="m-0 text-xs text-muted">
            {o.handle
              ? `Your page address is ${WEBSITE_URL.replace(/^https?:\/\//, "")}/creator/${o.handle}. The WishTrip team sets it.`
              : "Your page address is set by the WishTrip team when they approve your account."}{" "}
            Your page shows once you have a published trip. Photos: JPG, PNG or WebP, up to 4 MB. Cover photo at least 1200×400px, profile photo at least 200×200px.
          </p>
          {(photoError || problem) && (
            <p data-testid="photo-problem" className="m-0 text-[13px] text-danger">
              {photoError ?? errorMessage(problem)}
            </p>
          )}
        </form>
      </div>
    </Card>
  );
}
