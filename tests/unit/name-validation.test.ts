import assert from "node:assert/strict";
import test from "node:test";
import { isValidName, validateName } from "../../lib/nameValidation";

test("name validation accepts Unicode letters and common name separators", () => {
  for (const name of ["Ada Lovelace", "Jean-Luc", "O'Connor", "张·伟", "Élodie", "Алексей Иванов"]) {
    assert.equal(isValidName(name), true, name);
  }
  assert.equal(validateName("  张·伟  "), "张·伟");
});

test("name validation requires 1-50 Unicode letters and rejects digits, emoji and symbols", () => {
  for (const name of ["", "Ada2", "Ada 😊", "Ada_", "-Ada", "Ada-", "A".repeat(51)]) {
    assert.equal(isValidName(name), false, name);
  }
});
