import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { del } from "@vercel/blob";
import type { MediaMode } from "./media-rules";

const LOCAL_PREFIX = "/api/media/local/";

// Where uploaded files go:
// - "blob": Vercel Blob, used on the live site.
// - "local": a folder on this computer, for development only.
// - "off": storage has not been connected yet.
export function mediaMode(): MediaMode {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.MEDIA_LOCAL_DIR) return "local";
  return "off";
}

// A plain-words reason uploads are switched off, or null when they work.
export function mediaOffReason() {
  if (mediaMode() !== "off") return null;
  if (process.env.BLOB_STORE_ID) {
    return "The Blob store is connected, but without its read-write token, so uploads are switched off. In Vercel, connect the store again with “Add a read-write token” ticked, then redeploy.";
  }
  return "File storage isn't connected yet, so uploads are switched off. In Vercel open Storage, create a public Blob store, connect it to this project, then redeploy.";
}

export function localDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_LOCAL_DIR ?? ".uploads");
}

// Full path of a locally stored upload. The folder is outside the app, so the
// build tool is told not to follow it.
export function localPath(name: string) {
  return path.join(/*turbopackIgnore: true*/ localDir(), name);
}

// File names we create ourselves: a random id plus a known extension.
export function isLocalName(name: string) {
  return /^[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|mov|webm)$/.test(name);
}

// Only accept addresses that point at our own storage, so nobody can attach
// a link to somewhere else.
export function isOurUrl(url: string) {
  const mode = mediaMode();
  if (mode === "local") {
    return url.startsWith(LOCAL_PREFIX) && isLocalName(url.slice(LOCAL_PREFIX.length));
  }
  if (mode === "blob") {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" &&
        parsed.hostname.endsWith(".public.blob.vercel-storage.com")
      );
    } catch {
      return false;
    }
  }
  return false;
}

// Best effort: the photo is already gone from the product, so a failure here
// only leaves an unused file behind.
export async function removeFile(url: string) {
  try {
    if (url.startsWith(LOCAL_PREFIX)) {
      const name = url.slice(LOCAL_PREFIX.length);
      if (isLocalName(name)) await unlink(localPath(name));
    } else if (mediaMode() === "blob") {
      await del(url);
    }
  } catch (err) {
    console.error("Could not remove file", url, err);
  }
}
