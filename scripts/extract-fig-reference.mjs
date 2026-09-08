import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Offline design inspection only; openfig-core is not an application dependency.
const { parseFig, nodeId } = await import(process.env.FIG_PARSER_MODULE || "openfig-core");
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node extract-fig-reference.mjs input.fig output-directory");
const bytes = await fs.readFile(input);
const doc = parseFig(bytes);
await fs.mkdir(path.join(output, "images"), { recursive: true });
const properties = [
  "type", "name", "visible", "opacity", "size", "transform", "parentIndex",
  "fillPaints", "strokePaints", "strokeWeight", "strokeAlign", "effects",
  "cornerRadius", "rectangleTopLeftCornerRadius", "rectangleTopRightCornerRadius",
  "rectangleBottomLeftCornerRadius", "rectangleBottomRightCornerRadius",
  "fontName", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlignHorizontal",
  "textAlignVertical", "textAutoResize", "layoutMode", "layoutAlign", "layoutGrow",
  "stackMode", "stackSpacing", "stackPadding", "stackPrimarySizing", "stackCounterSizing",
  "stackPrimaryAlignItems", "stackCounterAlignItems", "constraints", "componentProperties",
  "symbolData", "symbolID", "overrides", "derivedTextData"
];
function removeGlyphs(key, value) {
  return ["glyphs", "glyphPositions", "characterPositions", "editInfo"].includes(key) ? undefined : value;
}
const nodes = doc.nodes.map((node) => {
  const selected = { id: nodeId(node) };
  for (const key of properties) if (node[key] !== undefined) selected[key] = node[key];
  if (node.textData) selected.textData = { characters: node.textData.characters, lines: node.textData.lines, styleOverrideTable: node.textData.styleOverrideTable, characterStyleIDs: node.textData.characterStyleIDs };
  return selected;
});
const pages = doc.nodes.filter((node) => node.type === "CANVAS");
const pageIds = new Set(pages.map(nodeId));
const screens = doc.nodes.filter((node) => {
  const parent = node.parentIndex?.guid;
  return parent && pageIds.has(`${parent.sessionID}:${parent.localID}`);
}).map((node) => ({ id: nodeId(node), name: node.name, type: node.type, visible: node.visible, size: node.size, page: `${node.parentIndex.guid.sessionID}:${node.parentIndex.guid.localID}` }));
const inventory = { source: path.basename(input), sha256: createHash("sha256").update(bytes).digest("hex"), exportedAt: doc.meta?.exported_at, header: doc.header, nodeCount: nodes.length, imageCount: doc.images.size, pages: pages.map((node) => ({ id: nodeId(node), name: node.name })), screens };
await fs.writeFile(path.join(output, "inventory.json"), JSON.stringify(inventory, null, 2));
await fs.writeFile(path.join(output, "nodes.json"), JSON.stringify(nodes, removeGlyphs, 2));
for (const [hash, image] of doc.images) {
  if (!/^[a-f0-9]+$/i.test(hash)) throw new Error("Unexpected embedded image name");
  await fs.writeFile(path.join(output, "images", hash), image);
}
console.log(JSON.stringify({ output, nodes: nodes.length, images: doc.images.size, screens: screens.length }));
