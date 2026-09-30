import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountMenu } from "../../components/portal/AccountMenu";

const labels = { myLearning: "My Learning", settings: "Settings", notifications: "Notifications", signOut: "Sign out" };

test("account menu shows the saved name and uses Name when it is missing", () => {
  const named = renderToStaticMarkup(createElement(AccountMenu, { locale: "en-GB", displayName: "Google Learner", labels }));
  assert.match(named, /Google Learner account menu/);
  assert.match(named, /portal-header-avatar[^>]*>G</);

  const unnamed = renderToStaticMarkup(createElement(AccountMenu, { locale: "en-GB", displayName: "  ", labels }));
  assert.match(unnamed, /Name account menu/);
  assert.match(unnamed, /portal-header-avatar[^>]*>N</);
});
