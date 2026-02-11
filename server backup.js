import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { spawn } from "child_process";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 정적 사이트 제공
app.use(express.static(path.join(__dirname, "public")));

app.use("/src", express.static(path.join(__dirname, "src")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

app.get("/map", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "map.html"));
});

/**
 * 국토교통부_아파트 전월세 실거래가 자료
 * EndPoint: https://apis.data.go.kr/1613000/RTMSDataSvcAptRent
 * 상세기능: /getRTMSDataSvcAptRent
 */
app.get("/api/apt-rent", async (req, res) => {
  try {
    const serviceKey = process.env.SERVICE_KEY;
    if (!serviceKey) {
      return res.status(500).json({ error: "SERVICE_KEY가 .env에 없습니다." });
    }

    // 예: LAWD_CD=11110(종로구), DEAL_YMD=202401
    const LAWD_CD = req.query.LAWD_CD?.toString()?.trim();
    const DEAL_YMD = req.query.DEAL_YMD?.toString()?.trim();
    const pageNo = req.query.pageNo?.toString() || "1";
    const numOfRows = req.query.numOfRows?.toString() || "50";

    if (!LAWD_CD || !DEAL_YMD) {
      return res.status(400).json({ error: "LAWD_CD, DEAL_YMD는 필수입니다." });
    }

    // 일반 인증키만 있어도 OK. (URL에 들어가므로 encodeURIComponent로 안전하게)
    const base = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent";
    const url =
      `${base}?serviceKey=${encodeURIComponent(serviceKey)}` +
      `&LAWD_CD=${encodeURIComponent(LAWD_CD)}` +
      `&DEAL_YMD=${encodeURIComponent(DEAL_YMD)}` +
      `&pageNo=${encodeURIComponent(pageNo)}` +
      `&numOfRows=${encodeURIComponent(numOfRows)}` +
      `&_type=json`;

    const resp = await fetch(url);
    const text = await resp.text();

    // JSON으로 오면 그대로 파싱, 혹시 에러로 XML이 오면 그대로 반환
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "응답이 JSON이 아닙니다(대개 인증키/파라미터 문제).",
        raw: text,
      });
    }

    // 공공API 표준 응답 구조
    const body = data?.response?.body;
    const items = body?.items?.item ?? [];
    const totalCount = body?.totalCount ?? 0;

    res.json({ totalCount, items });
  } catch (e) {
    res.status(500).json({ error: e?.message || "서버 오류" });
  }
});

app.get("/api/ml-risk", async (req, res) => {
  try {
    // 1) 너의 기존 데이터 소스 호출(서버 내부에서 함수로 호출하든, fetch로 자기 자신을 호출하든)
    const resp = await fetch(`http://localhost:${PORT}/api/dabang-rooms?maxPages=30&maxItems=800`);
    const data = await resp.json();
    const items = data.items ?? [];

    // 2) python predict.py 실행
    const py = spawn("python", ["ml/predict.py"], { stdio: ["pipe", "pipe", "pipe"] });

    let out = "";
    let err = "";

    py.stdout.on("data", (d) => (out += d.toString()));
    py.stderr.on("data", (d) => (err += d.toString()));

    py.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: "python predict failed", err });
      }
      try {
        const parsed = JSON.parse(out);
        // predictions를 map으로 바꿔서 items에 붙이기
        const mp = new Map(parsed.predictions.map(p => [String(p.id), p.risk_score]));
        const enriched = items.map(it => ({
          ...it,
          mlRiskScore: mp.get(String(it.id)) ?? null,
          mlRiskGrade:
            (mp.get(String(it.id)) ?? 0) >= 60 ? "위험" :
            (mp.get(String(it.id)) ?? 0) >= 30 ? "주의" : "안전"
        }));
        res.json({ model: parsed.model, totalCount: enriched.length, items: enriched });
      } catch (e) {
        res.status(500).json({ error: "bad python output", raw: out.slice(0, 500), err });
      }
    });

    py.stdin.write(JSON.stringify(items));
    py.stdin.end();
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});

/**
 * 국토교통부_오피스텔 전월세 실거래가 자료
 * Base URL: /1613000/RTMSDataSvcOffiRent
 * 상세기능: /getRTMSDataSvcOffiRent
 */
