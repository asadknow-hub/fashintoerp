// What can be uploaded. Shared by the browser and the server.

export const MEDIA_TAGS = [
  "Main photo",
  "Gallery",
  "Size chart",
  "Detail",
  "Model",
  "Inside video",
  "Product video",
  "Packaging",
] as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const ALLOWED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * MB;
export const MAX_VIDEO_BYTES = 100 * MB;

export type MediaKind = "image" | "video";
export type MediaMode = "blob" | "local" | "off";

export function kindOf(contentType: string): MediaKind | null {
  if (IMAGE_TYPES.includes(contentType)) return "image";
  if (VIDEO_TYPES.includes(contentType)) return "video";
  return null;
}

// Returns a reason the file can't be uploaded, or null when it is fine.
export function fileProblem(file: { name: string; type: string; size: number }) {
  const kind = kindOf(file.type);
  if (!kind) return `${file.name}: only photos (JPG, PNG, WebP) and videos (MP4, MOV) work.`;
  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > limit) {
    return `${file.name} is too big. The limit is ${limit / MB} MB for a ${kind === "image" ? "photo" : "video"}.`;
  }
  return null;
}

export function cleanTag(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}
