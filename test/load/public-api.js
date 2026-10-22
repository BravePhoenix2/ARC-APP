// Run against a dedicated staging environment: k6 run -e BASE_URL=https://staging.example.com test/load/public-api.js
import http from "k6/http";
import { check, sleep } from "k6";
export const options = {
  stages: [{ duration: "1m", target: 25 }, { duration: "3m", target: 100 }, { duration: "1m", target: 0 }],
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1000"] },
};
export default function () {
  const origin = __ENV.BASE_URL;
  if (!origin) throw new Error("BASE_URL must point to a dedicated staging deployment.");
  const responses = http.batch([
    ["GET", `${origin}/api/items?itemType=NFT`],
    ["GET", `${origin}/api/items?itemType=WEB2_ART`],
    ["GET", `${origin}/api/discovery`],
    ["GET", `${origin}/api/leaderboard`],
  ]);
  responses.forEach((response) => check(response, { "public endpoint succeeds": (r) => r.status === 200 }));
  const catalog = responses[0].json();
  check(catalog, { "catalog is bounded": (body) => Array.isArray(body.items) && body.items.length <= 48 });
  if (catalog.nextCursor) {
    const next = http.get(`${origin}/api/items?itemType=NFT&cursor=${encodeURIComponent(catalog.nextCursor)}`);
    check(next, { "next catalog page succeeds": (r) => r.status === 200 });
  }
  sleep(1 + Math.random() * 2);
}
