import express from "express";
import axios from "axios";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();
const PORT = 3000;

const DEFAULT_ARTICLE_URL = "http://2we.co.kr/news_view.jsp?ncd=29559";

// =====================
// Utils
// =====================
function safeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSpaces(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

function summarizeTo1_2Lines(text = "") {
  const s = normalizeSpaces(text);
  if (!s) return "";
  const max = 170;
  return s.length > max ? s.slice(0, max).trim() + "…" : s;
}

function extractTitleFallback(doc) {
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) return og.trim();

  const tw = doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content");
  if (tw) return tw.trim();

  return (doc.querySelector("title")?.textContent || "").trim();
}

function extractDescFallback(doc) {
  const og = doc.querySelector('meta[property="og:description"]')?.getAttribute("content");
  if (og) return og.trim();

  const md = doc.querySelector('meta[name="description"]')?.getAttribute("content");
  if (md) return md.trim();

  return "";
}

function trimFooter(text = "") {
  const s = normalizeSpaces(text);
  if (!s) return "";

  // ✅ 푸터 시작을 알리는 대표 키워드(사이트들 공통)
  const markers = [
    "제호", "주소", "전화", "팩스", "청소년보호책임자", "등록번호",
    "발행", "편집인", "저작권", "개인정보처리방침", "이용약관"
  ];

  let cut = s.length;

  for (const m of markers) {
    const i = s.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }

  // marker가 너무 앞쪽(본문 거의 없음)이면 자르지 않음
  const trimmed = s.slice(0, cut).trim();
  return trimmed.length >= 80 ? trimmed : s;
}


// ✅ 하단/공통 문구가 요약으로 잡히는 것 방지용(대표 키워드)
function looksLikeFooter(text = "") {
  const t = normalizeSpaces(text).toLowerCase();
  if (!t) return true;

  const bad = [
    "제호", "주소", "전화", "팩스", "청소년보호책임자", "등록번호",
    "발행", "편집인", "저작권", "copyright", "all rights",
    "개인정보처리방침", "이용약관"
  ].map(x => x.toLowerCase());

  let hit = 0;
  for (const k of bad) if (t.includes(k)) hit++;

  // ✅ 전체가 거의 footer일 때만 footer로 판단 (기준 완화)
  if (hit >= 4) return true;

  // ✅ “주소 + 전화” 같이 아주 푸터스러운 조합일 때만
  if (t.includes("주소") && t.includes("전화") && t.length < 400) return true;

  return false;
}


async function fetchHtml(url) {
  const r = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7"
    }
  });
  return r.data;
}

// ✅ 사이트별 본문 selector 우선 추출 (여기 계속 추가하면 정확도 급상승)
function extractBySelectors(doc, url) {
  // 2we 전용 후보들 (페이지 구조에 따라 다를 수 있어 여러 후보를 둠)
  const selectorsFor2we = [
    "#newsView",                 // 예: 본문 wrapper id일 가능성
    ".news_view",                // 예: 본문 wrapper class일 가능성
    ".article_view",             // 흔한 네이밍
    ".article",                  // 흔한 네이밍
    ".content",                  // 흔한 네이밍
    "article",                   // 최후 후보
    "#content"                   // 최후 후보
  ];

  const is2we = /(^|\.)2we\.co\.kr$/i.test(new URL(url).hostname);

  const selectors = is2we ? selectorsFor2we : [
    "article",
    '[itemprop="articleBody"]',
    ".article-body",
    ".articleBody",
    ".news_body",
    ".view_body",
    "#articleBody",
    "#article_body",
    "#content"
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;

    // 광고/댓글/푸터 섞이는 거 줄이기: 스크립트/스타일/네비/푸터 제거
    el.querySelectorAll("script, style, nav, footer, header, aside, form").forEach(x => x.remove());

    let text = normalizeSpaces(el.textContent || "");
text = trimFooter(text);              // ✅ 추가
if (text.length < 80) continue;
if (looksLikeFooter(text)) continue;
return text;
  }
  return "";
}

function readabilityExtract(doc, url) {
  const reader = new Readability(doc, { charThreshold: 80 });
  const article = reader.parse();
  const text = normalizeSpaces(article?.textContent || "");
  return { title: article?.title || "", text };
}

