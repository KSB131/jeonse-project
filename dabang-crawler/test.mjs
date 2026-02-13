import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

/**
 * =========================
 * 환경 설정
 * =========================
 */
const DB = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const REGION_SIDO = process.env.REGION_SIDO || null;
const REGION_SIGUNGU = process.env.REGION_SIGUNGU || null;

// 광주 서구 bbox (네 서버 코드와 동일한 형태)
const BBOX = {
  sw: { lat: 35.0864879, lng: 126.7714733 },
  ne: { lat: 35.1839144, lng: 126.8947261 },
};

// (선택) 동 필터
const SEOGU_DONGS = new Set([
  "치평동","쌍촌동","농성동","화정동","풍암동","금호동","마륵동","유촌동",
  "내방동","동천동","서창동","매월동","벽진동","세하동","상무동",
]);

const CATEGORIES = [
  {
    key: "apt",
    endpoint: "https://www.dabangapp.com/api/v5/room-list/category/apt/bbox",
    referer: "https://www.dabangapp.com/map/apt",
  },
  {
    key: "house-villa",
    endpoint: "https://www.dabangapp.com/api/v5/room-list/category/house-villa/bbox",
    referer: "https://www.dabangapp.com/map/house-villa",
  },
  {
    key: "officetel",
    endpoint: "https://www.dabangapp.com/api/v5/room-list/category/officetel/bbox",
    referer: "https://www.dabangapp.com/map/officetel",
  },
];

// 기본 필터(네 코드와 유사)
const BASE_FILTERS = {
  sellingTypeList: ["MONTHLY_RENT", "LEASE"],
  tradeRange: { min: 0, max: 999999 },
  depositRange: { min: 0, max: 999999 },
  priceRange: { min: 0, max: 999999 },
  isIncludeMaintenance: false,
  pyeongRange: { min: 0, max: 999999 },
  useApprovalDateRange: { min: 0, max: 999999 },
  dealTypeList: ["AGENT", "DIRECT"],
  isShortLease: false,
  hasTakeTenant: false,
  householdNumRange: { min: 0, max: 999999 },
  parkingNumRange: { min: 0, max: 999999 },
};

function buildFilters(catKey) {
  if (catKey === "house-villa") {
    return {
      ...BASE_FILTERS,
      sellingTypeList: ["MONTHLY_RENT", "LEASE", "SELL"],
      roomFloorList: ["GROUND_FIRST", "GROUND_SECOND_OVER", "SEMI_BASEMENT", "ROOFTOP"],
      canParking: false,
      hasPano: false,
      hasElevator: false,
    };
  }
  if (catKey === "officetel") {
    return {
      ...BASE_FILTERS,
      sellingTypeList: ["MONTHLY_RENT", "LEASE", "SELL"],
      parkingNumRange: { min: 0, max: 999999 },
      canParking: false,
      hasElevator: false,
      hasPano: false,
    };
  }
  return { ...BASE_FILTERS };
}

const BASE_HEADERS = {
  accept: "application/json, text/plain, */*",
  "d-api-version": "5.0.0",
  "d-app-version": "1",
  "d-call-type": "web",
  "user-agent": "Mozilla/5.0",
};

/**
 * =========================
 * 유틸
 * =========================
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseKoreanMoneyToManwon(s) {
  if (s == null) return null;
  let str = String(s).replace(/,/g, "").trim();
  if (!str) return null;

  // "2억500" -> 20500(만원)
  const eokMatch = str.match(/(\d+)\s*억\s*(\d+)?/);
  if (eokMatch) {
    const eok = Number(eokMatch[1] || 0);
    const rest = Number(eokMatch[2] || 0);
    return eok * 10000 + rest;
  }

  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

function parseRoomDesc(desc) {
  const s = String(desc ?? "");
  const floor = (() => {
    const m = s.match(/(\d+)\s*층/);
    return m ? Number(m[1]) : null;
  })();
  const area = (() => {
    const m = s.match(/([\d.]+)\s*m²/i);
    return m ? Number(m[1]) : null;
  })();
  return { floor, area };
}

function normalizeDabangItem(it, catKey) {
  const { floor, area } = parseRoomDesc(it?.roomDesc);

  const priceTitle = String(it?.priceTitle ?? "");
  let deposit = null;
  let monthlyRent = 0;

  if (priceTitle.includes("/")) {
    const [depStr, rentStr] = priceTitle.split("/");
    deposit = parseKoreanMoneyToManwon(depStr);
    monthlyRent = parseKoreanMoneyToManwon(rentStr) ?? 0;
  } else {
    deposit = parseKoreanMoneyToManwon(priceTitle);
    monthlyRent = 0;
  }

  return {
    room_id: Number(it?.id),
    complex_id: it?.complexId != null ? Number(it.complexId) : null,
    category: catKey,

    room_type_name: it?.roomTypeName ?? null,
    complex_name: it?.complexName ?? null,
    room_title: it?.roomTitle ?? null,
    room_desc: it?.roomDesc ?? null,
    dong_name: it?.dongName ?? null,

    deposit_man: deposit,
    monthly_rent_man: monthlyRent,
    price_type_name: it?.priceTypeName ?? null,
    price_title: it?.priceTitle ?? null,

    exclu_use_ar: area,
    floor,
    build_year: null,

    lat: it?.randomLocation?.lat ?? null,
    lng: it?.randomLocation?.lng ?? null,

    img_url_list_json: JSON.stringify(it?.imgUrlList ?? []),
    raw_json: JSON.stringify(it ?? {}),
  };
}

/**
 * =========================
 * DB: 업서트
 * =========================
 */
