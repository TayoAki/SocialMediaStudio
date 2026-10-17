import { createHash } from "node:crypto";
import { AppError } from "@/src/domain/errors";

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;

export interface InspectedImage { mime: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; bytes: number; checksum: string }

/**
 * Inspect actual bytes (FR17, AT18). The declared MIME type and filename are ignored;
 * only JPEG/PNG/WebP signatures are accepted, so SVG/HTML can never pass as an image.
 */
export function inspectImage(buf: Buffer): InspectedImage {
  if (buf.length === 0) throw new AppError("INVALID_INPUT", "Empty file");
  if (buf.length > MAX_BYTES) throw new AppError("INVALID_INPUT", "Image exceeds 20MB");
  let mime: InspectedImage["mime"]; let width = 0; let height = 0;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mime = "image/png"; width = buf.readUInt32BE(16); height = buf.readUInt32BE(20);
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    mime = "image/jpeg";
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); break;
      }
      i += 2 + len;
    }
  } else if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    mime = "image/webp";
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") { width = 1 + buf.readUIntLE(24, 3); height = 1 + buf.readUIntLE(27, 3); }
    else if (chunk === "VP8 ") { width = buf.readUInt16LE(26) & 0x3fff; height = buf.readUInt16LE(28) & 0x3fff; }
    else if (chunk === "VP8L") { const b = buf.readUInt32LE(21); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
  } else {
    throw new AppError("INVALID_INPUT", "Only JPEG, PNG or WebP images are accepted");
  }
  if (!width || !height) throw new AppError("INVALID_INPUT", "Could not read image dimensions");
  if (width * height > MAX_PIXELS) throw new AppError("INVALID_INPUT", "Image exceeds 40 megapixels");
  return { mime, width, height, bytes: buf.length, checksum: createHash("sha256").update(buf).digest("hex") };
}
