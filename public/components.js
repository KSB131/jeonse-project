// public/components.js
// ✅ map.js에서 renderLeftPanel 관련 UI 코드를 분리한 파일
// 사용법: map.html에서 components.js를 map.js보다 먼저 로드

(function () {
  const infoEl = document.getElementById("info");

  const sidebarEl = document.getElementById("sidebar");

  function openSidebar() {
    sidebarEl?.classList.remove("collapsed");
  }
  function closeSidebar() {
    sidebarEl?.classList.add("collapsed");
  }

  function fmtMoney(v) {
    if (v == null) return "";
    const s = String(v).replace(/,/g, "").trim();
    if (!s) return "";
    const n = Number(s);
    return Number.isFinite(n) ? n.toLocaleString("ko-KR") : v;
  }

  function contractDay(it) {
    const y = it.dealYear ?? "";
    const m = String(it.dealMonth ?? "").padStart(2, "0");
    const d = String(it.dealDay ?? "").padStart(2, "0");
    return `${y}-${m}-${d}`.replace(/--/g, "-");
  }

  function pick(it, keys) {
    for (const k of keys) {
      const v = it?.[k];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function getListingName(it, kind) {
    if (kind === "dabang") return it.complexName ?? it.aptNm ?? "(다방 매물)";
    if (kind === "apt") return it.aptNm ?? "-";
    if (kind === "offi")
      return pick(it, ["offiNm", "bldgNm", "buildingName", "단지명", "건물명"]) ?? "(오피스텔)";
    return pick(it, ["houseNm", "bldgNm", "buildingName", "건물명"]) ?? "(단독/다가구)";
  }

  function roomTypeLabel(it) {
  const raw =
    it?.room_type_str ??
    it?.roomTypeStr ??
    it?.roomTypeName ??
    it?.roomType ??
    it?.room_type_name ??
    "";

  const s = String(raw).trim();
  if (!s) return null;
  return s.split("(")[0].trim(); // "원룸(분리형)" -> "원룸"
}

  function renderSaleHistoryBox(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return `
        <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;color:#666;">
          매매 실거래가 데이터가 없습니다.
        </div>
      `;
    }

    const sorted = [...list].sort((a, b) => String(b.contractDate).localeCompare(String(a.contractDate)));

    const rows = sorted.slice(0, 10).map((x) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${x.contractDate ?? "-"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${x.floor ?? "-"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">
          <b>${(x.tradePrice ?? 0).toLocaleString("ko-KR")}</b> 만원
        </td>
      </tr>
    `).join("");

    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
        <div style="font-weight:700;margin-bottom:8px;">매매 실거래가 (최근 10건)</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee;">계약일</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee;">층</th>
              <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;">가격(만원)</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:6px;color:#888;font-size:12px;">
          전체 ${sorted.length}건 중 최근 10건만 표시
        </div>
      </div>
    `;
  }

  function renderLeaseHistoryBox(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return `
        <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;color:#666;">
          전월세 실거래가 데이터가 없습니다.
        </div>
      `;
    }

    const sorted = [...list].sort((a, b) => String(b.contractDate).localeCompare(String(a.contractDate)));

    const rows = sorted.slice(0, 10).map((x) => {
      const type =
        x.priceTypeDesc ??
        (x.priceType === "LEASE" ? "전세" : x.priceType === "MONTHLY" ? "월세" : "-");
      const floor = x.floor ?? x.formatFloor ?? "-";

      const priceText =
        x.priceType === "MONTHLY"
          ? `<b>${(x.deposit ?? 0).toLocaleString("ko-KR")}</b> / <b>${(x.monthlyPrice ?? 0).toLocaleString("ko-KR")}</b>`
          : `<b>${(x.deposit ?? 0).toLocaleString("ko-KR")}</b>`;

      return `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${x.contractDate ?? "-"}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${floor}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${type}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">
            ${priceText} <span style="color:#777;">만원</span>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
        <div style="font-weight:700;margin-bottom:8px;">전월세 실거래가 (최근 10건)</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee;">계약일</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee;">층</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee;">구분</th>
              <th style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee;">가격</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:6px;color:#888;font-size:12px;">
          전체 ${sorted.length}건 중 최근 10건만 표시
        </div>
      </div>
    `;
  }

  function renderPriceTabs({ saleList, leaseList, defaultTab = "sale" }) {
    const saleHtml = renderSaleHistoryBox(saleList);
    const leaseHtml = renderLeaseHistoryBox(leaseList);

    const initialTab =
      defaultTab === "sale"
        ? (Array.isArray(saleList) && saleList.length ? "sale" : "lease")
        : (Array.isArray(leaseList) && leaseList.length ? "lease" : "sale");

    // 전역 토글 함수
    window.__setPriceTab = function (tab) {
      const saleEl = document.getElementById("price_box_sale");
      const leaseEl = document.getElementById("price_box_lease");
      const bSale = document.getElementById("btn_tab_sale");
      const bLease = document.getElementById("btn_tab_lease");
      if (!saleEl || !leaseEl || !bSale || !bLease) return;

      const activeStyle = "background:#111;color:#fff;border:1px solid #111;";
      const normalStyle = "background:#fff;color:#111;border:1px solid #ddd;";

      if (tab === "sale") {
        saleEl.style.display = "block";
        leaseEl.style.display = "none";
        bSale.style.cssText += activeStyle;
        bLease.style.cssText += normalStyle;
      } else {
        saleEl.style.display = "none";
        leaseEl.style.display = "block";
        bSale.style.cssText += normalStyle;
        bLease.style.cssText += activeStyle;
      }
    };

    const tabBtnBase = `
      padding:6px 10px;border-radius:999px;font-size:12px;cursor:pointer;
      user-select:none;transition:all .15s ease;
    `;

    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <div style="font-weight:800;">실거래가</div>
          <div style="margin-left:auto;display:flex;gap:6px;">
            <button id="btn_tab_sale"
              style="${tabBtnBase}"
              onclick="window.__setPriceTab('sale')">매매</button>
            <button id="btn_tab_lease"
              style="${tabBtnBase}"
              onclick="window.__setPriceTab('lease')">전월세</button>
          </div>
        </div>

        <div id="price_box_sale" style="display:none;">${saleHtml}</div>
        <div id="price_box_lease" style="display:none;">${leaseHtml}</div>
      </div>

      <script>
        window.__setPriceTab('${initialTab}');
      </script>
    `;
  }

  function renderAgentBox(agent) {
    if (!agent) {
      return `
        <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;color:#666;">
          중개사무소 정보를 불러오는 중입니다...
        </div>
      `;
    }

    const line = (label, value) => `
      <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed #eee;">
        <div style="width:120px;color:#666;">${label}</div>
        <div style="flex:1;"><b>${value ?? "-"}</b></div>
      </div>
    `;

    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
        <div style="font-weight:800;margin-bottom:6px;">중개사무소 정보</div>
        ${line("중개사무소", agent?.name ?? "-")}
        ${line("대표명", agent?.facename ?? "-")}
        ${line("등록번호", agent?.reg_id ?? "-")}
        ${line("대표번호", agent?.agent_tel ?? "-")}
        ${line("사무소 주소", agent?.address ?? "-")}
      </div>
    `;
  }

  // ✅ 만원 -> 원 (TRUST 입력칸이 원 단위)
function toWonFromManwon(manwon) {
  const n = Number(String(manwon ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 10000));
}

function buildTrustNeedReasons(risk) {
  const list = [];
  const rs = risk?.reasons ?? [];

  // ML 사유 문구에서 “등기부로 확인해야 하는 이유”만 사용자용으로 재가공
  for (const r of rs) {
    const text = String(r?.rule ?? "");
    if (!text) continue;

    if (text.includes("선순위") || text.includes("근저당") || text.includes("채권")) {
      list.push("근저당/선순위 채권(채권최고액) 확인이 필요합니다.");
    } else if (text.includes("경매") || text.includes("압류") || text.includes("가압류") || text.includes("가처분")) {
      list.push("경매/압류/가압류 등 권리제한 신호를 등기부에서 확인해야 합니다.");
    } else if (text.includes("소유") || text.includes("이전")) {
      list.push("소유자/계약 상대방 일치 여부(소유권 변동 포함) 확인이 필요합니다.");
    }
  }

  // 너무 비어있으면 기본 근거 제공
  if (!list.length) {
    list.push("등기부로 ‘소유자 일치’와 ‘권리제한(근저당/가압류 등)’ 여부를 확인하세요.");
  }

  // 중복 제거 + 최대 3개
  return [...new Set(list)].slice(0, 3);
}

  function renderLeftPanel(
    it,
    addr,
    coords,
    risk,
    kind,
    detail = null,
    saleHistories = null,
    leaseHistories = null
  ) {
    if (!infoEl) return;

    openSidebar(); // ✅ 마커 클릭하면 자동으로 사이드바 열기

    const deposit = fmtMoney(it.deposit ?? "");
    const rent = fmtMoney(it.monthlyRent ?? 0);
    

    const badgeStyle = (() => {
      if (!risk) return "background:#eee;color:#333;";
      if (risk.grade === "위험") return "background:#ffebee;color:#b71c1c;border:1px solid #ffcdd2;";
      if (risk.grade === "주의") return "background:#fff8e1;color:#8d6e00;border:1px solid #ffe0b2;";
      return "background:#e8f5e9;color:#1b5e20;border:1px solid #c8e6c9;";
    })();

    const reasonsHtml =
      risk?.reasons?.slice(0, 4)?.map((r) => `<li>${r.rule} <span style="color:#999;">(+${r.points})</span></li>`).join("") ??
      "";

    const isDabang = kind === "dabang";
    const titleMain = isDabang
  ? (it.complexName ?? it.aptNm ?? roomTypeLabel(it) ?? "(다방 매물)")
  : getListingName(it, kind);

    const titleSub = isDabang ? (it.roomTitle ?? it.roomDesc ?? "") : "";

    const dRoom = detail?.room ?? detail?.result?.room ?? null;
    const dComplex = detail?.complex ?? detail?.result?.complex ?? null;
    const dAgent = detail?.agent ?? detail?.result?.agent ?? null;

    const jibunAddr =
  dRoom?.full_jibun_address_str ||
  dComplex?.jibun_address ||
  "";

    const line = (label, value) => `
      <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed #eee;">
        <div style="width:120px;color:#666;">${label}</div>
        <div style="flex:1;"><b>${value ?? "-"}</b></div>
      </div>
    `;

    const agentHtml = renderAgentBox(dAgent);

    const detailHtml = detail ? `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
        <div style="font-weight:700;margin-bottom:6px;">상세정보</div>

        ${line("단지명", dComplex?.complex_name ?? it.complexName)}
        ${line("주소(지번)", dRoom?.full_jibun_address_str ?? dComplex?.jibun_address ?? "-")}
        ${line("주소(도로명)", dRoom?.full_road_address_str ?? dComplex?.road_address ?? "-")}

        ${line("매물종류", dRoom?.room_type_str ?? "-")}
        ${line("거래유형", dRoom?.selling_type === 2 ? "매매" : (dRoom?.selling_type ?? "-"))}
        ${line("가격", dRoom?.price_title ?? dRoom?.price_info_str?.[0]?.[0] ?? "-")}

        ${line("해당층 / 건물층", `${dRoom?.room_floor_str ?? "-"} / ${dRoom?.building_floor_str ?? "-"}`)}
        ${line("전용 / 공급면적", `${dRoom?.room_size ?? "-"}㎡ / ${dRoom?.provision_size ?? "-"}㎡`)}
        ${line("방 / 욕실", `${dRoom?.beds_num ?? "-"}개 / ${dRoom?.bath_num ?? "-"}개`)}
        ${line("방향", `${dRoom?.direction_str ?? "-"} (${dRoom?.direction_measurement_base_type_str ?? "-"})`)}
        ${line("엘리베이터", dRoom?.elevator_str ?? "-")}
        ${line("세대수", dComplex?.household_num ?? dRoom?.household_num_str ?? "-")}
        ${line("주차", `${dComplex?.parking_average ?? dRoom?.parking_average ?? "-"}대/세대`)}

        ${line("현관유형", dRoom?.entrance_type_str ?? "-")}
        ${line("입주가능일", dRoom?.moving_date ?? "-")}
        ${line("건축물용도", Array.isArray(dRoom?.building_use_types_str) ? dRoom.building_use_types_str.join(", ") : (dRoom?.building_use_types_str ?? "-"))}
        ${line("사용승인일", dRoom?.building_approval_date_str ?? dComplex?.building_approval_date_str ?? "-")}
        ${line("최초등록일", dRoom?.saved_time_str ?? "-")}
      </div>
    ` : `
      <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;color:#666;">
        상세정보를 불러오는 중입니다...
      </div>
    `;

    const trustWhy = buildTrustNeedReasons(risk);

const trustCtaHtml = `
  <div style="margin-top:10px;padding:12px;border:1px solid #e9e9e9;border-radius:12px;background:#fafafa;">
    <div style="font-weight:800;margin-bottom:6px;">등기부등본 추가 검증</div>
    <div style="color:#666;font-size:13px;line-height:1.45;">
      지도 점수는 “가격/시세 기반 위험 신호”이고, 계약 전 핵심은 <b>등기부(권리관계)</b> 확인입니다.
    </div>
    <ul style="margin:8px 0 10px;padding-left:18px;color:#444;font-size:13px;line-height:1.5;">
      ${trustWhy.map(x => `<li>${x}</li>`).join("")}
    </ul>
    <button id="goTrustBtn" style="
      width:100%;padding:10px 12px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;
      font-weight:700;cursor:pointer;">
      등기부 PDF 업로드로 추가 검증하기 →
    </button>
    <div style="margin-top:8px;color:#888;font-size:12px;">
      * 업로드한 PDF는 분석 후 서버에서 임시파일을 삭제하도록 구현되어 있습니다.
    </div>
  </div>
`;


    infoEl.innerHTML = `
      <div style="font-size:14px; line-height:1.6;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <div style="font-size:16px;"><b>${titleMain}</b></div>
            ${
              titleSub
                ? `<div style="margin-top:4px;color:#444;font-size:13px;line-height:1.4;">${titleSub}</div>`
                : ""
            }
          </div>

          <div style="padding:4px 8px;border-radius:999px;font-size:12px;${badgeStyle}
            white-space:nowrap; flex-shrink:0; word-break:keep-all;">
            위험도: <b>${risk ? risk.grade : "-"}</b> ${risk ? `(${risk.score}점)` : ""}
          </div>
        </div>

        <div style="color:#666; margin:6px 0 10px;">${addr || "-"}</div>

        <div>법정동: <b>${pick(it, ["umdNm","법정동"]) ?? "-"}</b></div>
        <div>전용면적: <b>${pick(it, ["excluUseAr","전용면적"]) ?? "-"}</b> ㎡ / 층: <b>${pick(it, ["floor","층"]) ?? "-"}</b></div>
        <div>보증금: <b>${deposit}</b> 만원 / 월세: <b>${rent}</b> 만원</div>
        <div>건축년도: <b>${it.buildYear ?? "-"}</b></div>
        <div>계약일: <b>${contractDay(it)}</b></div>

        <div style="margin-top:10px;padding:10px;border:1px solid #eee;border-radius:10px;">
          <div style="font-weight:700;margin-bottom:6px;">위험 사유(상위)</div>
          
          <ul style="margin:0;padding-left:18px;">
            ${reasonsHtml || "<li>사유 없음</li>"}
          </ul>
          
        </div>

        ${trustCtaHtml}

        ${detailHtml}
        ${renderPriceTabs({ saleList: saleHistories, leaseList: leaseHistories, defaultTab: "sale" })}
        ${agentHtml}

        <hr style="border:none;border-top:1px solid #eee;margin:10px 0;" />
        <div style="color:#666;">좌표</div>
        <div>lat: ${coords?.getLat?.()?.toFixed?.(6) ?? "-"} / lng: ${coords?.getLng?.()?.toFixed?.(6) ?? "-"}</div>
      </div>
    `;

    setTimeout(() => {
  const btn = document.getElementById("goTrustBtn");
  if (!btn) return;

  btn.onclick = () => {
    const payload = {
      from: "map",
      title: titleMain,
      addr: jibunAddr || addr || "",
      depositWon: toWonFromManwon(it.deposit),  // 만원 -> 원
      landlordName: "",                         // 아직 모르면 공백
      contractDate: "",
      risk: {
        grade: risk?.grade ?? "",
        score: risk?.score ?? null,
        reasons: (risk?.reasons ?? []).slice(0, 4).map(r => r?.rule ?? "").filter(Boolean),
      },
    };

    sessionStorage.setItem("trust_prefill", JSON.stringify(payload));
    location.href = "/trust?from=map";
  };
}, 0);

  }

  // ✅ 외부(map.js)에서 호출할 수 있도록 export(전역 등록)
  window.components = window.components || {};
  window.components.renderLeftPanel = renderLeftPanel;
  window.components.fmtMoney = fmtMoney;
  window.components.openSidebar = openSidebar;
  window.components.closeSidebar = closeSidebar;
})();