async function upsertRooms(conn, rooms) {
  if (!rooms.length) return 0;

  // ⚠️ region_* 컬럼이 테이블에 없다면, 아래 3개 컬럼/값/UPDATE 구문에서 제거해줘.
  const sql = `
    INSERT INTO dabang_rooms (
      room_id, complex_id, category,
      room_type_name, complex_name, room_title, room_desc, dong_name,
      deposit_man, monthly_rent_man, price_type_name, price_title,
      exclu_use_ar, floor, build_year,
      lat, lng,
      img_url_list_json,
      raw_json,
      region_sido, region_sigungu, region_dong
    )
    VALUES ?
    ON DUPLICATE KEY UPDATE
      complex_id=VALUES(complex_id),
      category=VALUES(category),
      room_type_name=VALUES(room_type_name),
      complex_name=VALUES(complex_name),
      room_title=VALUES(room_title),
      room_desc=VALUES(room_desc),
      dong_name=VALUES(dong_name),
      deposit_man=VALUES(deposit_man),
      monthly_rent_man=VALUES(monthly_rent_man),
      price_type_name=VALUES(price_type_name),
      price_title=VALUES(price_title),
      exclu_use_ar=VALUES(exclu_use_ar),
      floor=VALUES(floor),
      build_year=VALUES(build_year),
      lat=VALUES(lat),
      lng=VALUES(lng),
      img_url_list_json=VALUES(img_url_list_json),
      raw_json=VALUES(raw_json),
      region_sido=VALUES(region_sido),
      region_sigungu=VALUES(region_sigungu),
      region_dong=VALUES(region_dong)
  `;

  const values = rooms.map((r) => [
    r.room_id, r.complex_id, r.category,
    r.room_type_name, r.complex_name, r.room_title, r.room_desc, r.dong_name,
    r.deposit_man, r.monthly_rent_man, r.price_type_name, r.price_title,
    r.exclu_use_ar, r.floor, r.build_year,
    r.lat, r.lng,
    r.img_url_list_json,
    r.raw_json,
    REGION_SIDO,
    REGION_SIGUNGU,
    r.dong_name ?? null, // region_dong은 dong_name으로 채움
  ]);

  // mysql2: VALUES ? 형태는 [ [row1], [row2] ... ] 를 한번 더 감싸야 함
  const [result] = await conn.query(sql, [values]);
  return result.affectedRows ?? 0;
}

/**
 * =========================
 * 크롤링
 * =========================
 */
async function fetchDabangRooms({ maxPages = 10, maxItems = 300, zoom = "13", useMap = "naver" }) {
  const seen = new Set();
  const results = [];

  for (const cat of CATEGORIES) {
    let page = 1;

    while (page <= maxPages && results.length < maxItems) {
      const filtersObj = buildFilters(cat.key);
      const params = new URLSearchParams({
        filters: JSON.stringify(filtersObj),
        bbox: JSON.stringify(BBOX),
        zoom: String(zoom),
        useMap: String(useMap),
        page: String(page),
      });

      const url = `${cat.endpoint}?${params.toString()}`;
      const headers = { ...BASE_HEADERS, referer: cat.referer };

      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.warn("[DABANG FAIL]", cat.key, resp.status, t.slice(0, 200));
        break;
      }

      const data = await resp.json().catch(() => null);
      if (!data || data?.code !== 200) {
        console.warn("[DABANG BAD]", cat.key, data?.code, data?.msg);
        break;
      }

      const r = data.result;
      const list = r?.roomList ?? [];
      console.log("[DABANG]", cat.key, "page", page, "got", list.length, "hasMore", r?.hasMore);

      for (const item of list) {
        const id = item?.id;
        if (!id) continue;
        if (seen.has(id)) continue;

        // (선택) 서구 동만
        const dong = item?.dongName ?? "";
        if (dong && SEOGU_DONGS.size && !SEOGU_DONGS.has(dong)) continue;

        seen.add(id);
        results.push(normalizeDabangItem(item, cat.key));
        if (results.length >= maxItems) break;
      }

      if (!r?.hasMore) break;
      page += 1;
      await sleep(150);
    }
  }

  return results;
}

/**
 * =========================
 * 실행
 * =========================
 */
async function main() {
  const maxPages = Number(process.argv.find(x => x.startsWith("--maxPages="))?.split("=")[1] ?? 10);
  const maxItems = Number(process.argv.find(x => x.startsWith("--maxItems="))?.split("=")[1] ?? 300);

  const conn = await mysql.createConnection(DB);
  console.log("[DB] connected:", DB.host, DB.database);

  const items = await fetchDabangRooms({ maxPages, maxItems });
  console.log("[CRAWL] total:", items.length);

  const affected = await upsertRooms(conn, items);
  console.log("[DB] upsert affectedRows:", affected);

  await conn.end();
  console.log("DONE");
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
