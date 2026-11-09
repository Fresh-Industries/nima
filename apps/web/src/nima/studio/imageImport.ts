import { randomUUID } from "../../lib/utils";
export async function studioImage(file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type))
    throw new Error("Choose a PNG or JPEG image.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MiB.");
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  if (width > 8192 || height > 8192 || width * height > 16_000_000) {
    bitmap.close();
    throw new Error("Images support up to 8192 pixels per side and 16 megapixels.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image decoding is unavailable in this browser.");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = canvas.toDataURL("image/png").split(",")[1]!;
  if (data.length > (8 * 1024 * 1024 * 4) / 3)
    throw new Error("The decoded image is too large. Reduce its size before importing.");
  return { id: randomUUID(), width, height, png_base64: data };
}
