"use strict";

const path = require("path");
const { register } = require("tsconfig-paths");

const productRoot = path.resolve(__dirname, "..");

register({
  baseUrl: productRoot,
  paths: { "@/*": ["./*"] },
});