app.get("/api/offi-rent", async (req, res) => {
  try {
    const serviceKey = process.env.SERVICE_KEY;
    if (!serviceKey) return res.status(500).json({ error: "SERVICE_KEY가 .env에 없습니다." });

    const LAWD_CD = req.query.LAWD_CD?.toString()?.trim();
    const DEAL_YMD = req.query.DEAL_YMD?.toString()?.trim();
    const pageNo = req.query.pageNo?.toString() || "1";
    const numOfRows = req.query.numOfRows?.toString() || "50";

    if (!LAWD_CD || !DEAL_YMD) return res.status(400).json({ error: "LAWD_CD, DEAL_YMD는 필수입니다." });

    const base = "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent";
    const url =
      `${base}?serviceKey=${encodeURIComponent(serviceKey)}` +
      `&LAWD_CD=${encodeURIComponent(LAWD_CD)}` +
      `&DEAL_YMD=${encodeURIComponent(DEAL_YMD)}` +
      `&pageNo=${encodeURIComponent(pageNo)}` +
      `&numOfRows=${encodeURIComponent(numOfRows)}` +
      `&_type=json`;

    const resp = await fetch(url);
    const text = await resp.text();

    let data;
    try { data = JSON.parse(text); }
    catch {
      return res.status(502).json({ error: "응답이 JSON이 아닙니다(인증키/파라미터 문제 가능).", raw: text });
    }

    const body = data?.response?.body;
    const items = body?.items?.item ?? [];
    const totalCount = body?.totalCount ?? 0;

    res.json({ totalCount, items });
  } catch (e) {
    res.status(500).json({ error: e?.message || "서버 오류" });
  }
});


/**
 * 국토교통부_단독/다가구 전월세 실거래가 자료
 * Base URL: /1613000/RTMSDataSvcSHRent
 * 상세기능: /getRTMSDataSvcSHRent
 */
app.get("/api/sh-rent", async (req, res) => {
  try {
    const serviceKey = process.env.SERVICE_KEY;
    if (!serviceKey) return res.status(500).json({ error: "SERVICE_KEY가 .env에 없습니다." });

    const LAWD_CD = req.query.LAWD_CD?.toString()?.trim();
    const DEAL_YMD = req.query.DEAL_YMD?.toString()?.trim();
    const pageNo = req.query.pageNo?.toString() || "1";
    const numOfRows = req.query.numOfRows?.toString() || "50";

    if (!LAWD_CD || !DEAL_YMD) return res.status(400).json({ error: "LAWD_CD, DEAL_YMD는 필수입니다." });

    const base = "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent";
    const url =
      `${base}?serviceKey=${encodeURIComponent(serviceKey)}` +
      `&LAWD_CD=${encodeURIComponent(LAWD_CD)}` +
      `&DEAL_YMD=${encodeURIComponent(DEAL_YMD)}` +
      `&pageNo=${encodeURIComponent(pageNo)}` +
      `&numOfRows=${encodeURIComponent(numOfRows)}` +
      `&_type=json`;

    const resp = await fetch(url);
    const text = await resp.text();

    let data;
    try { data = JSON.parse(text); }
    catch {
      return res.status(502).json({ error: "응답이 JSON이 아닙니다(인증키/파라미터 문제 가능).", raw: text });
    }

    const body = data?.response?.body;
    const items = body?.items?.item ?? [];
    const totalCount = body?.totalCount ?? 0;

    res.json({ totalCount, items });
  } catch (e) {
    res.status(500).json({ error: e?.message || "서버 오류" });
  }
});

