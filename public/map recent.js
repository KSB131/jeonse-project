/* =========================
   ✅ Risk / Helpers
========================= */
let __SUPPRESS_IDLE_RERENDER = false;

function setCenterSilently(latlng, level = null) {
  __SUPPRESS_IDLE_RERENDER = true;
  if (level != null) map.setLevel(level);
  map.setCenter(latlng);

  // 다음 idle 한두 번은 무시되도록 짧게 유지
  setTimeout(() => {
    __SUPPRESS_IDLE_RERENDER = false;
  }, 350);
}

function roomTypeLabel(it) {
  const raw =
    it?.room_type_str ??
    it?.roomTypeStr ??
    it?.roomTypeName ??
    it?.roomType ??
    it?.room_type_name ??
    it?.roomTitle ??
    "";

  const s = String(raw).trim();
  if (!s) return null;

  // 괄호 앞만 추출: "원룸(분리형)" -> "원룸"
  return s.split("(")[0].trim();
}


// "12,345" → 12345
function toNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base];
  const b = sorted[Math.min(base + 1, sorted.length - 1)];
  return a + (b - a) * rest;
}

function buildMlThresholds(items) {
  const scores = items
    .map((it) => Number(it.mlRiskScore))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!scores.length) return { tCaution: 55, tDanger: 75 };

  let tCaution = quantile(scores, 0.7);
  let tDanger = quantile(scores, 0.9);

  if (tDanger - tCaution < 8) tDanger = tCaution + 8;

  tCaution = Math.max(0, Math.min(100, tCaution));
  tDanger = Math.max(0, Math.min(100, tDanger));

  return { tCaution, tDanger };
}

function gradeFromMlScore(score, thresholds) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "안전";
  if (s >= thresholds.tDanger) return "위험";
  if (s >= thresholds.tCaution) return "주의";
  return "안전";
}

// ✅ 거리 계산 (Haversine) - km 단위
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function filterByRadius(items, centerLat, centerLng, radiusKm) {
  return items
    .filter((it) => {
      if (it.lat == null || it.lng == null) return false;
      const d = haversineKm(centerLat, centerLng, Number(it.lat), Number(it.lng));
      it.__distKm = d;
      return d <= radiusKm;
    })
    .sort((a, b) => (a.__distKm ?? 999) - (b.__distKm ?? 999));
}

function limitClosest(items, n = 10) {
  return items.slice(0, n);
}

function limitByCategory(items, perCat = 10) {
  const counts = { apt: 0, "house-villa": 0, officetel: 0 };
  const out = [];

  for (const it of items) {
    const k = it.category;
    if (!(k in counts)) continue;
    if (counts[k] >= perCat) continue;

    counts[k] += 1;
    out.push(it);

    if (
      counts.apt >= perCat &&
      counts["house-villa"] >= perCat &&
      counts.officetel >= perCat
    )
      break;
  }

  return { items: out, counts };
}

// 유사 면적 그룹(± 3㎡)의 보증금(만원)들을 모아서 중앙값
function getPeerDepositMedianFromRtms(rtms, target) {
  const tArea = toNumber(target.excluUseAr);
  const tDep = toNumber(target.deposit);
  if (tArea == null || tDep == null) return { med: null, n: 0, scope: "none" };

  const kind =
    target.category === "officetel"
      ? "offi"
      : target.category === "house-villa"
      ? "house"
      : "apt";

  const pool = rtms?.items?.[kind] ?? [];
  const deps = [];

  for (const it of pool) {
    const area = Number(it.area);
    const dep = Number(it.deposit);
    if (!Number.isFinite(area) || !Number.isFinite(dep)) continue;
    if (Math.abs(area - tArea) <= 3) deps.push(dep);
  }

  return { med: median(deps), n: deps.length, scope: `rtms:${kind}` };
}

function getPeerDepositMedianAny(allItems, target) {
  if (window.__RTMS_COMPARE) return getPeerDepositMedianFromRtms(window.__RTMS_COMPARE, target);

  const tArea = toNumber(target.excluUseAr);
  const tDep = toNumber(target.deposit);
  if (tArea == null || tDep == null) return { med: null, n: 0, scope: "none" };

  const deps = [];
  for (const it of allItems) {
    const area = toNumber(it.excluUseAr);
    const dep = toNumber(it.deposit);
    if (area == null || dep == null) continue;
    if (Math.abs(area - tArea) <= 3) deps.push(dep);
  }
  return { med: median(deps), n: deps.length, scope: "local" };
}

function buildMlReasonStats(items) {
  const vals = { depPerSqm: [], ratioToPeer: [] };

  for (const it of items) {
    const deposit = Number(it.deposit);
    const area = Number(it.excluUseAr);
    const depPerSqm =
      Number.isFinite(deposit) && Number.isFinite(area) && area > 0 ? deposit / area : null;
    if (Number.isFinite(depPerSqm)) vals.depPerSqm.push(depPerSqm);
  }

  for (const it of items) {
    const peer = getPeerDepositMedianAny(items, it);
    const dep = Number(it.deposit);
    const ratio =
      Number.isFinite(dep) && Number.isFinite(peer?.med) && peer.med > 0 ? dep / peer.med : null;
    if (Number.isFinite(ratio)) vals.ratioToPeer.push(ratio);
  }

  function stat(arr) {
    const a = [...arr].sort((x, y) => x - y);
    if (!a.length) return { med: null, q25: null, q75: null, iqr: null };
    const q25 = quantile(a, 0.25);
    const med = quantile(a, 0.5);
    const q75 = quantile(a, 0.75);
    const iqr = q75 != null && q25 != null ? q75 - q25 : null;
    return { med, q25, q75, iqr };
  }

  return {
    depPerSqm: stat(vals.depPerSqm),
    ratioToPeer: stat(vals.ratioToPeer),
  };
}
function newPremiumFactor(it){
  const nowYear = 2026; // 또는 new Date().getFullYear()
  const by = toNumber(it.buildYear);
  if (!Number.isFinite(by)) return 1.0;
  const age = nowYear - by;
  if (age < 0) return 1.0;

  // 0년:0.35, 1년:0.48, 2년:0.61, 3년:0.74, 4년:0.87, 5년+:1.0 (선형)
  const f = 0.35 + (Math.min(age, 5) / 5) * (1.0 - 0.35);
  return Math.min(1.0, Math.max(0.35, f));
}

