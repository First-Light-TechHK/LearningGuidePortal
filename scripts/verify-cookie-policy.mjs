import assert from "node:assert/strict";
import { secureAuthCookie } from "../services/runtimeConfig.ts";

for (const environment of ["DEV", "SIT", "UAT", "PPE/PROD", "PROD"]) {
  process.env.APP_ENV = environment;
  for (const host of ["localhost", "127.0.0.1", "[::1]", "learning.example.com"]) {
    for (const protocol of ["http", "https"]) {
      const request = new Request(`${protocol}://${host}/api/auth/login`);
      const localDev = environment === "DEV" && protocol === "http" && host !== "learning.example.com";
      assert.equal(secureAuthCookie(request), !localDev, `${environment} ${request.url}`);
    }
  }
}
console.log("PASS: 40 cookie policy cases; HTTP allowed only for explicit DEV on loopback.");
