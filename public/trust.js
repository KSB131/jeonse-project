const $ = (q) => document.querySelector(q);

const fileInput = $("#registryPdf");
const fileName = $("#fileName");
const analyzeBtn = $("#analyzeBtn");
const loading = $("#loading");
const errorBox = $("#errorBox");

const resultSection = $("#resultSection");
const resultBadge = $("#resultBadge");
const scoreText = $("#scoreText");
const gradeText = $("#gradeText");
const claimText = $("#claimText");
const reasonsEl = $("#reasons");
const noticesEl = $("#notices");
const checklistEl = $("#checklist");
const scanHint = $("#scanHint");

function money(v) {
  if (v == null) return "-";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

function setLoading(on) {
  loading.hidden = !on;
  analyzeBtn.disabled = on || !fileInput.files?.[0];
}

function setError(msg) {
  if (!msg) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = msg;
}

function clearResult() {
  resultSection.hidden = true;
  reasonsEl.innerHTML = "";
  noticesEl.innerHTML = "";
  checklistEl.innerHTML = "";
  scanHint.hidden = true;
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  fileName.textContent = f ? f.name : "선택된 파일 없음";
  analyzeBtn.disabled = !f;
  clearResult();
  setError("");
});

analyzeBtn.addEventListener("click", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;

  setError("");
  clearResult();
  setLoading(true);

  try {
    const fd = new FormData();
    fd.append("registryPdf", f);

    fd.append("landlordName", $("#landlordName").value || "");
    fd.append("contractDate", $("#contractDate").value || "");
    fd.append("depositWon", $("#depositWon").value || "");
    fd.append("address", $("#address").value || "");

    const r = await fetch("/api/trust/analyze", { method: "POST", body: fd });
    const data = await r.json();

    if (!r.ok || !data.ok) {
      throw new Error(data?.message || "분석 실패");
    }

    renderResult(data);
  } catch (e) {
    setError(e.message || "오류가 발생했습니다.");
  } finally {
    setLoading(false);
  }
});

function renderResult(data) {
  const { meta, result } = data;

  // 스캔본 힌트
  scanHint.hidden = !(meta?.scannedLikely);

  // KPI
  resultBadge.textContent = `${result.badge} ${result.grade}`;
  scoreText.textContent = `${result.score} / 100`;
  gradeText.textContent = result.grade;

  const claim = result.extracted?.maxClaimWon;
  claimText.textContent = claim ? money(claim) : "-";

  // reasons
  reasonsEl.innerHTML = "";
  (result.reasons?.length ? result.reasons : ["뚜렷한 위험 신호가 적습니다(기본 검증은 계속 권장)."])
    .forEach((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      reasonsEl.appendChild(li);
    });

  // notices
  noticesEl.innerHTML = "";
  (result.notices || []).forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s;
    noticesEl.appendChild(li);
  });

  // checklist
  checklistEl.innerHTML = "";
  (result.checklist || []).forEach((c) => {
    const row = document.createElement("div");
    row.className = "check-row " + (c.ok ? "ok" : "bad");
    row.innerHTML = `
      <div class="check-dot">${c.ok ? "✅" : "⚠️"}</div>
      <div class="check-text">${escapeHtml(c.text)}</div>
    `;
    checklistEl.appendChild(row);
  });

  resultSection.hidden = false;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // ✅ TRUST → MAP CTA 연결
  const payload = buildTrustToMapPayload(data);

  const openBtn = document.getElementById("openMapBtn");
  const cmpBtn = document.getElementById("compareMapBtn");

  if (openBtn) {
    openBtn.onclick = () => {
      if (!payload.addr) return alert("주소가 없습니다. 주소를 입력하거나 등기부에서 주소 추출이 되어야 합니다.");
      goMap("view", payload);
    };
  }

  if (cmpBtn) {
    cmpBtn.onclick = () => {
      if (!payload.addr) return alert("주소가 없습니다. 주소를 입력하거나 등기부에서 주소 추출이 되어야 합니다.");
      goMap("compare", payload);
    };
  }

}



