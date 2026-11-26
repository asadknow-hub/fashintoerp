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
  tag: string;
  fileName: string | null;
};

// A handler returns a message when something went wrong, nothing when it worked.
type Outcome = Promise<string | null | undefined>;

const CUSTOM = "__custom__";

// Sends one file to storage and returns its address.
async function storeFile(
  mode: MediaMode,
  folder: string,
  file: File,
  onProgress: (percent: number) => void,
) {
  if (mode === "blob") {
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
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/media/local", { method: "POST", body });
  const data = (await response.json().catch(() => null)) as {
    url?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? "Upload failed.");
  return data.url;
}

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
      className="w-full min-w-0 cursor-pointer rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 outline-none focus:border-stone-900"
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [tag, setTag] = useState<string>(items.length ? "Gallery" : "Main photo");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [working, startTransition] = useTransition();

  const selected =
    items.find((item) => item.id === selectedId) ??
    items.find((item) => item.tag === "Main photo") ??
    items[0];

  useEffect(() => {
    if (!zoomed) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomed]);

  const uploadAll = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    onBusy?.(true);
    const problems: string[] = [];
    let nextTag = tag;
    for (const [index, file] of files.entries()) {
      const problem = fileProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const label = files.length > 1 ? `${index + 1} of ${files.length}` : file.name;
      try {
        setProgress(`Uploading ${label}…`);
        const url = await storeFile(mode, folder, file, (percent) =>
          setProgress(`Uploading ${label}… ${Math.round(percent)}%`),
        );
        const failed = await onAdd({
          url,
          kind: kindOf(file.type)!,
          tag: nextTag,
          fileName: file.name,
        });
        if (failed) problems.push(`${file.name}: ${failed}`);
        // Only one file can be the main photo; the rest go to the gallery.
        else if (nextTag === "Main photo") nextTag = "Gallery";
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
      }
    }
    setTag(nextTag);
    setProgress(null);
    setError(problems.length ? problems.join(" ") : null);
    onBusy?.(false);
    if (picker.current) picker.current.value = "";
  };

  const act = (work: () => Outcome) =>
    startTransition(async () => {
      setError((await work()) ?? null);
    });

  const off = mode === "off";

  return (
    <Block
      title="Photos & videos"
      aside={
        <span className="text-xs text-stone-500">
          {items.length ? `${items.length} ${items.length === 1 ? "file" : "files"}` : "None yet"}
        </span>
      }
    >
      <div className="space-y-3">
        {selected && (
          <div data-gallery-viewer>
            <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
              {selected.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => setZoomed(true)}
                  aria-label="View larger"
                  className="block w-full cursor-zoom-in"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.url}
                    alt={selected.tag}
                    className="mx-auto aspect-[4/3] w-full object-contain"
                  />
                </button>
              ) : (
                <video
                  key={selected.url}
                  src={selected.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto aspect-[4/3] w-full bg-black object-contain"
                />
              )}
              <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                {selected.tag}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
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
        )}

        {items.length > 1 && (
          <ul className="grid grid-cols-5 gap-1.5" data-gallery-thumbs>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  title={item.fileName ? `${item.tag} — ${item.fileName}` : item.tag}
                  aria-label={`Show ${item.tag}`}
                  aria-pressed={item.id === selected?.id}
                  onClick={() => setSelectedId(item.id)}
                  className={
                    "relative block aspect-square w-full cursor-pointer overflow-hidden rounded-md border bg-stone-100 " +
                    (item.id === selected?.id
                      ? "border-stone-900 ring-1 ring-stone-900"
                      : "border-stone-200 hover:border-stone-400")
                  }
                >
                  {item.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <>
                      <video src={item.url} preload="metadata" muted className="size-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-white">
                        ▶
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {off ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
              if (!progress) uploadAll([...event.dataTransfer.files]);
            }}
            className={
              "rounded-lg border border-dashed p-3 " +
              (dragging ? "border-stone-900 bg-stone-100" : "border-stone-300 bg-stone-50")
            }
          >
            {items.length === 0 && (
              <p className="mb-2 text-center text-sm text-stone-600">
                Drop photos or videos here, or use the button.
              </p>
            )}
            <div className="flex items-end gap-2">
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
                disabled={progress !== null}
                onClick={() => picker.current?.click()}
                className="btn btn-sm"
              >
                {progress ? "Uploading…" : "Upload"}
              </button>
            </div>
            {progress && (
              <p role="status" className="mt-2 text-xs text-stone-600">
                {progress}
              </p>
            )}
            <p className="mt-2 text-[11px] text-stone-500">
              Photos up to 10 MB, videos up to 100 MB. “Main photo” is the one
              shown in the product list.
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
            src={selected.url}
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
    </Block>
  );
}
