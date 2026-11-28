"use client";

import { MediaManager, type MediaItem } from "@/components/media-manager";
import type { MediaMode } from "@/lib/media-rules";
import { addMedia, deleteMedia, setMediaTag } from "../actions";

// The gallery of a saved product: every change is stored straight away.
export function MediaBlock({
  productId,
  items,
  mode,
  offReason,
  readOnly = false,
}: {
  readOnly?: boolean;
  productId: string;
  items: MediaItem[];
  mode: MediaMode;
  offReason: string | null;
}) {
  return (
    <MediaManager
      mode={mode}
      offReason={offReason}
      readOnly={readOnly}
      folder={`products/${productId}`}
      items={items}
      onAdd={async (item) => (await addMedia({ productId, ...item }))?.error}
      onTag={async (id, tag) => (await setMediaTag(id, tag))?.error}
      onRemove={async (id) => (await deleteMedia(id))?.error}
    />
  );
}
