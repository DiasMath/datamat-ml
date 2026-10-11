import { test } from "node:test";
import assert from "node:assert/strict";
import { autocompleteSuggestions } from "../src/domain/autocomplete";
test("autocomplete matches accents and case, removes blank/duplicate text and preserves identifiers", () => {
  assert.deepEqual(
    autocompleteSuggestions(
      [null, "", " Áudio ", "áudio", "Audio", "Fone Áudio", "Outros"],
      "audio",
    ),
    ["Áudio", "Fone Áudio"],
  );
  assert.deepEqual(autocompleteSuggestions(["000123", "000456"], "123"), [
    "000123",
  ]);
  assert.deepEqual(
    autocompleteSuggestions(["Livre", "Outro"], "Novo valor"),
    [],
  );
});
test("autocomplete suggestions stay bounded without inventing a value", () => {
  const values = Array.from({ length: 500 }, (_, i) => `Modelo ${i}`);
  assert.equal(autocompleteSuggestions(values, "").length, 25);
  assert.ok(autocompleteSuggestions(values, "499").includes("Modelo 499"));
});
