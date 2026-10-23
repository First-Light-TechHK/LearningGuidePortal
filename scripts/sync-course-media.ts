import { syncModelingLifeMedia } from "../db/data-migrations/006_add_modeling_life_course";

const changes = await syncModelingLifeMedia();
const copied = changes.filter((change) => change.action === "add").length;
console.log(JSON.stringify({ ok: true, copied, total: changes.length }));
