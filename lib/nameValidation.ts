const NAME_SEPARATOR = "[ '\\-·]";
const NAME_PART = "[\\p{L}\\p{M}]";
const NAME_PATTERN = new RegExp(`^${NAME_PART}+(?:${NAME_SEPARATOR}+${NAME_PART}+)*$`, "u");

export const NAME_INVALID_MESSAGE = "Name must contain 1-50 letters and may use spaces, hyphens (-), apostrophes (') or middle dots (·).";

export function normaliseName(value: string) {
  return value.trim().normalize("NFC");
}

export function isValidName(value: string) {
  const name = normaliseName(value);
  return Array.from(name).length >= 1 && Array.from(name).length <= 50 && NAME_PATTERN.test(name);
}

export function validateName(value: string) {
  const name = normaliseName(value);
  if (!isValidName(name)) throw new Error(NAME_INVALID_MESSAGE);
  return name;
}
