const $messages = document.getElementById("chatMessages");
const $form = document.getElementById("chatForm");
const $text = document.getElementById("chatText");
const $quickBtns = document.querySelectorAll(".quick-btn");

/** ✅ 단계별(버튼) 답변 템플릿 */
const TOPICS = {
  step1: {
    title: "1) 계약 전 체크(매물/집주인/중개",
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
    title: "2) 등기부등본 확인(핵심)",
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

  step3: {
    title: "3) 신뢰도 검사(너희 TRUST 기능 연결 포인트)",
    body:
`여기서는 네 사이트의 TRUST 탭(임대인 신뢰 검사)로 연결되게 만들면 딱 좋아.

추천 구성(점검 항목 예시):
① 등기부 위험 키워드 탐지(경매/압류/가압류/신탁/근저당 등)
② 보증금 적정성(유사 면적 중앙값 대비 과도/과소)
③ 계약 안전장치 체크(특약/확정일자/전입신고/보증보험 가능성)
④ ‘불확실’ 표시(표본 부족 시 ‘정상’이 아니라 ‘정보 부족’)

원하면 버튼 누르면 TRUST 페이지로 이동하거나,
채팅창 안에서 결과 요약까지 보여주도록 연결할 수 있어.`
  },

  step4: {
    title: "4) 계약/입주 안전장치(특약/확정일자/전입)",
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
    title: "5) 의심/피해 대처(즉시 행동 체크리스트)",
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
    return "등기부 관련이면 ‘갑구=소유/권리’, ‘을구=담보’부터 보고, 경매/압류/신탁/근저당을 체크해. 원하면 등기부 문구(개인정보 가림)를 붙여줘.";
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
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  $messages.appendChild(div);
  $messages.scrollTop = $messages.scrollHeight;
}

function botTopic(topicKey) {
  const topic = TOPICS[topicKey];
  if (!topic) return;
  addMessage("user", `(${topic.title}) 자세히 알려줘`);
  addMessage("bot", `${topic.title}\n\n${topic.body}`);
}

/** 초기 인삿말 */
addMessage("bot",
`안녕! 전세사기 대처를 단계별로 안내할게.
아래 버튼을 누르거나, 질문을 그냥 입력해도 돼.`);

/** 버튼 클릭 */
$quickBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.topic;
    botTopic(key);
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
  const reply = freeChatReply(text);
  addMessage("bot", reply);

  // ✅ 2) 나중에 진짜 챗봇(서버/LLM)로 바꾸려면 아래 방식으로 교체
  // const res = await fetch("/api/chat", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ message: text })
  // });
  // const data = await res.json();
  // addMessage("bot", data.reply);
});
