import { readFile } from "node:fs/promises";
import { getUser } from "@/lib/auth";
import { isLocalName, localPath, mediaMode } from "@/lib/media";

const types: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

// Development only: serves files saved by the local upload route.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/media/local/[name]">,
) {
  const { name } = await ctx.params;
  if (mediaMode() !== "local" || !isLocalName(name)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });

  try {
    const data = await readFile(localPath(name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": types[name.split(".").pop()!],
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