function buildMlReasonsForItem(it, allItems, stats, thresholds) {
  const reasons = [];

  const scoreForGrade = Number(it.finalRiskScore ?? it.mlRiskScore);
  const grade = gradeFromFinalScore(scoreForGrade);

  const deposit = toNumber(it.deposit);
  const monthlyRent = toNumber(it.monthlyRent);
  const area = toNumber(it.excluUseAr);

  const rentType = monthlyRent != null && monthlyRent > 0 ? "월세" : "전세";
  const depPerSqm = deposit != null && area != null && area > 0 ? deposit / area : null;

  const peer = getPeerDepositMedianAny(allItems, it);
  const peerMed = peer?.med ?? null;
  const peerN = peer?.n ?? 0;
  const ratioToPeer = deposit != null && peerMed != null && peerMed > 0 ? deposit / peerMed : null;

  // ✅ 신축 프리미엄 계수 (신축일수록 1보다 작아져서 "비쌈 패널티"를 깎음)
  const premium = newPremiumFactor(it);

  if (grade === "안전") {
    if (!peerN || peerN < 10 || peerMed == null) {
      reasons.push({ rule: `비교 표본 부족 (표본 ${peerN ?? 0}건)`, points: 10 });
    } else {
      reasons.push({ rule: `비교 표본 충분 (표본 ${peerN}건)`, points: 6 });
    }
    return reasons;
  }

  // ✅ ratioToPeer 룰은 여기 “한 번만”
  if (ratioToPeer != null) {
    if (ratioToPeer >= 1.35) {
      const base = 30;
      const pts = Math.round(base * premium); // ✅ 신축일수록 크게 깎임
      reasons.push({
        rule: premium < 1.0
          ? `유사 면적 대비 전세금이 높지만 신축 프리미엄 고려 (${ratioToPeer.toFixed(2)}x)`
          : `유사 면적 대비 전세금이 매우 높음 (${ratioToPeer.toFixed(2)}x)`,
        points: pts,
      });
    } else if (ratioToPeer >= 1.2) {
      const base = 22;
      const pts = Math.round(base * premium);
      reasons.push({
        rule: premium < 1.0
          ? `유사 면적 대비 전세금이 다소 높으나 신축 프리미엄 고려 (${ratioToPeer.toFixed(2)}x)`
          : `유사 면적 대비 전세금이 높음 (${ratioToPeer.toFixed(2)}x)`,
        points: pts,
      });
    } else if (ratioToPeer <= 0.8) {
      // ✅ 너무 쌈은 신축이어도 위험 신호일 수 있으니 premium 적용 X (권장)
      reasons.push({
        rule: `유사 면적 대비 전세금이 비정상적으로 낮음 (${ratioToPeer.toFixed(2)}x)`,
        points: 18,
      });
    } else if (ratioToPeer <= 0.9) {
      reasons.push({
        rule: `유사 면적 대비 전세금이 낮은 편 (${ratioToPeer.toFixed(2)}x)`,
        points: 10,
      });
    }
  } else {
    reasons.push({ rule: "유사 면적 시세 비교 불가(표본/데이터 부족)", points: 14 });
  }

  // ✅ 면적 대비 전세금(보증금/㎡)도 “비쌈” 쪽만 신축 완화 살짝 적용(선택)
  if (depPerSqm != null && stats?.depPerSqm?.q75 != null && stats?.depPerSqm?.q25 != null) {
    const q75 = stats.depPerSqm.q75;
    const q25 = stats.depPerSqm.q25;

    if (depPerSqm >= q75 * 1.1) {
      const base = 16;
      const pts = Math.round(base * premium); // ✅ 비쌈만 신축 완화
      reasons.push({ rule: `면적 대비 전세금이 높음 (보증금/㎡ ${depPerSqm.toFixed(1)})`, points: pts });
    } else if (depPerSqm <= q25 * 0.9) {
      reasons.push({ rule: `면적 대비 전세금이 낮음 (보증금/㎡ ${depPerSqm.toFixed(1)})`, points: 10 });
    }
  }

  if (!peerN || peerN < 10) {
    reasons.push({ rule: `비교 표본이 적어 판단 신뢰도 낮음 (표본 ${peerN ?? 0}건)`, points: 8 });
  }

  if (rentType === "월세") {
    reasons.push({ rule: "월세 포함 계약(전세사기 신호로는 약함)", points: 2 });
  }

  return reasons.sort((a, b) => b.points - a.points).slice(0, 4);
}



/* =========================
   Marker (SVG)
========================= */
const markerImageCache = new Map();

