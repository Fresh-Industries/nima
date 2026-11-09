import type { EnvironmentId } from "@t3tools/contracts";
import {
  startAttachmentUpload,
  awaitAttachmentUploads,
  readAttachmentUpload,
  releaseAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { randomUUID } from "../../lib/utils";
export async function uploadStudioMedia(environmentId: EnvironmentId, file: File) {
  const id = randomUUID();
  startAttachmentUpload({
    environmentId,
    image: {
      id,
      type: "file",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      file,
    },
  });
  await awaitAttachmentUploads([id]);
  const result = readAttachmentUpload(id);
  if (result?.status !== "ready" || result.environmentId !== environmentId) {
    releaseAttachmentUpload(id);
    throw new Error("The media upload failed. Check the connection and try again.");
  }
  return { attachmentId: result.attachmentId, release: () => releaseAttachmentUpload(id) };
}
