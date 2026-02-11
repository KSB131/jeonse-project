// dabang_realprice.js
console.log("START dabang real-price crawler");
process.on("exit", (code) => console.log("EXIT code:", code));

import fs from "fs";

const ENDPOINT =
  "https://www.dabangapp.com/api/v5/real-price/complex/histories";

const headers = {
  accept: "application/json, text/plain, */*",
  "d-api-version": "5.0.0",
  "d-app-version": "1",
  "d-call-type": "web",
  referer: "https://www.dabangapp.com/map/apt",
  "user-agent": "Mozilla/5.0",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl({
  complexId,
  spaceSeq,
  fromDate,
  toDate,
  searchType,
  page,
  limit,
}) {
  const params = new URLSearchParams({
    complexId: String(complexId),
    spaceSeq: String(spaceSeq),
    fromDate: String(fromDate),
    toDate: String(toDate),
    searchType: String(searchType),
    page: String(page),
    limit: String(limit),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

async function fetchPage(opts) {
  const url = buildUrl(opts);
  const res = await fetch(url, { headers });

  const text = await res.text().catch(() => "");

  // 400도 바디를 읽어서 msg 확인 가능하게
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  if (data?.code !== 200) {
    throw new Error(`API code=${data?.code} msg=${data?.msg}`);
  }

  return data.result;
}

// ✅ 400(limit 초과)이면 limit 줄여서 재시도
async function safeFetchPage(baseOpts) {
  let limit = baseOpts.limit;

  while (true) {
    try {
      return await fetchPage({ ...baseOpts, limit });
    } catch (e) {
      const msg = String(e?.message ?? e);

      // "페이지당 호출 가능한 행수를 초과" => limit 상한 초과
      if (msg.includes("HTTP 400") && msg.includes("페이지당 호출 가능한 행수")) {
        if (limit <= 5) {
          // 5도 안되면 더 줄일 수는 있지만, 보통 5는 통과함
          limit = Math.max(1, Math.floor(limit / 2));
        } else {
          limit = Math.max(5, Math.floor(limit / 2));
        }

        console.log(`⚠️ limit too high -> retry with limit=${limit}`);
        await sleep(150);
        continue;
      }

      throw e;
    }
  }
}

async function crawlRealPriceHistories({
  complexId,
  spaceSeq,
  fromDate = 202303,
  toDate = 202602,
  searchType = "SALE",
  limit = 5, // ✅ 기본값을 5로 (네가 성공한 값)
}) {
  const all = [];
  let page = 1;
  let total = null;

  while (true) {
    const r = await safeFetchPage({
      complexId,
      spaceSeq,
      fromDate,
      toDate,
      searchType,
      page,
      limit,
    });

    if (total === null) {
      total = r.total ?? 0;
      console.log("[INIT] total:", total, "limit:", r.limit);
    }

    const list = r.list ?? [];
    all.push(...list);

    console.log(
      `page ${page} -> got ${list.length}, cum=${all.length}, hasMore=${r.hasMore}`
    );

    if (!r.hasMore) break;

    page += 1;
    await sleep(250);
  }

  return { items: all, total };
}

async function main() {
  const complexId = "5db13b03e54e7f577bfde9424eb6";
  const spaceSeq = "217257";

  const { items, total } = await crawlRealPriceHistories({
    complexId,
    spaceSeq,
    fromDate: 202303,
    toDate: 202602,
    searchType: "SALE",
    limit: 5, // ✅ 여기 5로!
  });

  fs.writeFileSync(
    `dabang_realprice_${complexId}_${spaceSeq}_SALE.json`,
    JSON.stringify(
      { complexId, spaceSeq, total, count: items.length, items },
      null,
      2
    ),
    "utf-8"
  );

  console.log("✅ saved:", `dabang_realprice_${complexId}_${spaceSeq}_SALE.json`);
}

main()
  .then(() => console.log("DONE"))
  .catch((e) => {
    console.error("❌ ERROR:", e);
    // ✅ Windows에서 UV_HANDLE_CLOSING 같은 거 줄이려면 즉시 종료 대신 exitCode만 세팅
    process.exitCode = 1;
  });
