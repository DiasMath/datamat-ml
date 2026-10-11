import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prepareEmulator, jar } from "./firestore-emulator";
async function main() {
  const mode = process.argv[2];
  if (!["unit", "browser"].includes(mode))
    throw new Error("Informe unit ou browser");
  let emulator: ChildProcess | undefined;
  const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:9080";
  const endpoint = new URL("http://" + host);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    throw new Error("Testes exigem emulador local");
  try {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      prepareEmulator();
      emulator = spawn(
        "java",
        [
          "-jar",
          jar,
          "--host",
          endpoint.hostname,
          "--port",
          endpoint.port,
          "--rules",
          "firestore.rules",
        ],
        { stdio: "ignore" },
      );
      emulator.on("error", () => {});
    }
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (emulator && emulator.exitCode !== null)
        throw new Error(
          "Emulador encerrou antes de iniciar; verifique Java 21+ e porta 9080",
        );
      try {
        const response = await fetch(endpoint, {
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Emulador Firestore não respondeu");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: host,
      FIREBASE_PROJECT_ID: "demo-datamat-test-" + randomUUID(),
    };
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete env.FIREBASE_ADMIN_CREDENTIALS_PATH;
    const command =
      mode === "unit"
        ? [
            "tsx",
            "--test",
            "tests/finance.test.ts",
            "tests/services.test.ts",
            "tests/dates.test.ts",
            "tests/spreadsheet.test.ts",
            "tests/autocomplete.test.ts",
            "tests/marketplace.test.ts",
            "tests/mercadolivre.test.ts",
            "tests/analytics.test.ts",
          ]
        : ["playwright", "test", ...process.argv.slice(3)];
    const child = spawn("npx", command, { stdio: "inherit", env });
    const code = await new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", () => resolve(1));
    });
    process.exitCode = code;
  } finally {
    if (emulator) emulator.kill("SIGTERM");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Erro no emulador");
  process.exitCode = 1;
});
