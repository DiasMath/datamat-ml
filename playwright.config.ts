import { defineConfig } from "@playwright/test";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_PROJECT_ID?.startsWith("demo-")
)
  throw new Error("Execute npm run test:e2e com emulador isolado");
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://localhost:3100/api/workspace",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID!,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST!,
      APP_URL: "http://localhost:3100",
      APP_OPERATOR_NAME: "Gestor de teste",
      NEXT_TELEMETRY_DISABLED: "1",
      ML_CLIENT_ID: "123456",
      ML_CLIENT_SECRET: "test-only-not-real",
      ML_REDIRECT_URI: "http://localhost:3100/api/mercadolivre/callback",
      ML_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
