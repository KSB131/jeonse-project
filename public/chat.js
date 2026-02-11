const $messages = document.getElementById("chatMessages");
const $form = document.getElementById("chatForm");
const $text = document.getElementById("chatText");
const $quickBtns = document.querySelectorAll(".quick-btn");

/** ✅ 단계별(버튼) 답변 템플릿 */
const TOPICS = {
  step1: {
    title: "(1) 계약 전 체크(매물/집주인/중개)",
    body:
`아래 순서대로 확인해봐.

① ‘시세 대비 너무 싸다/너무 비싸다’ 체크
- 주변 유사 면적 전세가와 비교(같은 동/비슷한 평형/최근 3~6개월).
- 터무니없이 싼 전세는 미끼일 수 있어.

② 중개사무소/중개인 확인
- 공인중개사 등록 여부 확인(상호/등록번호/대표자).
- 계약서에 중개대상물 확인설명서가 포함되는지.

③ 집주인(임대인) 확인
- 신분증 + 등기부상의 소유자 동일인인지.
- 대리인 계약이면 위임장/인감증명 등 서류 필수.

원하면 “내가 전세(아파트/오피스텔/주택)이고 보증금 OO인데 뭘 먼저 볼까?”처럼 상황을 적어줘.`
  },

  step2: {
    title: "(2) 등기부등본 확인(핵심)",
    body:
`등기부는 ‘계약 전’과 ‘잔금 직전’ 최소 2번 확인해.

① 갑구(소유권)
- 소유자가 누구인지, 소유권 이전이 최근/잦은지 확인.
- ‘가처분/가압류/압류/경매개시’ 같은 문구가 있으면 위험 신호.

② 을구(담보권)
- 근저당/저당 등 담보 설정이 있는지 확인.
- (안전하게 하려면) 보증금 + 선순위 담보 합이 집값을 넘지 않도록.

③ 신탁 여부
- ‘신탁’이면 실제 권한자가 달라질 수 있어 절차가 복잡해짐.
- 신탁원부/수탁자 동의 등 확인 필요.

원하면 등기부 텍스트를 붙여주면 “위험 신호”를 뽑아서 설명해줄게(개인정보는 가리고).`
  },

  step4: {
    title: "(3) 계약/입주 안전장치(특약/확정일자/전입)",
    body:
`실전에서 많이 놓치는 순서야.

① 계약서 특약
- “잔금 지급 전 등기부 변동 없을 것”
- “위반 시 계약 해제 및 손해배상”
- “보증보험 가입 불가 시 계약 해제” 등

② 확정일자 / 전입신고(우선변제 관련)
- 보통 ‘입주 + 전입신고 + 확정일자’가 중요.
- 타이밍은 상황(이사일, 잔금일)에 맞춰 정확히.

③ 보증보험(가능하면)
- HUG/SGI 등 조건 확인(주택 종류/시세/선순위 채권 등).

너가 “잔금일이 언제고, 전입/확정일자 언제 가능”인지 말해주면 일정 순서로 정리해줄게.`
  },

  step5: {
    title: "(4) 의심/피해 대처(즉시 행동 체크리스트)",
    body:
`의심될 때는 “증거 확보 + 지급 중단 + 상담/신고”가 핵심이야.

① 증거 확보
- 계약서/특약/이체내역/대화(문자·카톡)/중개대상물 확인설명서 저장.

② 돈 관련
- 잔금 전이면 지급 중단하고 등기부 재확인.
- 이미 지급했다면 법률상 조치(가압류 등) 상담이 필요할 수 있어.

③ 상담/신고 루트(지역별/상황별로 다름)
- 전세피해 지원센터/지자체 상담
- 경찰 신고(사기 의심)
- 법률구조공단/변호사 상담

현재 상태가 “계약 전/가계약/계약 완료/입주 완료/피해 발생” 중 어디인지 말해줘. 그 단계 기준으로 순서를 더 촘촘히 안내해줄게.`
  }
};

