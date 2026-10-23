import assert from "node:assert/strict";
import test from "node:test";
import { isNameTooLong, isValidName, validateName, normalisePastedName, isValidAccountName, validateAccountName } from "../../lib/nameValidation";

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

test("name length is measured in Unicode characters", () => {
  assert.equal(isNameTooLong("A".repeat(50)), false);
  assert.equal(isNameTooLong("A".repeat(51)), true);
});

test("account names accept test001 and keep Unicode, length and symbol validation", () => {
  for (const name of ["test001", "001", "用户001", "Ada 2", "Jean-Luc2", "J.R.R. Tolkien", "A".repeat(49)+"1"]) assert.equal(isValidAccountName(name),true,name);
  assert.equal(validateAccountName("  test001  "),"test001");
  for (const name of ["", "  ", "test_001", "test😊", "<script>", "-test001", "test001-", "A".repeat(50)+"1"]) {
    assert.equal(isValidAccountName(name),false,name);assert.throws(()=>validateAccountName(name));
  }
  assert.equal(isValidName("test001"),false,"contact-person names retain their existing rule");
});

test("name validation accepts full stops in English names", () => {
  assert.equal(isValidName("J.R.R. Tolkien"), true);
});

test("pasted names remove surrounding bold Markdown without accepting embedded symbols", () => {
  assert.equal(normalisePastedName("  **Ada Lovelace**  "), "Ada Lovelace");
  assert.equal(normalisePastedName("**张伟**"), "张伟");
  assert.equal(isValidName(normalisePastedName("**Ada*Lovelace**")), false);
  assert.equal(normalisePastedName("Ada Lovelace"), "Ada Lovelace");
});
