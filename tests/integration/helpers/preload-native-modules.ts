// Playwright workers load this before any test chdirs. sanitize-html
// requires ESM htmlparser2; first-linking that graph after chdir fails.
import "sanitize-html";
