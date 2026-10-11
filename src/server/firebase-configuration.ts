import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

export class FirebaseConfigurationError extends Error {}
type Environment = Record<string, string | undefined>;
export type FirebaseAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

// Errors describe the correction without echoing any input or parser/PEM errors.
export function parseFirebaseAccount(
  raw: string,
  projectId: string,
  expectedEmail?: string,
): FirebaseAccount {
  let source = raw.trim();
  if (source.startsWith("'") && source.endsWith("'"))
    source = source.slice(1, -1).trim();
  let account: unknown;
  try {
    account = JSON.parse(source);
    // Some environment import tools encode the complete JSON as a JSON string.
    if (typeof account === "string") account = JSON.parse(account.trim());
  } catch {
    throw new FirebaseConfigurationError(
      "FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido. Cole o conteúdo completo do arquivo da conta de serviço, sem o nome da variável ou blocos de código.",
    );
  }
  if (!account || typeof account !== "object" || Array.isArray(account))
    throw new FirebaseConfigurationError(
      "FIREBASE_SERVICE_ACCOUNT_JSON deve conter o objeto completo da conta de serviço.",
    );
  const data = account as Record<string, unknown>;
  if (data.type !== "service_account")
    throw new FirebaseConfigurationError(
      "FIREBASE_SERVICE_ACCOUNT_JSON deve ser a chave de uma conta de serviço (type: service_account). A configuração web firebaseConfig não é uma credencial administrativa.",
    );
  if (
    typeof data.project_id !== "string" ||
    data.project_id.trim() !== projectId.trim()
  )
    throw new FirebaseConfigurationError(
      "O project_id da conta de serviço não corresponde a FIREBASE_PROJECT_ID. Use o ID do projeto Firebase, sem domínio ou aspas.",
    );
  if (
    typeof data.client_email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.client_email.trim())
  )
    throw new FirebaseConfigurationError(
      "O JSON da conta de serviço está sem client_email válido. Copie o arquivo completo.",
    );
  const clientEmail = data.client_email.trim();
  if (expectedEmail?.trim() && clientEmail !== expectedEmail.trim())
    throw new FirebaseConfigurationError(
      "O client_email do JSON não corresponde a FIREBASE_SERVICE_ACCOUNT_EMAIL. Corrija o e-mail configurado ou remova essa variável opcional.",
    );
  if (typeof data.private_key !== "string" || !data.private_key.trim())
    throw new FirebaseConfigurationError(
      "O JSON da conta de serviço está sem private_key. O e-mail da conta sozinho não autoriza acesso ao Firestore.",
    );
  const privateKey = data.private_key
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
  try {
    if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa")
      throw new Error();
  } catch {
    throw new FirebaseConfigurationError(
      "A private_key da conta de serviço é inválida ou foi truncada. Copie novamente o JSON original, mantendo as quebras de linha da chave.",
    );
  }
  return { projectId: projectId.trim(), clientEmail, privateKey };
}

export function readFirebaseConfiguration(
  env: Environment = process.env,
  readFile: (path: string) => string = (path) =>
    readFileSync(/* turbopackIgnore: true */ path, "utf8"),
) {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId)
    throw new FirebaseConfigurationError(
      "Configure FIREBASE_PROJECT_ID com o ID do projeto Firebase.",
    );
  const vercel = env.VERCEL === "1";
  if (env.FIRESTORE_EMULATOR_HOST?.trim()) {
    if (vercel)
      throw new FirebaseConfigurationError(
        "Remova FIRESTORE_EMULATOR_HOST da Vercel. O emulador é usado somente nos testes locais.",
      );
    if (!projectId.startsWith("demo-"))
      throw new FirebaseConfigurationError(
        "O emulador exige projeto demo-* separado do projeto real.",
      );
    return { projectId, mode: "emulator" as const, account: null };
  }
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim(),
    path = env.FIREBASE_ADMIN_CREDENTIALS_PATH?.trim();
  if (raw)
    return {
      projectId,
      mode: "service-account" as const,
      account: parseFirebaseAccount(
        raw,
        projectId,
        env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
      ),
    };
  if (vercel)
    throw new FirebaseConfigurationError(
      path
        ? "FIREBASE_ADMIN_CREDENTIALS_PATH aponta para um arquivo local que não é enviado à Vercel. Remova essa variável e cadastre o JSON completo em FIREBASE_SERVICE_ACCOUNT_JSON no ambiente deste deploy; depois faça Redeploy."
        : "FIREBASE_SERVICE_ACCOUNT_JSON está ausente ou vazio neste deploy. Cadastre o JSON completo em Settings → Environment Variables, no ambiente Production ou Preview correspondente, e faça Redeploy.",
    );
  if (path) {
    let contents: string;
    try {
      contents = readFile(path);
    } catch {
      throw new FirebaseConfigurationError(
        "O arquivo de FIREBASE_ADMIN_CREDENTIALS_PATH não pôde ser lido. Confira o caminho local; na Vercel, use FIREBASE_SERVICE_ACCOUNT_JSON.",
      );
    }
    return {
      projectId,
      mode: "service-account" as const,
      account: parseFirebaseAccount(
        contents,
        projectId,
        env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
      ),
    };
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    try {
      const adc = JSON.parse(
        readFile(env.GOOGLE_APPLICATION_CREDENTIALS.trim()),
      );
      if (
        !["service_account", "authorized_user", "external_account"].includes(
          adc.type,
        )
      )
        throw new Error();
    } catch {
      throw new FirebaseConfigurationError(
        "GOOGLE_APPLICATION_CREDENTIALS não aponta para uma credencial local válida. Na Vercel, use FIREBASE_SERVICE_ACCOUNT_JSON.",
      );
    }
  }
  return { projectId, mode: "application-default" as const, account: null };
}