// ✅ 다방 매물(광주 bbox) 프록시
app.get("/api/dabang-rooms", async (req, res) => {
  try {
    // 광주 bbox (네가 성공한 값)
    const bbox = {
      sw: { lat: 35.0864879, lng: 126.7714733 },
      ne: { lat: 35.1839144, lng: 126.8947261 },
    };

    // ✅ 서구 동만 필터링 (원하면 여기 목록 조정)
    const SEOGU_DONGS = new Set([
      "치평동","쌍촌동","농성동","화정동","풍암동","금호동","마륵동","유촌동",
      "내방동","동천동","서창동","매월동","벽진동","세하동","상무동",
    ]);

    const ENDPOINT = "https://www.dabangapp.com/api/v5/room-list/category/apt/bbox";

    const filtersObj = {
      // ✅ 매매까지 필요 없으면 SELL 제거 (권장)
      sellingTypeList: ["MONTHLY_RENT", "LEASE"],
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

    // ✅ 지도에 너무 많이 찍으면 느려져서 기본 제한
    const MAX_PAGES = Number(req.query.maxPages ?? 30); // 필요하면 늘려
    const MAX_ITEMS = Number(req.query.maxItems ?? 800); // 필요하면 늘려
    const zoom = String(req.query.zoom ?? 13);
    const useMap = String(req.query.useMap ?? "naver");

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const seen = new Set();
    const results = [];

    let page = 1;
    let total = 0;

    while (page <= MAX_PAGES && results.length < MAX_ITEMS) {
      const params = new URLSearchParams({
        filters: JSON.stringify(filtersObj),
        bbox: JSON.stringify(bbox),
        zoom,
        useMap,
        page: String(page),
      });

      const url = `${ENDPOINT}?${params.toString()}`;
      const resp = await fetch(url, { headers });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return res.status(502).json({ error: `dabang http ${resp.status}`, raw: t.slice(0, 300) });
      }

      const data = await resp.json();
      if (data?.code !== 200) {
        return res.status(502).json({ error: `dabang api code=${data?.code}`, raw: data });
      }

      const r = data.result;
      total = r?.total ?? total;

      const list = r?.roomList ?? [];
      for (const item of list) {
        if (!item?.id) continue;
        if (seen.has(item.id)) continue;

        // ✅ 광주 서구만 남기기
        const dong = item?.dongName ?? "";
        if (dong && !SEOGU_DONGS.has(dong)) continue;

        seen.add(item.id);

        // ✅ 프론트(map.js)에서 바로 쓰기 좋게 "공공데이터 비슷한 필드"로 정규화
        const normalized = normalizeDabangItem(item);
        results.push(normalized);
      }

      if (!r?.hasMore) break;
      page += 1;
      await sleep(150);
    }

    res.json({ totalCount: results.length, items: results });
  } catch (e) {
    res.status(500).json({ error: e?.message || "서버 오류" });
  }
});

app.get("/api/dabang/overview", async (req, res) => {
  const { complexId } = req.query;
  if (!complexId) return res.status(400).json({ error: "complexId required" });

  const url = `https://www.dabangapp.com/api/v5/overview?complexId=${encodeURIComponent(complexId)}`;
  const resp = await fetch(url, { headers: DABANG_HEADERS });
  const text = await resp.text();
  res.status(resp.status).send(text);
});

app.get("/api/dabang/histories", async (req, res) => {
  const { complexId, page = "1", limit = "5" } = req.query;
  if (!complexId) return res.status(400).json({ error: "complexId required" });

  const url = `https://www.dabangapp.com/api/v5/histories?complexId=${encodeURIComponent(complexId)}&page=${page}&limit=${limit}`;
  const resp = await fetch(url, { headers: DABANG_HEADERS });
  const text = await resp.text();
  res.status(resp.status).send(text);
});