function svgMarker(fill, label) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
    <path d="M15 1C8.4 1 3 6.4 3 13c0 9.2 12 28 12 28s12-18.8 12-28C27 6.4 21.6 1 15 1z"
          fill="${fill}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
    <circle cx="15" cy="13" r="6.2" fill="white" fill-opacity="0.95"/>
    <text x="15" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="#333">${label || ""}</text>
  </svg>`;
}

function getMarkerImageByGrade(grade, label = "") {
  const fill = grade === "위험" ? "#E53935" : grade === "주의" ? "#F9A825" : "#43A047";
  const key = `${grade}:${label}:${fill}`;
  if (markerImageCache.has(key)) return markerImageCache.get(key);

  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarker(fill, label));
  const size = new kakao.maps.Size(30, 42);
  const option = { offset: new kakao.maps.Point(15, 40) };

  const img = new kakao.maps.MarkerImage(src, size, option);
  markerImageCache.set(key, img);
  return img;
}

/* =========================
   Map init
========================= */
const mapContainer = document.getElementById("map");
const mapOption = {
  center: new kakao.maps.LatLng(35.15507, 126.85701),
  level: 5,
};
const map = new kakao.maps.Map(mapContainer, mapOption);
const geocoder = new kakao.maps.services.Geocoder();
const places = new kakao.maps.services.Places(); // ✅ 추가

let myLocationMarker = null;
let addressMarker = null;

const infoEl = document.getElementById("info");

// ✅ UI 요소
const sidebarEl = document.getElementById("sidebar");
const handleBtn = document.getElementById("sidebarHandle");
const closeBtn = document.getElementById("sidebarClose");

// ✅ 현재 열린 인포윈도우 추적(지도 클릭 2단계 동작용)
let activeInfoWindow = null;

// ✅ 초기 상태
sidebarEl?.classList.add("collapsed");

/* =========================
   Sidebar / Dock UI Sync (ONLY)
========================= */

const toolDock = document.getElementById("toolDock");
const searchToggle = document.getElementById("searchToggle");
const filterToggle = document.getElementById("filterToggle");

function syncCollapsedClass() {
  if (!sidebarEl) return;
  const isCollapsed = sidebarEl.classList.contains("collapsed");
  document.body.classList.toggle("sb-collapsed", isCollapsed);
}

function openSidebar() {
  sidebarEl?.classList.remove("collapsed");
  syncCollapsedClass();
}

function closeSidebar() {
  sidebarEl?.classList.add("collapsed");
  syncCollapsedClass();
}

handleBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  openSidebar();
});

closeBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  closeSidebar();
});

// 🔍 검색 토글
searchToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  toolDock?.classList.toggle("collapsed-search");
  if (toolDock && !toolDock.classList.contains("collapsed-search")) {
    setTimeout(() => document.getElementById("address")?.focus(), 0);
  }
});

// ⚙️ 필터 토글
filterToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  toolDock?.classList.toggle("collapsed-filter");
});

// 패널 클릭 전파 방지
toolDock?.addEventListener("click", (e) => e.stopPropagation());
sidebarEl?.addEventListener("click", (e) => e.stopPropagation());

// ✅ 초기 동기화
syncCollapsedClass();

// ✅ 지도 클릭: 1번=인포윈도우 닫기, 2번=사이드바 접기
kakao.maps.event.addListener(map, "click", () => {
  if (activeInfoWindow) {
    activeInfoWindow.close();
    activeInfoWindow = null;
    clearTempSearchMarker();
    return;
  }
  closeSidebar();
});

/* =========================
   Geo / Address Search
========================= */

let MY_POS = null; // ✅ 전역 유지
const RADIUS_KM = 1.5;

// ✅ 내 위치 고정(광주학생독립운동기념관 근처)
const FIXED_MY_POS = { lat: 35.15507, lng: 126.85701 };

// ✅ 지도 중심을 기준으로 필터링할지 여부
let USE_MAP_CENTER_AS_ORIGIN = true;

// ✅ 현재 반경 기준 좌표(= 지도 중심)
let ORIGIN_POS = null; // {lat, lng}

// ✅ 항상 고정 위치로 세팅 + 마커 표시
(function setFixedMyLocation() {
  MY_POS = { ...FIXED_MY_POS };

  const myPosition = new kakao.maps.LatLng(MY_POS.lat, MY_POS.lng);
  map.setCenter(myPosition);

  if (myLocationMarker) myLocationMarker.setMap(null);

  myLocationMarker = new kakao.maps.Marker({ map, position: myPosition });

  const infoWindow = new kakao.maps.InfoWindow({
    content: "<div style='padding:5px;'>📍 현재 내 위치</div>",
  });
  infoWindow.open(map, myLocationMarker);

  // ✅ “지금 즉시” 말고, 콜스택 끝나고 실행(= 아래 let 초기화 끝난 뒤)
  setTimeout(() => loadAptRentToMap(), 0);
})();

// ✅ 검색(주소/키워드/건물명/상호명/동명) → "내 매물"을 찾아 마커로 표시
window.searchAddress = async function searchAddress() {
  const q = String(document.getElementById("address")?.value ?? "").trim();
  if (!q) return alert("검색어를 입력하세요.");

  const qNorm = normAddrKeepGu(q);

  const needRoad = isRoadQuery(q);
  const needJibun = isJibunQuery(q);

  // ✅ 점수화: "더 구체적"일수록 점수가 높아지게
  function scoreKeyMatch(qNorm, keyNorm) {
    if (!qNorm || !keyNorm) return -1;

    // 1) 완전일치 최우선
    if (qNorm === keyNorm) return 10000 + keyNorm.length;

    // 2) 도로명/지번 검색은 includes 금지 (짧은 것에 낚이는 문제 원천 차단)
    if (needRoad || needJibun) return -1;

    // 3) 일반(단지명 포함) 검색은 포함 허용하되 "긴 쪽"이 우선
    //    q가 더 길수록(= 더 구체적일수록) 가점
    if (keyNorm.includes(qNorm)) return 3000 + qNorm.length;
    if (qNorm.includes(keyNorm)) return 1000 + keyNorm.length;

    return -1;
  }

  // ✅ 1) 현재 지도 마커에서 "최고점" 찾기
  let bestMarker = null;
  let bestScore = -1;

  // 1-A) 빠른 키(동+단지명)로 먼저 점수화
  for (const m of markers) {
    const it = m.__item;
    if (!it) continue;

    const quickKey = normAddrKeepGu(`광주 서구 ${it.dongName ?? ""} ${it.complexName ?? ""}`);
    const s = scoreKeyMatch(qNorm, quickKey);

    if (s > bestScore) {
      bestScore = s;
      bestMarker = m;
    }
  }

  // 1-B) 도로명/지번이면 detail 키로 "완전일치만" 비교 (includes 금지)
  if (!bestMarker && (needRoad || needJibun)) {
    for (const m of markers) {
      const it = m.__item;
      if (!it) continue;

      const keys = await ensureItemSearchKeys(it);
      const targetKey = needRoad ? keys.roadKey : keys.jibunKey;

      if (targetKey && qNorm === targetKey) {
        bestMarker = m;
        bestScore = 20000 + targetKey.length;
        break;
      }
    }
  } else {
    // 1-C) 일반 검색이면 detail 키도 점수 경쟁에 포함(구체적인게 이김)
    for (const m of markers) {
      const it = m.__item;
      if (!it) continue;

      const keys = await ensureItemSearchKeys(it);

      // nameKey(동+단지명)
      if (keys.nameKey) {
        const s = scoreKeyMatch(qNorm, keys.nameKey);
        if (s > bestScore) { bestScore = s; bestMarker = m; }
      }

      // 도로/지번은 일반 검색에서도 "정확히 입력했을 때"만 강하게
      if (keys.roadKey && qNorm === keys.roadKey) {
        const s = 20000 + keys.roadKey.length;
        if (s > bestScore) { bestScore = s; bestMarker = m; }
      }
      if (keys.jibunKey && qNorm === keys.jibunKey) {
        const s = 20000 + keys.jibunKey.length;
        if (s > bestScore) { bestScore = s; bestMarker = m; }
      }
    }
  }

  if (bestMarker && bestScore >= 0) {
    kakao.maps.event.trigger(bestMarker, "click");
    return;
  }

  // ✅ 2) 현재 지도 마커에 없으면 → 전체 데이터에서 찾아서 임시 렌더 후 열기
  try {
    const all = await ensureDatasetLoaded();

    // 동 필터(있으면)
    const mDong = q.match(/([가-힣]+동)/);
    const dongInQuery = mDong?.[1] ?? null;

    let candidates = all;
    if (dongInQuery) {
      candidates = all.filter((x) => String(x.dongName ?? "").includes(dongInQuery));
    }

    // 2-A) quickKey 점수 경쟁
    let bestItem = null;
    let bestItemScore = -1;

    for (const it of candidates) {
      const quickKey = normAddrKeepGu(`광주 서구 ${it.dongName ?? ""} ${it.complexName ?? ""}`);
      const s = scoreKeyMatch(qNorm, quickKey);
      if (s > bestItemScore) { bestItemScore = s; bestItem = it; }
    }

    // 2-B) 지번/도로명 입력이면 detail 키 "완전일치" 우선으로만 탐색
    if (needRoad || needJibun) {
      const pool = candidates.slice(0, 500);
      for (const it of pool) {
        const keys = await ensureItemSearchKeys(it);
        const targetKey = needRoad ? keys.roadKey : keys.jibunKey;

        if (targetKey && qNorm === targetKey) {
          bestItem = it;
          bestItemScore = 20000 + targetKey.length;
          break;
        }
      }
    } else {
      // 2-C) 일반 검색이면 detail 키들도 점수 경쟁에 포함
      const pool = candidates.slice(0, 300); // 시연용: 너무 무겁지 않게
      for (const it of pool) {
        const keys = await ensureItemSearchKeys(it);

        if (keys.nameKey) {
          const s = scoreKeyMatch(qNorm, keys.nameKey);
          if (s > bestItemScore) { bestItemScore = s; bestItem = it; }
        }
        if (keys.roadKey && qNorm === keys.roadKey) {
          const s = 20000 + keys.roadKey.length;
          if (s > bestItemScore) { bestItemScore = s; bestItem = it; }
        }
        if (keys.jibunKey && qNorm === keys.jibunKey) {
          const s = 20000 + keys.jibunKey.length;
          if (s > bestItemScore) { bestItemScore = s; bestItem = it; }
        }
      }
    }

    if (bestItem && bestItemScore >= 0) {
      await openItemAsClicked(bestItem);
      return;
    }
  } catch (e) {
    console.warn(e);
  }

  alert("일치하는 매물을 찾지 못했습니다.");
};


/* =========================
   Markers
========================= */
let markers = [];
let infoWindows = [];

function clearMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
  infoWindows.forEach((iw) => iw.close());
  infoWindows = [];
  activeInfoWindow = null;
}

/* =========================
   API fetch
========================= */
async function fetchDabangRoomDetail(roomId) {
  const resp = await fetch(`/api/dabang-room-detail?room_id=${encodeURIComponent(roomId)}`);
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`detail fetch failed: ${resp.status}\n${t.slice(0, 200)}`);
  }
  return resp.json();
}

function normAddr(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")                 // 괄호 내용 제거(주상복합 등)
    .replace(/광주광역시/g, "광주")
    .replace(/광주시/g, "광주")
    .replace(/특별시|광역시|자치시|도|시|군|구/g, (m) => {
      // ✅ "서구" 같은 '구'는 중요해서 제거하면 안 됨 → 여기서 '구' 제거는 하지 않음
      // 그래서 위 정규식에서 '구'를 빼야 함. 아래 라인 그대로 두지 말고,
      return m;
    })
    .replace(/[^\p{L}\p{N}-]+/gu, "")        // 한글/숫자/하이픈만 남김
    .trim();
}

// ✅ 위에서 '구' 제거하면 안되니, 다시 안전하게: 구는 유지 버전
function normAddrKeepGu(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/광주광역시/g, "광주")
    .replace(/광주시/g, "광주")
    .replace(/특별시|광역시|자치시|도|시|군/g, "") // ✅ '구'는 제거하지 않음
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .trim();
}

function isRoadQuery(q) {
  return /로|길/.test(String(q));
}
function isJibunQuery(q) {
  // "970-6" / "970" 같이 숫자 중심(지번) 검색
  return /\d/.test(String(q)) && !isRoadQuery(q);
}

// detail에서 지번/도로명 문자열을 최대한 뽑아내기(구조가 달라도 대응)
function pickAddrStringsFromDetail(detail) {
  const out = { jibun: null, road: null, complex: null };

  const room = detail?.room ?? detail?.result?.room ?? null;
  const complex = detail?.complex ?? detail?.result?.complex ?? null;

  // 단지명
  out.complex =
    complex?.complex_name ??
    room?.complex_name ??
    room?.complexName ??
    complex?.name ??
    null;

  // 지번(일반주소) 후보
  const jibunCandidates = [
    room?.address,
    room?.addr,
    room?.jibun_address,
    room?.jibunAddress,
    room?.address_jibun,
    room?.addressJibun,
  ].filter((v) => typeof v === "string" && v.trim());

  // 도로명 후보
  const roadCandidates = [
    room?.road_address,
    room?.roadAddress,
    room?.address_road,
    room?.addressRoad,
    room?.new_address,
    room?.newAddress,
  ].filter((v) => typeof v === "string" && v.trim());

  // 후보가 없으면: detail 안에서 address 키를 훑어 "로/길" 포함은 도로명, "동+숫자"는 지번으로 추정
  if (!jibunCandidates.length || !roadCandidates.length) {
    const seen = new Set();
    (function walk(obj) {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string") {
          const s = v.trim();
          if (!s || seen.has(s)) continue;
          seen.add(s);

          if (!out.road && /로|길/.test(s)) out.road = s;
          if (!out.jibun && /동/.test(s) && /\d/.test(s) && !/로|길/.test(s)) out.jibun = s;
        } else if (v && typeof v === "object") {
          walk(v);
        }
      }
    })(detail);
  }

  if (!out.jibun && jibunCandidates.length) out.jibun = jibunCandidates[0];
  if (!out.road && roadCandidates.length) out.road = roadCandidates[0];

  return out;
}

// ✅ 마커의 it에 (단지명/지번/도로명) 검색키를 캐시해둔다
async function ensureItemSearchKeys(it) {
  if (it.__searchKeys) return it.__searchKeys;

  try {
    const detail = await fetchDabangRoomDetail(it.id);
    const a = pickAddrStringsFromDetail(detail);

    const dong = it?.dongName ?? ""; // 이미 너 데이터에 있음(쌍촌동 등)
    const complexName = a.complex ?? it?.complexName ?? "";

    const nameKey = normAddrKeepGu(`광주 서구 ${dong} ${complexName}`);
    const jibunKey = a.jibun ? normAddrKeepGu(a.jibun) : "";
    const roadKey = a.road ? normAddrKeepGu(a.road) : "";

    it.__searchKeys = { nameKey, jibunKey, roadKey, complexNameRaw: complexName, jibunRaw: a.jibun, roadRaw: a.road };
    return it.__searchKeys;
  } catch (e) {
    // detail 실패해도 nameKey 정도는 만들자
    const dong = it?.dongName ?? "";
    const complexName = it?.complexName ?? "";
    it.__searchKeys = {
      nameKey: normAddrKeepGu(`광주 서구 ${dong} ${complexName}`),
      jibunKey: "",
      roadKey: "",
      complexNameRaw: complexName,
      jibunRaw: null,
      roadRaw: null,
    };
    return it.__searchKeys;
  }
}

function isMatch(qNorm, keyNorm) {
  if (!qNorm || !keyNorm) return false;
  // ✅ 완전일치만 강하게 인정
  if (qNorm === keyNorm) return true;

  // ✅ 포함 매칭은 "짧은 쪽이 너무 짧으면" 금지
  // (예: "광주서구금호동" 같은 것만으로는 통과시키지 않음)
  const minLen = 10; // 시연용: 너무 짧은 키로는 매칭 금지(원하면 8~14 조절)
  if (keyNorm.length < minLen || qNorm.length < minLen) return false;

  return keyNorm.includes(qNorm) || qNorm.includes(keyNorm);
}


async function fetchRealPriceTop({
  complexId,
  spaceSeq,
  fromDate = "202303",
  toDate = "202602",
  searchType = "SALE",
  maxItems = 60,
}) {
  const all = [];
  let page = 1;
  const limit = 20;

  while (all.length < maxItems) {
    const url =
      `/api/dabang-realprice?complexId=${encodeURIComponent(complexId)}` +
      `&spaceSeq=${encodeURIComponent(spaceSeq)}` +
      `&fromDate=${encodeURIComponent(fromDate)}` +
      `&toDate=${encodeURIComponent(toDate)}` +
      `&searchType=${encodeURIComponent(searchType)}` +
      `&page=${page}&limit=${limit}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data?.code !== 200) {
      throw new Error(`realprice api error: code=${data?.code} msg=${data?.msg}`);
    }

    const r = data.result;
    const list = r?.list ?? [];
    all.push(...list);

    if (!r?.hasMore) break;
    page += 1;
  }

  return all;
}

