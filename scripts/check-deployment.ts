// Run with the intended production environment. Never print credential values.
import { mlConfigured } from "../src/server/mercadolivre";
import { createPrivateKey } from "node:crypto";
const errors: string[] = [];
let app: URL | undefined;
try {
  app = new URL(process.env.APP_URL || "");
  if (
    app.protocol !== "https:" ||
    app.username ||
    app.password ||
    app.search ||
    app.hash ||
    app.pathname !== "/"
  )
    errors.push(
      "APP_URL deve ser a origem pública HTTPS, sem caminho ou parâmetros.",
    );
} catch {
  errors.push("Configure APP_URL com a URL de produção da Vercel.");
}
if (!process.env.FIREBASE_PROJECT_ID)
  errors.push("Configure FIREBASE_PROJECT_ID.");
try {
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  if (
    account.type !== "service_account" ||
    account.project_id !== process.env.FIREBASE_PROJECT_ID ||
    !account.private_key ||
    !account.client_email
  )
    throw new Error();
  if (createPrivateKey(account.private_key).asymmetricKeyType !== "rsa")
    throw new Error();
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL &&
    account.client_email !== process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL
  )
    throw new Error();
} catch {
  errors.push(
    "Configure FIREBASE_SERVICE_ACCOUNT_JSON com a conta administrativa do projeto; o caminho local não funciona na Vercel.",
  );
}
if (process.env.FIRESTORE_EMULATOR_HOST)
  errors.push("Remova FIRESTORE_EMULATOR_HOST do ambiente de produção.");
if (
  ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"].some(
    (k) => process.env[k],
  ) &&
  !mlConfigured()
)
  errors.push(
    "Complete ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI e ML_TOKEN_ENCRYPTION_KEY; o callback deve corresponder a APP_URL.",
  );
if (errors.length) {
  errors.forEach((e) => console.error(e));
  process.exitCode = 1;
} else
  console.log(
    "Configuração de publicação validada. Credenciais não foram exibidas. Mercado Livre: " +
      (mlConfigured()
        ? "aplicação configurada; autorização por loja será feita pela interface."
        : "pode ser ativado após definir a URL e configurar a aplicação."),
  );
