import { test } from "node:test";
import assert from "node:assert/strict";
import { safeAccessDiagnostic } from "../src/domain/ml-access-diagnostic";

test("HTML edge denial is distinct from API JSON permission errors; content is never exported", async () => {
  const response = new Response("<html>FORBIDDEN DO_NOT_EXPORT</html>", {
    status: 403,
    headers: { "content-type": "text/html", "x-amz-cf-id": "cf-request-id" },
  });
  const data = await safeAccessDiagnostic(response, "/users/me", true);
  assert.equal(data.response_format, "html");
  assert.equal(data.cloudfront_seen, true);
  assert.equal(data.known_error_code, null);
  assert.equal(data.authorization_header_present, true);
  assert.equal(JSON.stringify(data).includes("DO_NOT_EXPORT"), false);
  assert.equal(response.bodyUsed, false);
});
test("only fixed API error codes and correlation IDs are exported, never raw messages or tokens", async () => {
  const response = new Response(
    JSON.stringify({
      code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES",
      blocked_by: "PolicyAgent",
      message: "DO_NOT_EXPORT",
      access_token: "DO_NOT_EXPORT",
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json",
        "x-request-id": "abc-123",
      },
    },
  );
  const data = await safeAccessDiagnostic(response, "/users/me", true);
  assert.equal(data.known_error_code, "PA_UNAUTHORIZED_RESULT_FROM_POLICIES");
  assert.equal(data.blocked_by, "PolicyAgent");
  assert.equal(data.request_id, "abc-123");
  assert.equal(JSON.stringify(data).includes("DO_NOT_EXPORT"), false);
});
test("successful account bodies remain unread and unknown codes do not disclose supplied values", async () => {
  const response = new Response('{"email":"DO_NOT_EXPORT"}', {
    headers: { "content-type": "application/json" },
  });
  assert.equal(
    (await safeAccessDiagnostic(response, "/users/me", true)).http_status,
    200,
  );
  assert.equal(response.bodyUsed, false);
  const error = new Response(
    '{"code":"DO_NOT_EXPORT","blocked_by":"DO_NOT_EXPORT"}',
    { status: 403, headers: { "content-type": "application/json" } },
  );
  assert.equal(
    JSON.stringify(
      await safeAccessDiagnostic(error, "/sites/MLB", false),
    ).includes("DO_NOT_EXPORT"),
    false,
  );
});
test("oversized HTML responses are bounded and do not expose appended error content", async () => {
  const response = new Response("x".repeat(200000) + "DO_NOT_EXPORT", {
    status: 403,
    headers: { "content-type": "text/html" },
  });
  const data = await safeAccessDiagnostic(response, "/sites/MLB", false);
  assert.equal(data.response_format, "html");
  assert.equal(JSON.stringify(data).includes("DO_NOT_EXPORT"), false);
});
