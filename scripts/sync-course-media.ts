import { MEDIA, ensureMedia } from "../db/data-migrations/006_add_modeling_life_course";

let copied = 0;
for (const asset of MEDIA) {
  const result = await ensureMedia(asset, true);
  if (result === "add") copied += 1;
}
console.log(JSON.stringify({ ok: true, copied, total: MEDIA.length }));