async function fetchDataset() {
  const url = `/api/ml-risk?maxPages=30&maxItems=800`;
  const resp = await fetch(url);

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${text.slice(0, 200)}`);
  }

  const data = JSON.parse(text);
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchRtmsCompare() {
  const resp = await fetch(`/api/rtms-compare?lawdCd=29140&fromYmd=202602&maxBack=12`);
  if (!resp.ok) throw new Error("RTMS compare fetch failed");
  return resp.json();
}

function extractSpaceSeq(detail) {
  const s = detail?.space;
  const candidates1 = [s?.seq, s?.space_seq, s?.spaceSeq, s?.id, s?.space_id, s?.spaceId].filter(
    (v) => v != null
  );
  if (candidates1.length) return candidates1[0];

  const arr = detail?.spaces;
  if (Array.isArray(arr) && arr.length) {
    for (const sp of arr) {
      const candidates2 = [
        sp?.seq,
        sp?.space_seq,
        sp?.spaceSeq,
        sp?.id,
        sp?.space_id,
        sp?.spaceId,
      ].filter((v) => v != null);
      if (candidates2.length) return candidates2[0];
    }
  }

  return null;
}

/* =========================
   Main loader
========================= */
let rtms = null;

// ✅ 상대점수: 현재 목록(items)에서 absScore가 상위 몇%인지 → 0~100
function relativePercentScore(items, absScore) {
  const scores = items
    .map((x) => Number(x.__absRiskScore))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!scores.length) return 50; // 비교 불가면 중립

  // absScore가 scores에서 몇번째 위치인지(하위부터)
  let lo = 0, hi = scores.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (scores[mid] <= absScore) lo = mid + 1;
    else hi = mid;
  }
  const rank = lo; // absScore 이하 개수

  // 하위 0% ~ 상위 100%로 변환
  const pct = scores.length <= 1 ? 50 : (rank - 1) / (scores.length - 1); // 0~1
  return Math.max(0, Math.min(100, Math.round(pct * 100)));
}

// ✅ 혼합형 등급(고정 컷)
function gradeFromFinalScore(finalScore) {
  const s = Number(finalScore);
  if (!Number.isFinite(s)) return "안전";
  if (s >= 70) return "위험";
  if (s >= 50) return "주의";
  return "안전";
}


function applyRtmsAdjustment(baseScore, it, allItems) {
  let s = Number(baseScore);
  if (!Number.isFinite(s)) s = 0;

  const deposit = toNumber(it.deposit);
  const peer = getPeerDepositMedianAny(allItems, it);
  const peerMed = peer?.med;

  // ✅ 신축 판정 (buildYear가 "2021" 같은 연도라고 가정)
  const nowYear = 2026; // 필요하면 new Date().getFullYear()
  const by = toNumber(it.buildYear);
  const age = Number.isFinite(by) ? (nowYear - by) : null;
  const isNew = age != null && age >= 0 && age <= 5;

  // ✅ 신축 완화계수: 신축이면 '비싼 쪽 가산'을 45%만 반영
  const expensiveMul = isNew ? 0.45 : 1.0;

  if (deposit != null && peerMed != null && peerMed > 0) {
    const ratio = deposit / peerMed;

    // 비싼 경우(신축 완화 적용)
    if (ratio >= 1.35) s += Math.round(10 * expensiveMul);
    else if (ratio >= 1.2) s += Math.round(6 * expensiveMul);

    // 싼 경우(완화 X: 그대로)
    else if (ratio <= 0.8) s += 6;
    else if (ratio <= 0.9) s += 3;
  } else {
    s += 2;
  }

  return Math.max(0, Math.min(100, Math.round(s)));
}


/* =========================
   ✅ Filter UI State
========================= */
let CURRENT_TYPE = "all"; // all | apt | officetel | house-villa

// ✅ 데이터 캐시(필터 누를 때마다 재요청 X)
var __ALL_ITEMS_CACHE = null;
var __RADIUS_ITEMS_CACHE = null;
var __RADIUS_CACHE_KEY = "";

/* =========================
   ✅ Filter Buttons Bind
========================= */
function bindTypeFilters() {
  const wrap = document.getElementById("typeFilters");
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-type]");
    if (!btn) return;

    CURRENT_TYPE = btn.dataset.type || "all";

    // active 표시
    wrap.querySelectorAll(".typeBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // 다시 렌더
    renderByCurrentFilter();
  });
}

/* =========================
   ✅ Data helpers
========================= */
async function ensureDatasetLoaded() {
  if (__ALL_ITEMS_CACHE) return __ALL_ITEMS_CACHE;

  const items = await fetchDataset();         // 기존 함수 그대로 사용
  rtms = await fetchRtmsCompare();            // 기존 함수 그대로 사용
  window.__RTMS_COMPARE = rtms;

  // 좌표 없는 건 제거(기본)
  __ALL_ITEMS_CACHE = (Array.isArray(items) ? items : []).filter((it) => it.lat != null && it.lng != null);
  return __ALL_ITEMS_CACHE;
}

function getRadiusItems(allItems) {
  // ✅ 반경 기준 좌표: 지도 중심 or MY_POS
  const center = map.getCenter();
  const origin = USE_MAP_CENTER_AS_ORIGIN
    ? { lat: center.getLat(), lng: center.getLng() }
    : (MY_POS ? { ...MY_POS } : null);

  ORIGIN_POS = origin;

  const key = origin ? `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}` : "NO_POS";
  if (__RADIUS_ITEMS_CACHE && __RADIUS_CACHE_KEY === key) return __RADIUS_ITEMS_CACHE;

  let items = allItems;

  if (origin) {
    items = filterByRadius(items, origin.lat, origin.lng, RADIUS_KM); // ✅ 중심좌표 변경
  } else {
    items = items.slice(0);
  }

  __RADIUS_ITEMS_CACHE = items;
  __RADIUS_CACHE_KEY = key;
  return items;
}


/* =========================
   ✅ Apply filter rules
   - "아파트" 버튼: 1.5km 내 아파트 최대 40개
   - "전체" 버튼: 1.5km 내 (아파트/오피스텔/빌라) 각 10개씩, 없으면 없는대로
========================= */
function applyTypeLimit(radiusItems) {
  const type = CURRENT_TYPE;

  if (type === "all") {
    // ✅ 전체: 카테고리별 20개씩
    const limited = limitByCategory(radiusItems, 20);
    return {
      items: limited.items,
      summary: `APT ${limited.counts.apt} / OFFI ${limited.counts.officetel} / VILLA ${limited.counts["house-villa"]}`,
    };
  }

  // 개별 타입
  const filtered = radiusItems.filter((it) => it.category === type);

  // ✅ 특정 타입: 60개
  const maxN = 60;

  return {
    items: filtered.slice(0, maxN),
    summary: `${type} ${Math.min(filtered.length, maxN)} / total-in-radius ${filtered.length}`,
  };
}


/* =========================
   ✅ Marker renderer (기존 for-loop를 함수로 분리)
========================= */
async function renderMarkersForItems(items) {
  clearMarkers();

  const mlStats = buildMlReasonStats(items);

  // ✅ 1) absScore(절대점수) 먼저 전부 계산해서 items에 캐시
for (const it of items) {
  it.__absRiskScore = applyRtmsAdjustment(it.mlRiskScore ?? 0, it, items); // 0~100
}

  let firstCoords = null;

  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;

    const coords = new kakao.maps.LatLng(it.lat, it.lng);
    if (!firstCoords) firstCoords = coords;

    const addr = `광주광역시 서구 ${it.dongName ?? ""} ${it.complexName ?? ""}`.trim();

    

// for-loop 내부에서 마커 생성할 때 ↓↓↓
const absScore = Number(it.__absRiskScore);
const relScore = relativePercentScore(items, absScore);

// ✅ 혼합 점수 (가중치 조절 가능)
const finalScore = Math.max(0, Math.min(100, Math.round(absScore * 0.7 + relScore * 0.3)));

const risk = {
  score: finalScore,          // ✅ 화면에 보여줄 점수는 finalScore
  absScore,                   // (옵션) 디버그/설명용
  relScore,                   // (옵션) 디버그/설명용
  grade: gradeFromFinalScore(finalScore),
  reasons:
    Array.isArray(it.mlRiskReasons) && it.mlRiskReasons.length
      ? it.mlRiskReasons
      : buildMlReasonsForItem(
          { ...it, finalRiskScore: finalScore }, // ✅ grade 분기용
          items,
          mlStats
        ),
  metrics: it.mlRiskMetrics ?? null,
};

    const label = it.category === "officetel" ? "O" : it.category === "house-villa" ? "H" : "A";

    const marker = new kakao.maps.Marker({
      map,
      position: coords,
      image: getMarkerImageByGrade(risk.grade, label),
    });

    marker.__risk = risk;
    marker.__item = it;
    markers.push(marker);

    const title = it.complexName || roomTypeLabel(it) || "(매물)";
    const catTag =
      it.category === "officetel" ? "OFFI" : it.category === "house-villa" ? "VILLA" : "APT";

    const iw = new kakao.maps.InfoWindow({
  content: `
    <div style="padding:6px;font-size:12px;max-width:260px;">
      <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        [${catTag}] ${title}
      </div>
      <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${addr}
      </div>
    </div>
  `,
});



    infoWindows.push(iw);

    kakao.maps.event.addListener(marker, "click", async () => {
      infoWindows.forEach((x) => x.close());
      iw.open(map, marker);
      activeInfoWindow = iw;

      openSidebar();

      window.components?.renderLeftPanel?.(
        { ...it, umdNm: it.dongName, aptNm: it.complexName },
        addr,
        coords,
        marker.__risk,
        "dabang",
        null,
        [],
        []
      );

      try {
        const detail = await fetchDabangRoomDetail(it.id);

        const dRoom = detail?.room ?? detail?.result?.room ?? null;
        const dComplex = detail?.complex ?? detail?.result?.complex ?? null;

        const complexId = dComplex?.complex_id ?? dRoom?.complex_id ?? it.complexId;
        const spaceSeq = extractSpaceSeq(detail);

        const room = detail?.room ?? detail?.result?.room;
        const complex = detail?.complex ?? detail?.result?.complex;

        const enriched = {
          ...it,
          umdNm: room?.address?.split(" ").pop() ?? it.dongName,
          aptNm: complex?.complex_name ?? it.complexName,
          buildYear: room?.building_approval_date_str?.slice(0, 4) ?? it.buildYear,
          floor: room?.room_floor_str ? Number(String(room.room_floor_str).replace("층", "")) : it.floor,
          excluUseAr: room?.room_size ?? it.excluUseAr,
        };

        if (complexId && spaceSeq) {
          const saleHistories = await fetchRealPriceTop({ complexId, spaceSeq, searchType: "SALE" });
          const leaseHistories = await fetchRealPriceTop({ complexId, spaceSeq, searchType: "LEASE" });

          window.components?.renderLeftPanel?.(
            enriched, addr, coords, marker.__risk, "dabang", detail, saleHistories, leaseHistories
          );
        } else {
          window.components?.renderLeftPanel?.(
            enriched, addr, coords, marker.__risk, "dabang", detail, [], []
          );
        }
      } catch (e) {
        console.warn(e);
      }
    });
  }

  if (firstCoords) setCenterSilently(firstCoords);
}

/* =========================
   ✅ Search: open item like marker click (temp render)
========================= */

let tempSearchMarker = null;
let tempSearchInfoWindow = null;

function clearTempSearchMarker() {
  if (tempSearchInfoWindow) {
    tempSearchInfoWindow.close();
    tempSearchInfoWindow = null;
  }
  if (tempSearchMarker) {
    tempSearchMarker.setMap(null);
    tempSearchMarker = null;
  }
}

// ✅ "현재 지도에 없는 매물"도 임시로 찍고 -> 클릭한 것처럼(sidebar까지) 열기
async function openItemAsClicked(it) {
  if (!it || it.lat == null || it.lng == null) return;

  // 이전 임시 마커 제거
  clearTempSearchMarker();

  const coords = new kakao.maps.LatLng(it.lat, it.lng);

  // ✅ risk 계산 (현재 화면 items가 없으니 relScore는 중립 50으로)
  const absScore = applyRtmsAdjustment(it.mlRiskScore ?? 0, it, [it]);
  const relScore = 50;
  const finalScore = Math.max(0, Math.min(100, Math.round(absScore * 0.7 + relScore * 0.3)));

  const risk = {
    score: finalScore,
    absScore,
    relScore,
    grade: gradeFromFinalScore(finalScore),
    reasons:
      Array.isArray(it.mlRiskReasons) && it.mlRiskReasons.length
        ? it.mlRiskReasons
        : buildMlReasonsForItem({ ...it, finalRiskScore: finalScore }, [it], buildMlReasonStats([it])),
    metrics: it.mlRiskMetrics ?? null,
  };

  const label = it.category === "officetel" ? "O" : it.category === "house-villa" ? "H" : "A";
  tempSearchMarker = new kakao.maps.Marker({
    map,
    position: coords,
    image: getMarkerImageByGrade(risk.grade, label),
  });
  tempSearchMarker.__risk = risk;

  const title = it.complexName || roomTypeLabel(it) || "(매물)";
  const catTag = it.category === "officetel" ? "OFFI" : it.category === "house-villa" ? "VILLA" : "APT";
  const addrLine = `광주광역시 서구 ${it.dongName ?? ""} ${it.complexName ?? ""}`.trim();

  tempSearchInfoWindow = new kakao.maps.InfoWindow({
    content: `
      <div style="padding:6px;font-size:12px;max-width:260px;">
        <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          [${catTag}] ${title}
        </div>
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${addrLine}
        </div>
      </div>
    `,
  });

  // ✅ 지도/사이드바 상태도 "클릭"과 동일하게
  infoWindows.forEach((x) => x.close()); // 기존 인포윈도우 닫기
  tempSearchInfoWindow.open(map, tempSearchMarker);
  activeInfoWindow = tempSearchInfoWindow;

  map.setLevel(4);
  openSidebar();

  // ✅ 사이드바 1차 렌더(기존 클릭 코드와 동일)
  window.components?.renderLeftPanel?.(
    { ...it, umdNm: it.dongName, aptNm: it.complexName },
    addrLine,
    coords,
    tempSearchMarker.__risk,
    "dabang",
    null,
    [],
    []
  );

  // ✅ 상세 + 실거래가(기존 클릭 코드와 동일)
  try {
    const detail = await fetchDabangRoomDetail(it.id);

    const dRoom = detail?.room ?? detail?.result?.room ?? null;
    const dComplex = detail?.complex ?? detail?.result?.complex ?? null;

    const complexId = dComplex?.complex_id ?? dRoom?.complex_id ?? it.complexId;
    const spaceSeq = extractSpaceSeq(detail);

    const room = detail?.room ?? detail?.result?.room;
    const complex = detail?.complex ?? detail?.result?.complex;

    const enriched = {
      ...it,
      umdNm: room?.address?.split(" ").pop() ?? it.dongName,
      aptNm: complex?.complex_name ?? it.complexName,
      buildYear: room?.building_approval_date_str?.slice(0, 4) ?? it.buildYear,
      floor: room?.room_floor_str ? Number(String(room.room_floor_str).replace("층", "")) : it.floor,
      excluUseAr: room?.room_size ?? it.excluUseAr,
    };

    if (complexId && spaceSeq) {
      const saleHistories = await fetchRealPriceTop({ complexId, spaceSeq, searchType: "SALE" });
      const leaseHistories = await fetchRealPriceTop({ complexId, spaceSeq, searchType: "LEASE" });

      window.components?.renderLeftPanel?.(
        enriched, addrLine, coords, tempSearchMarker.__risk, "dabang", detail, saleHistories, leaseHistories
      );
    } else {
      window.components?.renderLeftPanel?.(
        enriched, addrLine, coords, tempSearchMarker.__risk, "dabang", detail, [], []
      );
    }
  } catch (e) {
    console.warn(e);
  }
}

/* =========================
   ✅ Main render by current filter
========================= */
async function renderByCurrentFilter() {
  if (infoEl) infoEl.innerHTML = `<p>⏳ 매물 불러오는 중...</p>`;

  try {
    const all = await ensureDatasetLoaded();
    const radiusItems = getRadiusItems(all);

    const { items, summary } = applyTypeLimit(radiusItems);

    const originLabel = USE_MAP_CENTER_AS_ORIGIN ? "지도 중심" : "내 위치";

    await renderMarkersForItems(items);

    if (infoEl) {
      const typeKo =
        CURRENT_TYPE === "all" ? "전체" :
        CURRENT_TYPE === "apt" ? "아파트" :
        CURRENT_TYPE === "officetel" ? "오피스텔" : "빌라";

      infoEl.innerHTML = `
  <p>✅ 마커 생성 완료</p>
  <p>기준: <b>${originLabel}</b> / 필터: <b>${typeKo}</b> / 반경: <b>${RADIUS_KM}km</b></p>
  <p>표시: <b>${items.length}건</b></p>
  <p style="color:#666;font-size:12px;">${summary}</p>
