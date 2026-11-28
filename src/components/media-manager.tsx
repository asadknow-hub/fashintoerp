"use client";

import { upload } from "@vercel/blob/client";
import { ImagePlus, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  cleanTag,
  fileProblem,
  kindOf,
  MEDIA_TAGS,
  type MediaKind,
  type MediaMode,
} from "@/lib/media-rules";

export type MediaItem = {
  id: string;
  kind: MediaKind;
  url: string;
  thumbUrl: string | null;
  tag: string;
  fileName: string | null;
};

// A handler returns a message when something went wrong, nothing when it worked.
type Outcome = Promise<string | null | undefined>;

// A file that is still on its way up. It is shown straight away, using the
// copy already on this device, with its progress on top.
type Pending = {
  key: string;
  name: string;
  kind: MediaKind;
  preview: string | null;
  percent: number;
  // Set once the file is stored; the tile then waits for the saved item.
  url?: string;
};

const CUSTOM = "__custom__";
const THUMB_SIZE = 640;

/* ---------- Sending files ---------- */

function sendLocal(file: File, onProgress: (percent: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/media/local");
    request.upload.onprogress = (event) =>
      event.lengthComputable && onProgress((event.loaded / event.total) * 100);
    request.onerror = () => reject(new Error("Upload failed."));
    request.onload = () => {
      let data: { url?: string; error?: string } | null = null;
      try {
        data = JSON.parse(request.responseText);
      } catch {}
      if (request.status < 300 && data?.url) resolve(data.url);
      else reject(new Error(data?.error ?? "Upload failed."));
    };
    request.send(body);
  });
}

// Sends one file to storage and returns its address.
async function storeFile(
  mode: MediaMode,
  folder: string,
  file: File,
  onProgress: (percent: number) => void,
) {
  if (mode !== "blob") return sendLocal(file, onProgress);
  const blob = await upload(`${folder}/${file.name}`, file, {
    access: "public",
    handleUploadUrl: "/api/media/upload",
    contentType: file.type,
    // Big videos are sent in pieces, so a dropped connection can resume.
    multipart: file.size > 8 * 1024 * 1024,
    onUploadProgress: (event) => onProgress(event.percentage),
  });
  return blob.url;
}

/* ---------- Small preview pictures ---------- */