function buildTrustToMapPayload(data) {
  const extra = {
    address: (document.getElementById("address")?.value || "").trim(),
    depositWon: Number(document.getElementById("depositWon")?.value || 0) || 0,
    landlordName: (document.getElementById("landlordName")?.value || "").trim(),
    contractDate: (document.getElementById("contractDate")?.value || "").trim(),
  };

  const extractedAddr = (data?.result?.extracted?.propertyAddrFromPdf || "").trim();
  const addr = extra.address || extractedAddr; // ✅ 입력 우선, 없으면 PDF 추출 주소

  return {
    from: "trust",
    ts: Date.now(),
    addr,
    depositWon: extra.depositWon,
    landlordName: extra.landlordName,
    contractDate: extra.contractDate,
    risk: {
      score: data?.result?.score ?? null,
      grade: data?.result?.grade ?? null,
      reasons: data?.result?.reasons ?? [],
      maxClaimWon: data?.result?.extracted?.maxClaimWon ?? null,
    },
  };
}

function goMap(mode, payload) {
  // mode: "view" | "compare"
  sessionStorage.setItem("map_prefill", JSON.stringify({ ...payload, mode }));
  location.href = "/map";
}


function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

(function initFromMap() {
  const banner = document.getElementById("fromMapBanner");
  let payload = null;

  try {
    const raw = sessionStorage.getItem("trust_prefill");
    if (raw) payload = JSON.parse(raw);
  } catch {}

  if (!payload || payload.from !== "map") return;

  // 입력 자동 채움
  const addrEl = document.getElementById("address");
  const depEl = document.getElementById("depositWon");
  const nameEl = document.getElementById("landlordName");
  const dateEl = document.getElementById("contractDate");

  if (addrEl && !addrEl.value) addrEl.value = payload.addr || "";
  if (depEl && !depEl.value) depEl.value = payload.depositWon || "";
  if (nameEl && !nameEl.value) nameEl.value = payload.landlordName || "";
  if (dateEl && !dateEl.value) dateEl.value = payload.contractDate || "";

  // 배너 표시(왜 필요한지 근거 포함)
  if (banner) {
    const reasons = payload?.risk?.reasons ?? [];
    banner.hidden = false;
    banner.style.cssText = `
      margin:14px 0 0; padding:12px 14px; border-radius:12px;
      border:1px solid #e9e9e9; background:#f7fbff;
    `;

    banner.innerHTML = `
      <div style="font-weight:800; margin-bottom:6px;">MAP에서 선택한 매물</div>
      <div style="color:#333; line-height:1.5;">
        <b>${escapeHtml(payload.title || "(선택 매물)")}</b><br/>
        <span style="color:#555;">${escapeHtml(payload.addr || "")}</span>
      </div>

      <div style="margin-top:8px; color:#666; font-size:13px; line-height:1.5;">
        지도 점수는 참고용입니다. 계약 전 핵심은 <b>등기부(근저당/경매/권리제한)</b> 확인이에요.
      </div>

      ${
        reasons.length
          ? `<ul style="margin:8px 0 0; padding-left:18px; color:#444; font-size:13px; line-height:1.5;">
              ${reasons.slice(0, 3).map(r => `<li>${escapeHtml(r)}</li>`).join("")}
            </ul>`
          : ""
      }
    `;
  }

  // “이전 매물”로 남아있지 않게 한 번 쓰고 지우고 싶으면:
  // sessionStorage.removeItem("trust_prefill");
})();

(function prefillFromMap() {
  let payload = null;

  try {
    const raw = sessionStorage.getItem("trust_prefill");
    if (!raw) return;
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  if (!payload || payload.from !== "map") return;

  const addrEl = document.getElementById("address");
  const depEl = document.getElementById("depositWon");

  // ✅ 비어있을 때만 자동 채움 (사용자 입력 덮어쓰기 방지)
  if (addrEl && !String(addrEl.value || "").trim()) {
    addrEl.value = payload.addr || payload.address || "";
  }
  if (depEl && !String(depEl.value || "").trim()) {
    depEl.value = payload.depositWon || "";
  }
})();