`;
    }
  } catch (e) {
    if (infoEl) {
      infoEl.innerHTML = `<pre style="white-space:pre-wrap;color:#b00020;">${String(e?.message || e)}</pre>`;
    }
  }
}

/* =========================
   ✅ 기존 loadAptRentToMap() 대체
========================= */
async function loadAptRentToMap() {
  // 초기 로딩 = 현재 필터 기준 렌더
  await renderByCurrentFilter();
}

bindTypeFilters();

(function initFromTrust() {
  let payload = null;
  try {
    const raw = sessionStorage.getItem("map_prefill");
    if (raw) payload = JSON.parse(raw);
  } catch {}

  if (!payload || payload.from !== "trust") return;

  const addr = String(payload.addr || "").trim();
  if (!addr) return;

  // ✅ MAP 검색창이 있다면 채워주기 (id="address" 쓰고 있네)
  const addrEl = document.getElementById("address");
  if (addrEl) addrEl.value = addr;

  // ✅ 주소로 지도 이동 + 마커 표시
  geocoder.addressSearch(addr, function (result, status) {
    if (status !== kakao.maps.services.Status.OK || !result?.[0]) {
      alert("TRUST에서 전달된 주소를 지도에서 찾을 수 없습니다.");
      return;
    }

    const lat = Number(result[0].y);
    const lng = Number(result[0].x);
    const coords = new kakao.maps.LatLng(lat, lng);

    if (addressMarker) addressMarker.setMap(null);
    addressMarker = new kakao.maps.Marker({ map: map, position: coords });
    map.setCenter(coords);
    map.setLevel(4);

    // ✅ 비교/보기 모드에 따라 행동 분기
    const mode = payload.mode || "view";

    // "view": 그냥 주소로 이동만
    if (mode === "view") {
      openSidebar(); // 원하면 열기
      return;
    }

    // "compare": 이 좌표를 중심으로 "반경 필터"를 강제로 다시 계산해서 마커 재렌더
    // -> 기존 구조를 최대한 안 건드리고, MY_POS를 임시로 바꿔서 재사용
    MY_POS = { lat, lng };
    renderByCurrentFilter();

    // 비교라는 느낌을 주는 안내(선택)
    const info = document.getElementById("info");
    if (info) {
      info.innerHTML = `
        <p>✅ TRUST 주소 기준으로 주변 매물을 비교 중입니다.</p>
        <p style="color:#666;font-size:12px;">반경 ${RADIUS_KM}km / 필터 ${CURRENT_TYPE}</p>
      `;
    }
  });

  // 한 번 쓰고 지우기(다음에 map 들어올 때 계속 적용되는 것 방지)
  sessionStorage.removeItem("map_prefill");
})();

/* =========================
   ✅ Search Normalize / Match
========================= */
function looksLikeAddress(q = "") {
  // 숫자 + (로/길/번길/번지/동/가/구) 조합이면 주소로 판단
  return /(\d{1,4}(-\d{1,4})?)|([가-힣]+(로|길|번길|번지|동|가))/.test(q);
}

// 좌표 기준 “거의 같은 주소”로 볼 반경 (km)
const STRICT_ADDR_RADIUS_KM = 0.12; // 120m (원하면 0.08~0.2 조절)


// 한글/숫자 위주로 정규화(공백/특수문자 제거)
function normKey(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "") // 문자/숫자만 (유니코드)
    .trim();
}

// "행정동/법정동" 같은 차이 완화: 끝의 "동" 같은 건 토큰으로도 남기고 원형도 남김
function tokenizeKorean(s = "") {
  const raw = String(s).replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const t = raw.split(" ").map(normKey).filter(Boolean);

  // 추가 토큰: "치평동" -> "치평", "치평동", "치평"
  const extra = [];
  for (const x of t) {
    if (x.endsWith("동") && x.length >= 2) extra.push(x.slice(0, -1));
    if (x.endsWith("로") && x.length >= 2) extra.push(x.slice(0, -1));
    if (x.endsWith("길") && x.length >= 2) extra.push(x.slice(0, -1));
  }
  return [...new Set([...t, ...extra])];
}

function buildItemSearchText(it) {
  // ✅ 네 데이터에서 검색에 의미 있는 필드들 최대한 모으기
  const parts = [
    it?.complexName,
    it?.roomTypeName,
    it?.roomTitle,
    it?.roomDesc,
    // (상세 불러오기 전이라 주소는 없을 수 있음. 나중에 확장 가능)
  ].filter(Boolean);

  return normKey(parts.join(" "));
}

// 토큰이 여러 개면 “포함” 점수로 랭킹
function scoreMatch(itemTextNorm, queryTokens) {
  if (!itemTextNorm || !queryTokens?.length) return 0;

  let score = 0;
  for (const tk of queryTokens) {
    if (!tk) continue;
    if (itemTextNorm.includes(tk)) score += 2;
    // 아주 짧은 토큰은 약하게
    else if (tk.length >= 4 && itemTextNorm.includes(tk.slice(0, 3))) score += 1;
  }
  return score;
}

// ✅ 너무 자주 재렌더링 되는 것 방지(디바운스)
let __MOVE_TIMER = null;
let __LAST_CENTER = null;
let __LAST_LEVEL = map.getLevel();

// 중심 이동이 아주 조금이면 무시(미터 단위)
function movedEnough(prev, next, minMeters = 80) {
  if (!prev || !next) return true;
  const dKm = haversineKm(prev.lat, prev.lng, next.lat, next.lng);
  return dKm * 1000 >= minMeters;
}

function scheduleRerenderByMapMove() {
  if (__SUPPRESS_IDLE_RERENDER) return;
  if (!USE_MAP_CENTER_AS_ORIGIN) return;

  const c = map.getCenter();
  const next = { lat: c.getLat(), lng: c.getLng() };
  const lvl = map.getLevel();

  // 줌이 바뀌었거나, 중심이 충분히 이동했을 때만
  const should =
    lvl !== __LAST_LEVEL ||
    movedEnough(__LAST_CENTER, next, 80);

  if (!should) return;

  __LAST_CENTER = next;
  __LAST_LEVEL = lvl;

  // ✅ 캐시 무효화(중심좌표 바뀌면 반경 결과가 달라지므로)
  __RADIUS_ITEMS_CACHE = null;
  __RADIUS_CACHE_KEY = "";

  clearTimeout(__MOVE_TIMER);
  __MOVE_TIMER = setTimeout(() => {
    renderByCurrentFilter();
  }, 250);
}

// ✅ Kakao map: 드래그/줌 후 최종 상태에서 한번만 뜨는 이벤트
kakao.maps.event.addListener(map, "idle", scheduleRerenderByMapMove);