function toJpeg(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

// Makes a small picture of a photo, or of one frame of a video. Returns null
// when it can't (the gallery then falls back to the file itself).
async function makeThumb(file: File, kind: MediaKind): Promise<Blob | null> {
  if (kind === "image") {
    if (file.size < 150 * 1024) return null; // already small enough
    const bitmap = await createImageBitmap(file);
    try {
      return await toJpeg(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  return new Promise((resolve) => {
    const address = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (blob: Blob | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(address);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () =>
      toJpeg(video, video.videoWidth, video.videoHeight).then(finish, () => finish(null));
    video.onerror = () => finish(null);
    video.src = address;
  });
}

/* ---------- Pieces ---------- */

// Pick a ready-made tag or type your own.
function TagSelect({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: string;
  onChange: (tag: string) => void;
  disabled?: boolean;
  label: string;
  className: string;
}) {
  const options = MEDIA_TAGS.includes(value as (typeof MEDIA_TAGS)[number])
    ? MEDIA_TAGS
    : [value, ...MEDIA_TAGS];
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => {
        if (event.target.value !== CUSTOM) return onChange(event.target.value);
        const typed = cleanTag(window.prompt("Name for this tag:") ?? "");
        if (typed) onChange(typed);
      }}
      className={className}
    >
      {options.map((tag) => (
        <option key={tag} value={tag}>
          {tag}
        </option>
      ))}
      <option value={CUSTOM}>Other…</option>
    </select>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-stone-300">
      <span
        className="block h-full rounded-full bg-emerald-600 transition-[width] duration-200"
        style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
      />
    </span>
  );
}

function PlayMark() {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
      <Play className="size-3.5 fill-current" />
    </span>
  );
}

/* ---------- The gallery ---------- */

// The photo and video gallery of a product: a large preview, thumbnails,
// tags, and uploading. Used both when adding a product and when editing one.
export function MediaManager({
  mode,
  offReason,
  folder,
  items,
  onAdd,
  onTag,
  onRemove,
  onBusy,
  readOnly = false,
}: {
  // Only looking: nothing can be added, retagged or deleted.
  readOnly?: boolean;
  mode: MediaMode;
  offReason?: string | null;
  folder: string;
  items: MediaItem[];
  onAdd: (item: Omit<MediaItem, "id">) => Outcome;
  onTag: (id: string, tag: string) => Outcome;
  onRemove: (id: string) => Outcome;
  onBusy?: (busy: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const made = useRef<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  // Stored address → the copy already on this device, so a file that was just
  // uploaded shows instantly instead of being downloaded again.
  const [local, setLocal] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [working, startTransition] = useTransition();

  // Free the device copies when leaving the page.
  useEffect(() => {
    const addresses = made.current;
    return () => addresses.forEach((address) => URL.revokeObjectURL(address));
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomed]);

  const objectUrl = (blob: Blob) => {
    const address = URL.createObjectURL(blob);
    made.current.push(address);
    return address;
  };

  // Once a stored file shows up as a saved item, its upload tile is finished
  // for good (so deleting that item later doesn't bring the tile back).
  const arrived = pending.filter(
    (entry) => entry.url && items.some((item) => item.url === entry.url),
  );
  if (arrived.length) {
    setPending((current) => current.filter((entry) => !arrived.includes(entry)));
  }
  // Files still uploading, plus stored ones whose saved item hasn't shown up yet.
  const waiting = pending.filter((entry) => !arrived.includes(entry));
  const selected =
    items.find((item) => item.id === selectedId) ??
    items.find((item) => item.tag === "Main photo") ??
    items[0];
  const thumbOf = (item: MediaItem) =>
    local[item.url] ?? item.thumbUrl ?? (item.kind === "image" ? item.url : null);

  const patch = (key: string, change: Partial<Pending>) =>
    setPending((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    );

  const uploadAll = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    const problems: string[] = [];
    const accepted: { file: File; kind: MediaKind; key: string }[] = [];
    for (const file of files) {
      const problem = fileProblem(file);
      if (problem) problems.push(problem);
      else accepted.push({ file, kind: kindOf(file.type)!, key: crypto.randomUUID() });
    }
    setError(problems.length ? problems.join(" ") : null);
    if (picker.current) picker.current.value = "";
    if (accepted.length === 0) return;

    // Show every file immediately.
    setPending((current) => [
      ...current.filter((entry) => !entry.url),
      ...accepted.map(({ file, kind, key }) => ({
        key,
        name: file.name,
        kind,
        preview: kind === "image" ? objectUrl(file) : null,
        percent: 0,
      })),
    ]);
    setUploading(true);
    onBusy?.(true);

    // The first photo of a product becomes its main photo; the rest go to the
    // gallery. Tags are changed afterwards on the photo itself.
    let nextTag = items.some((item) => item.tag === "Main photo") ? "Gallery" : "Main photo";
    for (const { file, kind, key } of accepted) {
      try {
        const small = await makeThumb(file, kind).catch(() => null);
        const smallAddress = small ? objectUrl(small) : null;
        if (kind === "video" && smallAddress) patch(key, { preview: smallAddress });

        const base = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "file";
        const thumbUrl = small
          ? await storeFile(
              mode,
              folder,
              new File([small], `thumb-${base}.jpg`, { type: "image/jpeg" }),
              () => {},
            ).catch(() => null)
          : null;
        const url = await storeFile(mode, folder, file, (percent) => patch(key, { percent }));

        const device = kind === "image" ? objectUrl(file) : smallAddress;
        if (device) setLocal((current) => ({ ...current, [url]: device }));
        patch(key, { percent: 100, url });

        const failed = await onAdd({ url, thumbUrl, kind, tag: nextTag, fileName: file.name });
        if (failed) {
          problems.push(`${file.name}: ${failed}`);
          setPending((current) => current.filter((entry) => entry.key !== key));
        } else if (nextTag === "Main photo") {
          // Only one file can be the main photo; the rest go to the gallery.
          nextTag = "Gallery";
        }
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
        setPending((current) => current.filter((entry) => entry.key !== key));
      }
    }
    setError(problems.length ? problems.join(" ") : null);
    setUploading(false);
    onBusy?.(false);
  };

  const act = (work: () => Outcome) =>
    startTransition(async () => {
      setError((await work()) ?? null);
    });

  const active = waiting.filter((entry) => !entry.url);
  const overall = active.length
    ? active.reduce((sum, entry) => sum + entry.percent, 0) / active.length
    : 100;
  const lead = waiting[0];
  const off = mode === "off" || readOnly;
  const dropHere = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      if (!off) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (!off) uploadAll([...event.dataTransfer.files]);
    },
  };

  return (
    <div data-gallery>
      <input
        ref={picker}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(event) => uploadAll([...(event.target.files ?? [])])}
      />
      <div className="flex gap-2">
        {/* The large preview. Files can be dropped onto it. */}
        <div
          data-gallery-viewer
          {...dropHere}
          className={
            "group relative aspect-[5/4] min-w-0 flex-1 overflow-hidden rounded-xl border bg-stone-100 bg-contain bg-center bg-no-repeat " +
            (dragging ? "border-brand ring-2 ring-brand-200" : "border-stone-200")
          }
          // The small picture shows at once; the full one loads over it.
          style={
            selected && (selected.thumbUrl || local[selected.url])
              ? { backgroundImage: `url("${local[selected.url] ?? selected.thumbUrl}")` }
              : undefined
          }
        >
          {selected ? (
            <>
              {selected.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => setZoomed(true)}
                  aria-label="View larger"
                  className="block size-full cursor-zoom-in"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={selected.url}
                    src={local[selected.url] ?? selected.url}
                    alt={selected.tag}
                    decoding="async"
                    className="size-full object-contain"
                  />
                </button>
              ) : (
                <video
                  key={selected.url}
                  src={selected.url}
                  poster={thumbOf(selected) ?? undefined}
                  controls
                  playsInline
                  preload="none"
                  className="size-full bg-black object-contain"
                />
              )}
              <div className="absolute top-2 left-2">
                <TagSelect
                  label="Tag"
                  value={selected.tag}
                  disabled={working || readOnly}
                  onChange={(next) => act(() => onTag(selected.id, next))}
                  className="max-w-36 cursor-pointer appearance-none rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white outline-none hover:bg-black/85"
                />
              </div>
              <button
                type="button"
                hidden={readOnly}
                disabled={working || readOnly}
                aria-label="Delete this file"
                title="Delete this file"
                onClick={() => {
                  if (window.confirm("Delete this file?")) act(() => onRemove(selected.id));
                }}
                className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/90 text-stone-700 opacity-0 shadow transition group-hover:opacity-100 hover:bg-rose-600 hover:text-white focus:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          ) : lead ? (
            lead.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.preview} alt="" className="size-full object-contain opacity-60" />
            ) : (
              <div className="size-full bg-stone-800" />
            )
          ) : off ? (
            <p className="flex size-full items-center justify-center p-4 text-center text-xs text-amber-900">
              {readOnly
                ? "No photos yet."
                : (offReason ?? "File storage isn't connected yet, so uploads are switched off.")}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="flex size-full cursor-pointer flex-col items-center justify-center gap-1.5 text-stone-500 hover:text-brand"
            >
              <ImagePlus className="size-7" strokeWidth={1.6} />
              <span className="text-sm font-semibold">Add photos or videos</span>
              <span className="text-[11px]">or drop them here</span>
            </button>
          )}
        </div>

        {/* Thumbnails down the side, with "+" to add more. */}
        <div className="flex w-11 shrink-0 flex-col gap-1.5">
          <ul
            data-gallery-thumbs
            className="flex min-h-0 flex-col gap-1.5 overflow-y-auto empty:hidden"
          >
            {items.map((item) => {
              const picture = thumbOf(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    title={item.fileName ? `${item.tag} — ${item.fileName}` : item.tag}
                    aria-label={`Show ${item.tag}`}
                    aria-pressed={item.id === selected?.id}
                    onClick={() => setSelectedId(item.id)}
                    className={
                      "relative block aspect-square w-full cursor-pointer overflow-hidden rounded-lg border-2 bg-stone-800 " +
                      (item.id === selected?.id
                        ? "border-brand"
                        : "border-transparent hover:border-stone-300")
                    }
                  >
                    {picture && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={picture}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    )}
                    {item.kind === "video" && <PlayMark />}
                  </button>
                </li>
              );
            })}
            {waiting.map((entry) => (
              <li key={entry.key} data-uploading>
                <div
                  title={entry.name}
                  className="relative aspect-square w-full overflow-hidden rounded-lg bg-stone-800"
                >
                  {entry.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.preview} alt="" className="size-full object-cover opacity-50" />
                  )}
                  <span className="absolute inset-x-0.5 bottom-0.5 space-y-0.5 text-center text-[9px] font-bold text-white">
                    {entry.url ? "…" : `${Math.round(entry.percent)}%`}
                    <Bar percent={entry.percent} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {!off && (
            <button
              type="button"
              disabled={uploading}
              aria-label="Add photos or videos"
              title="Add photos or videos"
              onClick={() => picker.current?.click()}
              className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-stone-500 hover:border-brand hover:text-brand disabled:opacity-50"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <div role="status" className="mt-2 space-y-1 text-xs text-stone-700">
          <p>
            Uploading {active.length} {active.length === 1 ? "file" : "files"} ·{" "}
            {Math.round(overall)}%
          </p>
          <Bar percent={overall} />
        </div>
      )}
      {off && !readOnly && items.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          {offReason ?? "File storage isn't connected yet, so uploads are switched off."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      {zoomed && selected?.kind === "image" && (
        <div
          role="dialog"
          aria-label={selected.tag}
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={local[selected.url] ?? selected.url}
            alt={selected.tag}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            aria-label="Close"
            className="absolute top-4 right-4 size-9 cursor-pointer rounded-full bg-white text-lg text-stone-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
