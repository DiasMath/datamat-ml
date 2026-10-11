import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
export const jar = ".cache/firestore/cloud-firestore-emulator-v1.22.0.jar";
const digest =
  "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c";
function valid(path: string) {
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path);
  return (
    bytes.length === 136707194 &&
    createHash("sha256").update(bytes).digest("hex") === digest
  );
}
export function prepareEmulator() {
  if (valid(jar)) return;
  mkdirSync(".cache/firestore", { recursive: true });
  const temporary = jar + ".download";
  const result = spawnSync(
    "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "2",
      "--output",
      temporary,
      "https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0 || !valid(temporary)) {
    rmSync(temporary, { force: true });
    throw new Error(
      "Download do emulador falhou ou checksum não corresponde ao artefato oficial",
    );
  }
  renameSync(temporary, jar);
}
if (process.argv[2] === "download") {
  prepareEmulator();
  console.log("Emulador Firestore 1.22.0 verificado por SHA-256.");
}
