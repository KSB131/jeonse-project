// dabang.js
console.log("START dabang crawler");
process.on("exit", (code) => console.log("EXIT code:", code));

import fs from "fs";

const ENDPOINT = "https://www.dabangapp.com/api/v5/room-list/category/apt/bbox";

const GWANGJU_BBOX = {
  sw: { lat: 35.0864879, lng: 126.7714733 },
  ne: { lat: 35.1839144, lng: 126.8947261 },
};

const filtersObj = {
  sellingTypeList: ["MONTHLY_RENT", "LEASE", "SELL"],
  tradeRange: { min: 0, max: 999999 },
  depositRange: { min: 0, max: 999999 },
  priceRange: { min: 0, max: 999999 },
  isIncludeMaintenance: false,
  pyeongRange: { min: 0, max: 999999 },
  useApprovalDateRange: { min: 0, max: 999999 },
  dealTypeList: ["AGENT", "DIRECT"],
  householdNumRange: { min: 0, max: 999999 },
  parkingNumRange: { min: 0, max: 999999 },
  isShortLease: false,
  hasTakeTenant: false,
};

const headers = {
  accept: "application/json, text/plain, */*",
  "d-api-version": "5.0.0",
  "d-app-version": "1",
  "d-call-type": "web",
  referer: "https://www.dabangapp.com/map/apt",
  "user-agent": "Mozilla/5.0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl({ bbox, page, zoom = 13, useMap = "naver" }) {
  const params = new URLSearchParams({
    filters: JSON.stringify(filtersObj),
    bbox: JSON.stringify(bbox),
    zoom: String(zoom),
    useMap,
    page: String(page),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

async function fetchPage({ bbox, page }) {
  const url = buildUrl({ bbox, page });
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }

  const data = await res.json();
  if (data?.code !== 200) {
    throw new Error(`API code=${data?.code} msg=${data?.msg}`);
  }
  return data.result;
}

function summarizeByDong(items) {
  const map = new Map();
  for (const it of items) {
    const dong = it?.dongName ?? "(unknown)";
    map.set(dong, (map.get(dong) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dongName, count]) => ({ dongName, count }));
}

async function main() {
  console.log("main() entered");

  const seen = new Set();
  const results = [];

  let page = 1;
  let total = null;

  while (true) {
    const r = await fetchPage({ bbox: GWANGJU_BBOX, page });

    if (total === null) {
      total = r.total ?? 0;
      console.log("total:", total, "limit:", r.limit);
    }

    const list = r.roomList ?? [];
    for (const item of list) {
      if (!item?.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
    }

    console.log(`page ${page} -> got ${list.length}, unique ${results.length}, hasMore=${r.hasMore}`);

    if (!r.hasMore) break;
    page += 1;
    await sleep(250);
  }

  fs.writeFileSync("dabang_gwangju_rooms.json", JSON.stringify(results, null, 2), "utf-8");
  fs.writeFileSync("dabang_gwangju_dong_stats.json", JSON.stringify(summarizeByDong(results), null, 2), "utf-8");

  console.log("✅ saved dabang_gwangju_rooms.json");
  console.log("✅ saved dabang_gwangju_dong_stats.json");
}

main()
  .then(() => console.log("DONE"))
  .catch((e) => {
    console.error("❌ ERROR:", e);
    process.exit(1);
  });
