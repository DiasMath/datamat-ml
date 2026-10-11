import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
async function main() {
  await build({
    entryPoints: ["extension/src/panel.ts", "extension/src/worker.ts"],
    outdir: "extension/dist",
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome116",
    minify: true,
  });
  const files = [
    "manifest.json",
    "panel.html",
    "panel.css",
    "worker.js",
    "panel.js",
  ];
  for (const filename of ["manifest.json", "panel.html", "panel.css"])
    await writeFile(
      resolve("extension/dist", filename),
      await readFile(resolve("extension", filename)),
    );
  const entries: Array<Buffer> = [],
    directory: Array<Buffer> = [];
  let offset = 0;
  function crc32(data: Buffer) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  for (const filename of files) {
    const data = await readFile(resolve("extension/dist", filename));
    const name = Buffer.from(filename),
      crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  await mkdir("public", { recursive: true });
  await writeFile(
    "public/datamat-extension.zip",
    Buffer.concat([...entries, central, end]),
  );
  console.log("Extensão compilada e pacote público gerado, sem credenciais.");
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Falha ao compilar extensão",
  );
  process.exitCode = 1;
});
