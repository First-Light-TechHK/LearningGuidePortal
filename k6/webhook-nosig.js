// 不进 CI。LOAD-004 stub。无项目组 SLA 不准跑。禁止 ilovelearningguide.com。
import http from "k6/http";

export const options = { vus: 0, iterations: 0 };

export default function () {
  // stub — unsigned webhook only after SLA + written SIT host; never embed webhook secret
  http.get("https://example.invalid/");
}