/** ✅ 자유 대화용: 아주 간단 키워드 매칭(추후 서버/LLM로 교체 가능) */
function freeChatReply(text) {
  const t = (text || "").trim();

  if (!t) return "내용이 비어 있어. 궁금한 걸 한 줄로 적어줘!";

  if (/등기|등기부|갑구|을구/.test(t)) {
  addBotAction(
    "등기부 확인은 TRUST에서 바로 분석할 수 있어.",
    [
      { label: "TRUST로 이동", type: "nav", url: "/trust" },
      { label: "등기부 핵심 체크리스트 보기", type: "nav", url: "/chat#step2" } // (선택)
    ]
  );
  return null; // <- 호출부에서 null이면 addMessage 안 하게 처리
}
  if (/전입|확정|확정일자/.test(t)) {
    return "전입신고/확정일자는 우선변제에 중요해. 잔금일/입주일/이사 가능 날짜를 알려주면 ‘언제 뭘 먼저’ 순서로 딱 정리해줄게.";
  }
  if (/보증보험|hug|sgi/i.test(t)) {
    return "보증보험은 주택유형/시세/선순위 담보/보증금 규모에 따라 가능 여부가 갈려. 주택종류(아파트/오피스텔/주택), 보증금, 근저당 유무를 알려줘.";
  }
  if (/사기|의심|피해|먹튀|잠수/.test(t)) {
    return "의심/피해 상황이면 ‘증거 확보→등기부 재확인→지급 중단(가능 시)→상담/신고’ 순서가 좋아. 지금 단계가 계약 전/계약 후/입주 후 중 어디야?";
  }

  return "좋아. 더 정확히 안내하려면 ‘주택 종류 + 보증금 + 계약 단계(계약 전/후, 잔금 전/후)’를 같이 적어줘!";
}

/** UI helpers */
const history = [];
function addMessage(role, text) {
  const div = document.createElement("div");
  
  div.className = `msg ${role}`;
  div.textContent = text;
  $messages.appendChild(div);

  // 기본은 맨 아래로
  $messages.scrollTop = $messages.scrollHeight;

  history.push({ role: role === "bot" ? "assistant" : "user", content: text });

  return div; // ✅ 추가: 만든 요소 반환
}

function scrollMsgToTop(el, extra = 14) {
  if (!el) return;

  const container = $messages;

  // ✅ 컨테이너의 padding-top 만큼은 기본 여유로 잡아줌
  const cs = getComputedStyle(container);
  const padTop = parseFloat(cs.paddingTop) || 0;

  // ✅ container 기준으로 el의 위치를 정확히 계산
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  // 현재 scrollTop + (요소 top - 컨테이너 top)
  const targetTop = container.scrollTop + (elRect.top - containerRect.top);

  // ✅ padding + extra 만큼 내려서 "윗줄 잘림" 방지
  const top = Math.max(0, targetTop - padTop - extra);

  container.scrollTo({ top, behavior: "smooth" });
}

function botTopic(topicKey) {
  const topic = TOPICS[topicKey];
  if (!topic) return;

  addMessage("user", `${topic.title} 자세히 알려줘`);
  const botEl = addMessage("bot", `${topic.title}\n\n${topic.body}`);

  // ✅ 렌더/줄바꿈 확정까지 기다렸다가 스크롤
  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollMsgToTop(botEl, 18));
  });

  if (topicKey === "step1") {
    showStepMenu_2to5();
  }
}




function addBotAction(text, actions = [], opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";

  const p = document.createElement("div");
  p.textContent = text;
  wrap.appendChild(p);

  if (actions.length) {
    const row = document.createElement("div");
    row.style.marginTop = "8px";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.flexWrap = "wrap";

    actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.className = "chat-action-btn";
      b.addEventListener("click", () => runAction(a));
      row.appendChild(b);
    });

    wrap.appendChild(row);
  }

  $messages.appendChild(wrap);

  // ✅ 기본은 기존처럼 맨 아래로, 필요할 때만 끄기
  if (opts.autoScroll !== false) {
    $messages.scrollTop = $messages.scrollHeight;
  }

  return wrap; // (원하면 반환)
}


