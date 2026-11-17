import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
export function fixturePng(width, height, channels = 4) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const pixels = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * channels + 1) + 1 + x * channels;
      pixels[offset] = Math.round((x * 255) / Math.max(1, width - 1));
      if (channels > 1) {
        pixels[offset + 1] = Math.round((y * 255) / Math.max(1, height - 1));
        pixels[offset + 2] = 180;
      }
      if (channels === 4)
        pixels[offset + 3] = Math.round(
          ((x + y) * 255) / Math.max(1, width + height - 2),
        );
    }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function writeFixtures(directory) {
  await mkdir(directory, { recursive: true });
  for (const [name, width, height, channels] of [
    ["rgba", 32, 32, 4],
    ["rgb", 32, 32, 3],
    ["gray", 32, 32, 1],
    ["odd", 13, 9, 4],
    ["nonpot", 20, 12, 4],
    ["tiny", 4, 4, 4],
    ["rect", 32, 16, 4],
  ])
    await writeFile(
      `${directory}/${name}.png`,
      fixturePng(width, height, channels),
    );
}