// ✅ 다방 매물 상세(room_id) 프록시
app.get("/api/dabang-room-detail", async (req, res) => {
  try {
    const roomId = String(req.query.room_id ?? "").trim();
    if (!roomId) return res.status(400).json({ error: "room_id is required" });

    const url =
      `https://www.dabangapp.com/api/3/new-room/detail` +
      `?room_id=${encodeURIComponent(roomId)}` +
      `&api_version=3.0.1&call_type=web&version=1`;

    // ✅ 쿠키/CSRF 없이 먼저 시도 (대부분 OK)
    const headers = {
      accept: "application/json, text/plain, */*",
      "user-agent": "Mozilla/5.0",
      referer: "https://www.dabangapp.com/map/apt",
    };

    const resp = await fetch(url, { headers });
    const text = await resp.text();

    if (!resp.ok) {
      return res.status(502).json({
        error: `dabang detail http ${resp.status}`,
        raw: text.slice(0, 300),
      });
    }

    // JSON 그대로 전달
    res.type("application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});

// ---- 아래 유틸 함수도 server.js 하단에 같이 추가 ----

// "1억6700" / "4700" / "2000/100" 같은 가격을 "만원" 단위 숫자로 변환
function parseKoreanMoneyToManwon(s) {
  if (s == null) return null;
  let str = String(s).replace(/,/g, "").trim();
  if (!str) return null;

  // "1억6700" => 10000 + 6700 = 16700(만원)
  const eokMatch = str.match(/(\d+)\s*억\s*(\d+)?/);
  if (eokMatch) {
    const eok = Number(eokMatch[1] || 0);
    const rest = Number(eokMatch[2] || 0);
    return eok * 10000 + rest;
  }

  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

// roomDesc 예: "6층, 105.88m², 관리비 17만"
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

// 다방 원본 -> map.js/computeRisk가 쓰기 좋은 형태로 변환
function normalizeDabangItem(it) {
  const { floor, area } = parseRoomDesc(it?.roomDesc);

  // priceTitle 예: "2000/100" or "4700" or "1억6700"
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
    // ✅ 공공데이터랑 비슷한 필드명(너 computeRisk가 바로 먹음)
    deposit,                // 만원
    monthlyRent,            // 만원
    excluUseAr: area,       // ㎡
    floor,                  // 층
    buildYear: null,        // 리스트 API엔 없어서 null(추후 상세 API로 보강 가능)
    roomId: it?.id,                 // ✅ 이미 id가 방(매물) id
    complexId: it?.complexId ?? null, // ✅ list에 있으면 그대로 넣기 (없으면 DevTools에서 필드명 확인)

    // ✅ 지도 표시용
    id: it?.id,
    roomTypeName: it?.roomTypeName,
    complexName: it?.complexName,
    roomTitle: it?.roomTitle,
    roomDesc: it?.roomDesc,
    priceTypeName: it?.priceTypeName,
    priceTitle: it?.priceTitle,
    dongName: it?.dongName,
    imgUrlList: it?.imgUrlList ?? [],

    // ✅ 좌표 (프론트에서 지오코딩 없이 바로 마커 가능)
    lat: it?.randomLocation?.lat ?? null,
    lng: it?.randomLocation?.lng ?? null,
  };
}

// ✅ 다방 단지/평형 실거래가(매매) 프록시
app.get("/api/dabang-realprice", async (req, res) => {
  try {
    const complexId = String(req.query.complexId ?? "").trim();
    const spaceSeq = String(req.query.spaceSeq ?? "").trim();

    // 기본값(필요시 프론트에서 조절 가능)
    const fromDate = String(req.query.fromDate ?? "202303");
    const toDate = String(req.query.toDate ?? "202602");
    const searchType = String(req.query.searchType ?? "SALE"); // SALE=매매
    const page = String(req.query.page ?? "1");
    const limit = String(req.query.limit ?? "5"); // ✅ 상한 있으니 5 권장

    if (!complexId || !spaceSeq) {
      return res.status(400).json({ error: "complexId, spaceSeq are required" });
    }

    const url =
      `https://www.dabangapp.com/api/v5/real-price/complex/histories` +
      `?complexId=${encodeURIComponent(complexId)}` +
      `&spaceSeq=${encodeURIComponent(spaceSeq)}` +
      `&fromDate=${encodeURIComponent(fromDate)}` +
      `&toDate=${encodeURIComponent(toDate)}` +
      `&searchType=${encodeURIComponent(searchType)}` +
      `&page=${encodeURIComponent(page)}` +
      `&limit=${encodeURIComponent(limit)}`;

    const headers = {
      accept: "application/json, text/plain, */*",
      "d-api-version": "5.0.0",
      "d-app-version": "1",
      "d-call-type": "web",
      referer: "https://www.dabangapp.com/map/apt",
      "user-agent": "Mozilla/5.0",
    };

    const resp = await fetch(url, { headers });
    const text = await resp.text();

    if (!resp.ok) {
      return res.status(resp.status).send(text);
    }
    res.type("application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});


app.listen(PORT, () => {
  console.log(`✅ http://localhost:${PORT} 에서 실행 중`);
});
