import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const asset = (name) => new URL(`../public/${name}`, import.meta.url);
const source = await readFile(asset("tuxu.svg"));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
  directory[entry + 1] = directory[entry];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(asset("tuxu.ico"), Buffer.concat([directory, ...images]));
await writeFile(asset("tuxu.png"), images.at(-1));
console.log("已生成图序 Windows 图标和 PNG，尺寸 16–256px。");
