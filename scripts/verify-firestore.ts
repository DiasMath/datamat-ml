import { loadEnvConfig } from "@next/env";
import { strict as assert } from "node:assert";
import { db, get, put, remove, transaction, id } from "../src/server/db";
loadEnvConfig(process.cwd());
async function main() {
  if (!process.argv.includes("--write"))
    throw new Error(
      "Informe --write para testar um documento temporário isolado",
    );
  if (process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error(
      "Este comando verifica Firestore real; remova a configuração de emulador",
    );
  const documentId = id(),
    collection = "_datamat_review_checks";
  try {
    await transaction(async () => {
      assert.equal(await get(collection, documentId), undefined);
      await put(collection, documentId, { review: true, version: 1 });
    });
    assert.equal((await get(collection, documentId))?.version, 1);
    await transaction(async () => {
      const row = await get(collection, documentId);
      assert.equal(row?.version, 1);
      await put(collection, documentId, { ...row, version: 2 });
    });
    assert.equal((await get(collection, documentId))?.version, 2);
    await transaction(async () => {
      assert.equal((await get(collection, documentId))?.version, 2);
      await remove(collection, documentId);
    });
    assert.equal(await get(collection, documentId), undefined);
    console.log(
      "Firestore real: inserção, leitura, edição transacional e exclusão confirmadas. Documento temporário removido; dados operacionais preservados.",
    );
  } finally {
    await db().collection(collection).doc(documentId).delete();
  }
}
main().catch((error) => {
  console.error(
    "Verificação Firestore falhou:",
    error instanceof Error ? error.message : "erro desconhecido",
  );
  process.exitCode = 1;
});
