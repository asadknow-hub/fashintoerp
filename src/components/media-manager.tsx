"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Block } from "@/components/ui";
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
}: {
  value: string;
  onChange: (tag: string) => void;
  disabled?: boolean;
  label: string;
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
      className="w-full min-w-0 cursor-pointer rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 outline-none focus:border-stone-900"
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
    <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-sm text-white">
      ▶
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
}: {
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
  const [tag, setTag] = useState<string>(items.length ? "Gallery" : "Main photo");
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

    let nextTag = tag;
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
    setTag(nextTag);
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
  const total = items.length + waiting.length;
  const lead = waiting[0];

  return (
    <Block
      title="Photos & videos"
      aside={
        <span className="text-xs text-stone-500">
          {total ? `${total} ${total === 1 ? "file" : "files"}` : "None yet"}
        </span>
      }
    >
      <div className="space-y-2">
        {selected ? (
          <div data-gallery-viewer>
            <div
              className="relative overflow-hidden rounded-md border border-stone-300 bg-stone-100 bg-contain bg-center bg-no-repeat"
              // The small picture shows at once; the full one loads over it.
              style={
                selected.thumbUrl || local[selected.url]
                  ? { backgroundImage: `url("${local[selected.url] ?? selected.thumbUrl}")` }
                  : undefined
              }
            >
              {selected.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => setZoomed(true)}
                  aria-label="View larger"
                  className="block w-full cursor-zoom-in"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={selected.url}
                    src={local[selected.url] ?? selected.url}
                    alt={selected.tag}
                    decoding="async"
                    className="mx-auto aspect-[4/3] w-full object-contain"
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
                  className="mx-auto aspect-[4/3] w-full bg-black object-contain"
                />
              )}
              <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {selected.tag}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-xs text-stone-500">Tag</span>
              <div className="min-w-0 flex-1">
                <TagSelect
                  label="Tag"
                  value={selected.tag}
                  disabled={working}
                  onChange={(next) => act(() => onTag(selected.id, next))}
                />
              </div>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  if (window.confirm("Delete this file?")) act(() => onRemove(selected.id));
                }}
                className="btn-secondary btn-sm text-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          lead && (
            <div className="relative overflow-hidden rounded-md border border-stone-300 bg-stone-100">
              {lead.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lead.preview}
                  alt=""
                  className="mx-auto aspect-[4/3] w-full object-contain opacity-60"
                />
              ) : (
                <div className="aspect-[4/3] w-full bg-stone-800" />
              )}
            </div>
          )
        )}

        {(items.length > 1 || waiting.length > 0) && (
          <ul className="grid grid-cols-5 gap-1" data-gallery-thumbs>
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
                      "relative block aspect-square w-full cursor-pointer overflow-hidden rounded border bg-stone-800 " +
                      (item.id === selected?.id
                        ? "border-stone-900 ring-1 ring-stone-900"
                        : "border-stone-300 hover:border-stone-500")
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
                  className="relative aspect-square w-full overflow-hidden rounded border border-stone-300 bg-stone-800"
                >
                  {entry.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.preview} alt="" className="size-full object-cover opacity-50" />
                  )}
                  <span className="absolute inset-x-1 bottom-1 space-y-0.5 text-center text-[10px] font-semibold text-white">
                    {entry.url ? "Saving…" : `${Math.round(entry.percent)}%`}
                    <Bar percent={entry.percent} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {active.length > 0 && (
          <div role="status" className="space-y-1 text-xs text-stone-700">
            <p>
              Uploading {active.length} {active.length === 1 ? "file" : "files"} ·{" "}
              {Math.round(overall)}%
            </p>
            <Bar percent={overall} />
          </div>
        )}

        {mode === "off" ? (
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            {offReason ?? "File storage isn't connected yet, so uploads are switched off."}
          </p>
        ) : (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              uploadAll([...event.dataTransfer.files]);
            }}
            className={
              "rounded-md border border-dashed p-2 " +
              (dragging ? "border-stone-900 bg-stone-100" : "border-stone-400 bg-stone-50")
            }
          >
            <div className="flex items-end gap-1.5">
              <label className="min-w-0 flex-1">
                <span className="label">Tag for new files</span>
                <TagSelect label="Tag for new files" value={tag} onChange={setTag} />
              </label>
              <input
                ref={picker}
                type="file"
                multiple
                accept="image/*,video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(event) => uploadAll([...(event.target.files ?? [])])}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => picker.current?.click()}
                className="btn btn-sm"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-stone-500">
              Or drop files here. Photos up to 10 MB, videos up to 100 MB. “Main
              photo” is the one shown in the product list.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-rose-700">
            {error}
          </p>
        )}
      </div>

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
            className="max-h-full max-w-full rounded object-contain"
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
    </Block>
  );
}
