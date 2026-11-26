import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { getUser } from "@/lib/auth";
import { localDir, localPath, mediaMode } from "@/lib/media";
import { fileProblem } from "@/lib/media-rules";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

// Development only: saves uploads to a folder on this computer.
// The live site uploads to Vercel Blob instead (see ../upload).
export async function POST(request: Request) {
  if (mediaMode() !== "local") return new Response("Not found", { status: 404 });
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was sent." }, { status: 400 });
  }
  const problem = fileProblem(file);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const name = `${randomUUID()}.${extensions[file.type]}`;
  await mkdir(localDir(), { recursive: true });
  await writeFile(localPath(name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ url: `/api/media/local/${name}` });
}