// =====================
// Routes
// =====================
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>기사 크롤링 테스트</title>
  <link rel="icon" href="data:,">
  <style>
    :root{--bg:#0b0f14;--card:rgba(255,255,255,.04);--line:rgba(255,255,255,.12);--txt:#eaf0f3;--muted:rgba(234,240,243,.72);--accent:#8fd3e8;}
    *{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans KR",sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:24px 16px 60px}
    .card{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:16px}
    .row{display:flex;gap:10px;flex-wrap:wrap}
    input{flex:1;min-width:260px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:var(--txt);padding:0 12px;outline:none}
    button{height:42px;padding:0 14px;border-radius:999px;border:1px solid rgba(143,211,232,.35);background:rgba(143,211,232,.18);color:#cfeef6;font-weight:900;cursor:pointer}
    button:hover{filter:brightness(1.05)}
    h1{margin:0 0 10px;font-size:18px}
    .sub{color:var(--muted);font-size:12px;line-height:1.5;margin:0 0 14px}
    .out{margin-top:14px}
    .title{font-weight:900;font-size:15px;line-height:1.35}
    .sum{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.55}
    .small{margin-top:10px;font-size:12px;opacity:.8}
    a{color:var(--accent);text-decoration:none}
    .err{margin-top:12px;color:#ffb4b4;font-size:13px;line-height:1.5}
    .pill{display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.16);font-size:11px;opacity:.85}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>기사 크롤링 테스트 (제목 + 1~2줄 요약)</h1>
      <p class="sub">
        ✅ 추출 우선순위: <span class="pill">사이트 selector</span> → <span class="pill">Readability</span> → <span class="pill">meta description</span><br/>
        (footer/공통 문구가 요약으로 잡히는 문제를 방지합니다)
      </p>

      <div class="row">
        <input id="url" value="${DEFAULT_ARTICLE_URL}" />
        <button id="go" type="button">가져오기</button>
      </div>

      <div class="out" id="out"></div>
      <div class="err" id="err" hidden></div>
    </div>
  </div>

<script>
  const $url = document.getElementById("url");
  const $out = document.getElementById("out");
  const $err = document.getElementById("err");
  const $go = document.getElementById("go");

  function esc(s=""){
    return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  async function run(){
    $err.hidden = true;
    $out.innerHTML = "<div style='opacity:.75'>불러오는 중…</div>";

    try{
      const u = encodeURIComponent($url.value.trim());
      const r = await fetch("/api/article?url=" + u, { cache:"no-store" });
      const data = await r.json();
      if(!data.ok) throw new Error(data.message || "failed");

      $out.innerHTML = \`
        <div class="title">\${esc(data.title || "(제목 없음)")}</div>
        <div class="sum">\${esc(data.summary || "(요약 없음)")}</div>
        <div class="small">
          추출 방식: <b>\${esc(data.method)}</b><br/>
          원문: <a href="\${esc(data.url)}" target="_blank" rel="noopener noreferrer">\${esc(data.url)}</a>
        </div>
      \`;
    }catch(e){
      $out.innerHTML = "";
      $err.hidden = false;
      $err.textContent = "실패: " + (e.message || String(e));
    }
  }

  $go.addEventListener("click", run);
  run();
</script>
</body>
</html>`);
});

app.get("/api/article", async (req, res) => {
  const input = req.query.url || "";
  const url = safeUrl(input);
  if (!url) return res.status(400).json({ ok: false, message: "url 파라미터가 올바르지 않습니다." });

  try {
    const html = await fetchHtml(url);

    // ✅ JSDOM CSS 파싱 경고 숨기기
    const vc = new VirtualConsole();
    vc.on("jsdomError", (err) => {
      const msg = String(err?.message || "");
      if (msg.includes("Could not parse CSS stylesheet")) return;
      // 필요하면 다른 경고는 출력
      // console.warn("[jsdomError]", msg);
    });

    const dom = new JSDOM(html, { url, virtualConsole: vc });
    const doc = dom.window.document;

    const title = extractTitleFallback(doc);

    // 1) selector 우선
    let text = extractBySelectors(doc, url);
    let method = "selector";

    // 2) selector 실패 -> Readability
    if (!text) {
  const rd = readabilityExtract(doc, url);
  text = trimFooter(rd.text);         // ✅ 추가
  method = "readability";

  if (looksLikeFooter(text)) {
    text = "";
  }
}


    // 3) 둘 다 실패 -> meta description
    if (!text) {
      text = extractDescFallback(doc);
      method = "meta";
    }

    const summary = summarizeTo1_2Lines(text);

    res.json({
      ok: true,
      url,
      title,
      summary,
      method
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || "fetch/parse failed" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ http://localhost:${PORT}`);
});
