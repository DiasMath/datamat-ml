import { test, expect } from "@playwright/test";
const headers = { Origin: "http://localhost:3100" };
test("market endpoints validate origin, schema and connection before contacting the provider", async ({
  request,
}) => {
  const diagnostic = "/api/market-research/diagnostic",
    read = "/api/market-research/read";
  const body = { storeId: "juntos-data", applicationId: "123456" };
  const forbidden = await request.post(diagnostic, {
    headers: { Origin: "https://untrusted.example" },
    data: body,
  });
  expect(forbidden.status()).toBe(403);
  expect(
    (
      await request.post(diagnostic, {
        headers,
        data: { ...body, url: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post(read, {
        headers,
        data: { ...body, resource: { kind: "item", id: "MLB1/../users/me" } },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post(diagnostic, {
        headers,
        data: { ...body, storeId: "unavailable-store" },
      })
    ).status(),
  ).toBe(404);
  const unavailable = await request.post(diagnostic, { headers, data: body });
  expect(unavailable.status()).toBe(409);
  expect(await unavailable.json()).toHaveProperty(
    "error",
    "Esta loja não tem conexão ativa com a aplicação esperada",
  );
  expect((await request.get(diagnostic)).status()).toBe(404);
});
