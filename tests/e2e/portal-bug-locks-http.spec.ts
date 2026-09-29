import { expect, test } from "playwright/test";

test("GET /en-GB/portal and /en-GB/portal/courses must not 500 when STORAGE_BACKEND=local and AWS credentials are absent", async ({ request }) => {
  for (const path of ["/en-GB/portal", "/en-GB/portal/courses"]) {
    const response = await request.get(path);
    const body = await response.text();
    expect(body, path).not.toContain("CredentialsProviderError");
    expect(response.status(), `${path} returned ${response.status()}; a cover URL that cannot be signed must not take down the page`).toBe(200);
  }
});

test("a signed-out visitor can open /en-GB/portal/courses/epicureanism and its public first lesson without a 307 to sign-in", async ({ request }) => {
  for (const path of ["/en-GB/portal/courses/epicureanism", "/en-GB/portal/courses/epicureanism/public-lesson"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const location = response.headers().location || "";
    expect(location, `${path} redirected to sign-in`).not.toContain("sign-in");
    expect(response.status(), `${path} status ${response.status()} location ${location}; a signed-out visitor must be able to open the published course and its public first lesson`).toBe(200);
  }
});
