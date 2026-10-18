// Provider details stay in server logs. Public responses contain only an
// actionable category, never tokens, keys, raw payloads or SDK stack traces.
export class FirestoreQuotaError extends Error {
  readonly code = "FIRESTORE_QUOTA_EXCEEDED";
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "FirestoreQuotaError";
  }
}
export function databaseFailure(error: unknown) {
  if (!(error instanceof Error)) return null;
  const code = (error as Error & { code?: number | string }).code;
  const message = error.message;
  if (
    code === 8 ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "FIRESTORE_QUOTA_EXCEEDED"
  )
    return {
      status: 503,
      code: "FIRESTORE_QUOTA_EXCEEDED",
      error:
        "O limite de uso do Firestore foi atingido. Confira as cotas e o faturamento do projeto Firebase.",
    };
  if (
    code === 16 ||
    code === "UNAUTHENTICATED" ||
    /invalid_grant|invalid jwt|invalid credential|invalid signature|jwt signature|account.*disabled|private key.*invalid|signing key/i.test(
      message,
    )
  )
    return {
      status: 503,
      code: "FIREBASE_AUTH_FAILED",
      error:
        "O Firebase recusou a credencial administrativa. Confira a conta de serviço e FIREBASE_SERVICE_ACCOUNT_JSON na Vercel e publique novamente.",
    };
  if (code === 7 || code === "PERMISSION_DENIED")
    return {
      status: 503,
      code: "FIREBASE_PERMISSION_DENIED",
      error:
        "A conta de serviço está sem permissão para acessar o Firestore. Confira as permissões no projeto Firebase.",
    };
  if ((code === 9 || code === "FAILED_PRECONDITION") && /index/i.test(message))
    return {
      status: 503,
      code: "FIRESTORE_INDEX_REQUIRED",
      error:
        "Uma consulta precisa de um índice no Firestore. Confira o índice indicado nos registros do servidor.",
    };
  if (
    [
      4,
      10,
      14,
      "DEADLINE_EXCEEDED",
      "ABORTED",
      "UNAVAILABLE",
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
    ].includes(code as string | number)
  )
    return {
      status: 503,
      code: "FIRESTORE_UNAVAILABLE",
      error:
        "A consulta ao banco está temporariamente indisponível. Tente novamente em instantes.",
    };
  return null;
}