function showStepMenu_2to5(opts = {}) {
  addBotAction(
    "더 궁금한 점이 있으면 버튼을 누르거나, 채팅으로 질문해 주세요",
    [
      { label: "(2) 등기부등본 확인", type: "topic", topicKey: "step2" },
      { label: "(3) 계약/입주 안전장치", type: "topic", topicKey: "step4" },
      { label: "(4) 의심/피해 대처", type: "topic", topicKey: "step5" },
    ],
    opts
  );
}

async function runAction(a) {
  if (a.type === "topic") {
    const topic = TOPICS[a.topicKey];
    if (!topic) return;

    addMessage("user", `${topic.title} 자세히 알려줘`);
    const botEl = addMessage("bot", `${topic.title}\n\n${topic.body}`);

    // 메뉴는 스크롤 내리지 않게
    showStepMenu_2to5({ autoScroll: false });

    // ✅ 메뉴까지 렌더된 후, 본문 맨 위를 안전하게 보여주기
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollMsgToTop(botEl, 24));
    });

    return;
  }

  if (!a || !a.type) return;

  // 1) 단순 이동
  if (a.type === "nav") {
    if (a.payloadKey && a.payload) {
      sessionStorage.setItem(a.payloadKey, JSON.stringify(a.payload));
    }
    window.location.href = a.url;
    return;
  }

  // 2) RTMS 비교 (CHAT에서 바로 결과 보여주기)
  if (a.type === "rtms_compare") {
    // a.input: { category, area, depositManwon, lawdCd }
    const { category, area, depositManwon, lawdCd } = a.input || {};
    if (!category || !area || !depositManwon) {
      addMessage("bot", "RTMS 비교에는 (유형/면적/보증금)이 필요해. 아래 입력폼으로 다시 시도해줘.");
      showRtmsMiniForm();
      return;
    }

    try {
      const fromYmd = "202602"; // 너 서버 기본값과 동일하게 맞춤
      const url = `/api/rtms-compare?lawdCd=${encodeURIComponent(lawdCd || "29140")}&fromYmd=${fromYmd}&maxBack=12`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data?.ok) throw new Error(data?.error || "RTMS compare failed");

      // category -> rtms kind 매핑
      const kind = category === "officetel" ? "offi" : category === "house-villa" ? "house" : "apt";
      const pool = data?.items?.[kind] || [];

      // ±3㎡ 중앙값
      const tArea = Number(area);
      const deps = pool
        .filter((x) => x?.area != null && x?.deposit != null)
        .filter((x) => Math.abs(Number(x.area) - tArea) <= 3)
        .map((x) => Number(x.deposit))
        .filter((v) => Number.isFinite(v));

      deps.sort((x, y) => x - y);
      const med = deps.length
        ? (deps.length % 2 ? deps[(deps.length - 1) / 2] : (deps[deps.length / 2 - 1] + deps[deps.length / 2]) / 2)
        : null;

      const dep = Number(depositManwon);
      const ratio = (med && med > 0) ? dep / med : null;

      const msgLines = [];
      msgLines.push(`RTMS 비교 결과 (표본: ${deps.length}건, 기준면적: ${tArea}㎡ ±3㎡)`);
      if (!med) {
        msgLines.push("→ 해당 조건의 표본이 부족해서 ‘적정’ 판단이 어려워. MAP에서 주변 매물/AI점수로 같이 보는 걸 추천해.");
      } else {
        msgLines.push(`- 입력 보증금: ${dep.toLocaleString()}만원`);
        msgLines.push(`- 유사 면적 중앙값: ${Math.round(med).toLocaleString()}만원`);
        msgLines.push(`- 비율: ${(ratio * 100).toFixed(0)}% (=${ratio.toFixed(2)}x)`);

        if (ratio >= 1.35) msgLines.push("→ 유사 면적 대비 ‘높은 편’(주의 신호 가능)");
        else if (ratio >= 1.2) msgLines.push("→ 유사 면적 대비 ‘다소 높은 편’");
        else if (ratio <= 0.8) msgLines.push("→ 유사 면적 대비 ‘비정상적으로 낮음’(주의 신호 가능)");
        else if (ratio <= 0.9) msgLines.push("→ 유사 면적 대비 ‘낮은 편’");
        else msgLines.push("→ 유사 면적 대비 ‘대체로 적정 범위’");
      }

      addBotAction(msgLines.join("\n"), [
        {
          label: "MAP에서 주변 매물 비교",
          type: "nav",
          url: "/map",
          payloadKey: "map_prefill",
          payload: {
            from: "chat",
            mode: "compare",
            addr: "", // 주소가 있으면 넣어도 됨
          },
        },
        { label: "TRUST에서 등기부 점검", type: "nav", url: "/trust" },
      ]);
    } catch (e) {
      addMessage("bot", `RTMS 비교 실패: ${String(e?.message || e)}`);
    }
    return;
  }
}

