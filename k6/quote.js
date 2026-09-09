// 不进 CI。LOAD-002 stub。无项目组 SLA 不准跑。禁止 ilovelearningguide.com。
import http from "k6/http";

export const options = { vus: 0, iterations: 0 };

export default function () {
  // stub — no target until SLA + written SIT host
  http.get("https://example.invalid/");
}
