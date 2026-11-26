"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState, useTransition } from "react";
import { Block } from "@/components/ui";
import {
  cleanTag,
  fileProblem,
  kindOf,
  MEDIA_TAGS,
  type MediaMode,
} from "@/lib/media-rules";
import { addMedia, deleteMedia, setMediaTag } from "../actions";

export type MediaItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  tag: string;
  fileName: string | null;
};

const CUSTOM = "__custom__";

async function store(mode: MediaMode, productId: string, file: File, onProgress: (p: number) => void) {
  if (mode === "blob") {
    const blob = await upload(`products/${productId}/${file.name}`, file, {
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
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? "Upload failed.");
  return data.url;
}

// Lets the person pick a ready-made tag or type their own.
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
      className="w-full cursor-pointer rounded-md border border-stone-300 bg-white px-1 py-1 text-[11px] text-stone-800 outline-none focus:border-stone-900"
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

export function MediaBlock({
  productId,
  items,
  mode,
}: {
  productId: string;
  items: MediaItem[];
  mode: MediaMode;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<string>("Gallery");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const uploadAll = async (files: File[]) => {
    setError(null);
    const problems: string[] = [];
    for (const [index, file] of files.entries()) {
      const problem = fileProblem(file);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const label = files.length > 1 ? `${index + 1} of ${files.length}` : file.name;
      try {
        setProgress(`Uploading ${label}…`);
        const url = await store(mode, productId, file, (percent) =>
          setProgress(`Uploading ${label}… ${Math.round(percent)}%`),
        );
        const result = await addMedia({
          productId,
          url,
          kind: kindOf(file.type)!,
          tag,
          fileName: file.name,
        });
        if (result?.error) problems.push(`${file.name}: ${result.error}`);
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
      }
    }
    setProgress(null);
    setError(problems.length ? problems.join(" ") : null);
    if (picker.current) picker.current.value = "";
  };

  const act = (work: () => Promise<{ error?: string } | null>) =>
    startTransition(async () => {
      const result = await work();
      setError(result?.error ?? null);
    });

  return (
    <Block
      title="Photos & videos"
      aside={<span className="text-xs text-stone-500">{items.length || "None yet"}</span>}
    >
      {mode === "off" ? (
        <p className="text-sm text-stone-600">
          File storage isn&apos;t connected yet, so uploads are switched off. In
          Vercel open <b>Storage</b>, create a <b>Blob</b> store, connect it to this
          project, then redeploy.
        </p>
      ) : (
        <div className="space-y-3">
          {items.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {items.map((item) => (
                <li key={item.id} className="min-w-0">
                  <div className="group relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
                    <a href={item.url} target="_blank" rel="noreferrer" title={item.fileName ?? item.tag}>
                      {item.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt={item.tag}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <>
                          <video
                            src={item.url}
                            preload="metadata"
                            muted
                            playsInline
                            className="size-full object-cover"
                          />
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            ▶ Video
                          </span>
                        </>
                      )}
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${item.tag}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this file?")) act(() => deleteMedia(item.id));
                      }}
                      className="absolute top-1 right-1 size-6 cursor-pointer rounded-full bg-white/90 text-sm leading-none text-stone-700 shadow hover:bg-rose-600 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-1">
                    <TagSelect
                      label="Tag"
                      value={item.tag}
                      disabled={busy}
                      onChange={(next) => act(() => setMediaTag(item.id, next))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-2.5">
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
            <p role="status" className="text-xs text-stone-600">
              {progress}
            </p>
          )}
          <p className="text-xs text-stone-500">
            Photos up to 10 MB, videos up to 100 MB. The one tagged “Main photo”
            is shown in the product list.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}
    </Block>
  );
}