function showRtmsMiniForm() {
  const box = document.createElement("div");
  box.className = "msg bot";

  box.innerHTML = `
    <div style="margin-bottom:6px;">RTMS 비교에 필요한 값만 입력해줘.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <select id="rtmsCat" style="padding:6px;">
        <option value="apt">아파트</option>
        <option value="officetel">오피스텔</option>
        <option value="house-villa">주택/빌라</option>
      </select>
      <input id="rtmsArea" type="number" placeholder="전용면적(㎡)" style="padding:6px;width:140px;" />
      <input id="rtmsDep" type="number" placeholder="보증금(만원)" style="padding:6px;width:140px;" />
      <button type="button" id="rtmsGo" style="padding:6px 10px;">비교하기</button>
    </div>
    <div style="margin-top:6px;color:#666;font-size:12px;">* 광주 서구(29140) 기준, 최근 거래월을 자동 탐색</div>
  `;

  $messages.appendChild(box);
  $messages.scrollTop = $messages.scrollHeight;

  box.querySelector("#rtmsGo").addEventListener("click", () => {
    const category = box.querySelector("#rtmsCat").value;
    const area = box.querySelector("#rtmsArea").value;
    const depositManwon = box.querySelector("#rtmsDep").value;

    runAction({
      type: "rtms_compare",
      input: { category, area, depositManwon, lawdCd: "29140" },
    });
  });
}


/** 초기 인삿말 */
addMessage("bot",
`안녕! 전세사기 대처를 단계별로 안내할게.
아래 버튼을 누르거나, 질문을 그냥 입력해도 돼.`);

/** 버튼 클릭 */
$quickBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const topicKey = btn.dataset.topic;
    const actionKey = btn.dataset.action;

    // 1) 가이드 템플릿
    if (topicKey) return botTopic(topicKey);

    // 2) 툴 연결
    if (actionKey === "go_trust") {
      addBotAction("등기부 점검을 TRUST에서 진행할게.", [
        { label: "TRUST로 이동", type: "nav", url: "/trust" },
      ]);
      return;
    }

    if (actionKey === "go_map_nearby") {
      addBotAction("내 주변 매물을 MAP에서 보여줄게.", [
        {
          label: "MAP으로 이동",
          type: "nav",
          url: "/map",
          payloadKey: "map_prefill",
          payload: { from: "chat", mode: "compare", addr: "" }, // addr 있으면 넣기
        },
      ]);
      return;
    }

    if (actionKey === "rtms_check") {
      addBotAction("보증금이 적정한지 RTMS(실거래)로 비교해볼게. 값 3개만 입력해줘.", [
        { label: "입력하기", type: "custom_show_rtms_form" },
      ]);
      showRtmsMiniForm();
      return;
    }
  });
});


/** 자유 입력 */
$form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $text.value.trim();
  if (!text) return;

  addMessage("user", text);
  $text.value = "";

  // ✅ 1) 지금은 로컬 룰 기반 답변
  // const reply = freeChatReply(text);
  // if (typeof reply === "string") addMessage("bot", reply);

  // ✅ 2) 나중에 진짜 챗봇(서버/LLM)로 바꾸려면 아래 방식으로 교체
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await res.json();
    addMessage("bot", data.reply || "응답이 없어요.");
  } catch (err) {
    addMessage("bot", `서버 연결 오류: ${String(err?.message || err)}`);
  }
});

