// Run with the intended production environment. Never print credential values.
import { mlConfigured } from "../src/server/mercadolivre";
import {
  readFirebaseConfiguration,
  FirebaseConfigurationError,
} from "../src/server/firebase-configuration";
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
try {
  readFirebaseConfiguration({ ...process.env, VERCEL: "1" });
} catch (error) {
  errors.push(
    error instanceof FirebaseConfigurationError
      ? error.message
      : "Não foi possível validar a credencial administrativa do Firebase.",
  );
}
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
