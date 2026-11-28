import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getUser } from "@/lib/auth";
import { mediaMode } from "@/lib/media";
import { ALLOWED_TYPES, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/media-rules";

// Gives the browser a short-lived permission to upload one file straight to
// file storage. Big videos never pass through this server.
export async function POST(request: Request) {
  if (mediaMode() !== "blob") {
    return Response.json({ error: "File storage is not connected." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getUser();
        if (!user) throw new Error("Please sign in again.");
        if (user.role === "staff") {
          throw new Error("Only an Owner or the System Admin can add photos.");
        }
        // A picture's name says it is one: then only pictures, at their size.
        const picture = /\.(jpe?g|png|webp|gif|avif)$/i.test(pathname);
        return {
          allowedContentTypes: picture ? IMAGE_TYPES : ALLOWED_TYPES,
          maximumSizeInBytes: picture ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
