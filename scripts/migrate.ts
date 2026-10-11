import { loadEnvConfig } from "@next/env";
import { initializeDatabase, find } from "../src/server/db";
loadEnvConfig(process.cwd());
async function main() {
  await initializeDatabase();
  console.log(
    "Cloud Firestore inicializado:",
    (await find("_datamat_schema")).map((row) => ({
      id: row.id,
      version: row.version,
    })),
  );
}
main().catch((error) => {
  console.error(
    "Não foi possível inicializar Firestore:",
    error instanceof Error ? error.message : "erro desconhecido",
  );
  process.exitCode = 1;
});
