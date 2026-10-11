import { readFileSync, writeFileSync, existsSync } from "node:fs";
const defaults: Record<string, string> = {
  APP_URL: "http://localhost:3000",
  APP_OPERATOR_NAME: "Operador",
  FIREBASE_PROJECT_ID: "datamat-ml",
  FIREBASE_SERVICE_ACCOUNT_EMAIL:
    "firebase-adminsdk-fbsvc@datamat-ml.iam.gserviceaccount.com",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSyDmBVfO6pEiTHy1anem48Qiqkcxb63MGys",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "datamat-ml.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "datamat-ml",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "datamat-ml.firebasestorage.app",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "374456825775",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:374456825775:web:6bb83d53e4d1d2123ce15a",
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: "G-KFY9XQS6FF",
};
let content = existsSync(".env.local")
  ? readFileSync(".env.local", "utf8")
  : "";
const names = new Set(content.split("\n").map((line) => line.split("=")[0]));
for (const [name, value] of Object.entries(defaults))
  if (!names.has(name)) content += `${name}=${value}\n`;
writeFileSync(".env.local", content, { mode: 0o600 });
console.log(
  "Configuração local preparada; valores existentes preservados e credenciais não exibidas.",
);
