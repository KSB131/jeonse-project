import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { spawn } from "child_process";
import { XMLParser } from "fast-xml-parser";
import multer from "multer";
import fs from "fs";
import { createRequire } from "module";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import crypto from "crypto";

const require = createRequire(import.meta.url);

const pdfParseFn = require("pdf-parse"); // ✅ v1.1.1은 여기서 바로 함수가 나옴
console.log("[pdf-parseFn typeof]", typeof pdfParseFn);

console.log("[pdf-parseFn typeof]", typeof pdfParseFn);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use("/src", express.static(path.join(__dirname, "src")));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "main.html"));
});

app.get("/map", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "map.html"));
});

app.get("/trust", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "trust.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/signup", (req,res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/forgot", (req,res) => res.sendFile(path.join(__dirname, "public", "forgot.html")));


// server.js (추가)
app.use(express.json({ limit: "1mb" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ 매우 단순한 쿠키 기반 세션(데모)
const SESSIONS = new Map(); // sid -> { userId, createdAt }
const COOKIE_NAME = "sid";

function parseCookies(req){
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(p => {
    const [k, ...v] = p.trim().split("=");
    if(!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}
function setCookie(res, name, value){
  // httpOnly + sameSite 최소
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`);
}
function clearCookie(res, name){
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

const USERS_PATH = path.join(__dirname, "data", "users.json");
fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });

function readUsers(){
  try{
    const txt = fs.readFileSync(USERS_PATH, "utf-8");
    return JSON.parse(txt || "[]");
  }catch{
    return [];
  }
}
function writeUsers(users){
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), "utf-8");
}

function hashPassword(pw, salt){
  // scrypt로 간단 해시
  const key = crypto.scryptSync(pw, salt, 32);
  return key.toString("hex");
}

function newId(){
  return crypto.randomBytes(16).toString("hex");
}

function getSessionUser(req){
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if(!sid) return null;

  const sess = SESSIONS.get(sid);
  if(!sess) return null;

  const users = readUsers();
  return users.find(u => u.id === sess.userId) || null;
}

app.get("/api/auth/me", (req, res) => {
  const u = getSessionUser(req);
  if(!u) return res.json({ ok:true, user:null });
  res.json({ ok:true, user: { id:u.id, email:u.email, name:u.name, provider:u.provider || "local" } });
});

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if(!name || !email || !password) return res.status(400).json({ ok:false, message:"필수값 누락" });
  if(String(password).length < 6) return res.status(400).json({ ok:false, message:"비밀번호는 6자 이상" });

  const users = readUsers();
  const exists = users.some(u => u.email.toLowerCase() === String(email).toLowerCase());
  if(exists) return res.status(409).json({ ok:false, message:"이미 가입된 이메일입니다" });

  const salt = crypto.randomBytes(16).toString("hex");
  const user = {
    id: newId(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    salt,
    passwordHash: hashPassword(String(password), salt),
    provider: "local",
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  // ✅ 자동 로그인
  const sid = newId();
  SESSIONS.set(sid, { userId: user.id, createdAt: Date.now() });
  setCookie(res, COOKIE_NAME, sid);

  res.json({ ok:true });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ ok:false, message:"이메일/비밀번호를 입력해 주세요" });

  const users = readUsers();
  const u = users.find(x => x.email === String(email).trim().toLowerCase());
  if(!u) return res.status(401).json({ ok:false, message:"이메일 또는 비밀번호가 올바르지 않습니다" });

  const h = hashPassword(String(password), u.salt);
  if(h !== u.passwordHash) return res.status(401).json({ ok:false, message:"이메일 또는 비밀번호가 올바르지 않습니다" });

  const sid = newId();
  SESSIONS.set(sid, { userId: u.id, createdAt: Date.now() });
  setCookie(res, COOKIE_NAME, sid);
  res.json({ ok:true });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if(sid) SESSIONS.delete(sid);
  clearCookie(res, COOKIE_NAME);
  res.json({ ok:true });
});

// ✅ 비밀번호 찾기(데모: 임시 비밀번호를 생성해서 저장 + 응답으로도 반환)
app.post("/api/auth/forgot", (req, res) => {
  const { email } = req.body || {};
  if(!email) return res.status(400).json({ ok:false, message:"이메일을 입력해 주세요" });

  const users = readUsers();
  const u = users.find(x => x.email === String(email).trim().toLowerCase());
  if(!u) return res.status(404).json({ ok:false, message:"해당 이메일로 가입된 계정이 없습니다" });

  const tempPassword = Math.random().toString(36).slice(2, 10); // 8자리
  u.salt = crypto.randomBytes(16).toString("hex");
  u.passwordHash = hashPassword(tempPassword, u.salt);
  writeUsers(users);

  // 실제 서비스면 이메일 발송. 지금은 데모로 화면에 보여주기 위해 반환.
  res.json({ ok:true, tempPassword });
});

function ensureDemoSocialUser(provider){
  const users = readUsers();
  const email = `${provider}_demo@demo.local`;
  let u = users.find(x => x.email === email);
  if(!u){
    u = {
      id: newId(),
      name: provider === "google" ? "Google User" : "Kakao User",
      email,
      salt: "social",
      passwordHash: "social",
      provider,
      createdAt: new Date().toISOString(),
    };
    users.push(u);
    writeUsers(users);
  }
  return u;
}

// ✅ 실제 OAuth로 바꾸려면 여기에서 provider별 인증 플로우 구현하면 됨
app.get("/auth/google", (req, res) => {
  // 키 없으면 데모 로그인
  const u = ensureDemoSocialUser("google");
  const sid = newId();
  SESSIONS.set(sid, { userId: u.id, createdAt: Date.now() });
  setCookie(res, COOKIE_NAME, sid);

  // iframe에서 열렸어도 정상 동작: login.html을 다시 닫게 하기 위해 "성공 페이지"로 이동
  res.send(`
    <script>
      if(window.opener) window.opener.postMessage({type:"AUTH_SUCCESS"}, "*");
      if(window.parent) window.parent.postMessage({type:"AUTH_SUCCESS"}, "*");
      location.href="/";
    </script>
  `);
});

app.get("/auth/kakao", (req, res) => {
  const u = ensureDemoSocialUser("kakao");
  const sid = newId();
  SESSIONS.set(sid, { userId: u.id, createdAt: Date.now() });
  setCookie(res, COOKIE_NAME, sid);

  res.send(`
    <script>
      if(window.opener) window.opener.postMessage({type:"AUTH_SUCCESS"}, "*");
      if(window.parent) window.parent.postMessage({type:"AUTH_SUCCESS"}, "*");
      location.href="/";
    </script>
  `);
});


app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) return res.json({ reply: "질문이 비어 있어요. 한 줄로 적어주세요." });

    // (데모용) 시스템 프롬프트: 전세지킴단 톤 + 너 기능 안내
    const system = `
너는 '전세지킴단' 사이트의 전세사기 예방 챗봇이다.
짧고 실전적으로 답한다.
사용자가 원하면 다음 행동을 안내할 수 있다:
- TRUST(등기부 분석)로 이동: /trust
- MAP(주변 매물)로 이동: /map
- RTMS 비교는 채팅 화면의 "보증금 적정? → RTMS 비교" 버튼으로 할 수 있다.
법률 확정 표현(사기 확정 등)은 피하고, "위험 신호/확인 필요"로 말한다.
`.trim();

    // Groq(OpenAI 호환) messages
    const messages = [
      { role: "system", content: system },
      ...history.slice(-12).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "")
      })),
      { role: "user", content: message }
    ];

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant", // 빠르고 충분함 :contentReference[oaicite:3]{index=3}
        messages,
        temperature: 0.4,
        max_tokens: 400,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return res.status(502).json({ reply: `Groq 호출 실패(${r.status}): ${t.slice(0, 200)}` });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "(응답이 비어있어요)";
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ reply: `server error: ${String(e?.message || e)}` });
  }
});


// ✅ 간단 캐시(너무 자주 요청하면 RSS측에서 막을 수 있어서)
let NEWS_CACHE = { ts: 0, items: [] };
const CACHE_MS = 10 * 60 * 1000; // 10분

// ✅ 원하는 RSS로 바꿔도 됨 (부동산/정책/사회 등)
const RSS_FEEDS = [
  { name: "Google News(전세)", url: "https://news.google.com/rss/search?q=전세&hl=ko&gl=KR&ceid=KR:ko" },
  { name: "Google News(부동산)", url: "https://news.google.com/rss/search?q=부동산&hl=ko&gl=KR&ceid=KR:ko" },
  { name: "Google News(정책)", url: "https://news.google.com/rss/search?q=주택%20정책&hl=ko&gl=KR&ceid=KR:ko" },

  // 남겨도 되지만, 이게 실패해도 위 3개로 무조건 채워짐
  { name: "국토교통부 보도자료", url: "https://www.molit.go.kr/rss/USR/WPGE0201/m_354.rss" },
];

function decodeHtmlEntities(s = "") {
  return String(s)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    // 숫자 엔티티: &#1234;
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// HTML 태그 제거 + 엔티티 디코딩 + 공백 정리
function stripHtml(s = "") {
  const noTags = String(s).replace(/<[^>]*>/g, " ");
  const decoded = decodeHtmlEntities(noTags);
  return decoded.replace(/\s+/g, " ").trim();
}

// RSS item 표준화
function pickFirst(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pickFirst(v[0]);
  // { url: "..." } 같은 경우
  if (typeof v === "object") {
    return v.url || v.href || v["#text"] || "";
  }
  return String(v);
}

function normalizeItem(feedName, it) {
  const title = stripHtml(pickFirst(it.title) || "");

  let link = pickFirst(it.link);
  if (!link && Array.isArray(it.link)) {
    const alt = it.link.find(x => x?.rel === "alternate" && (x?.href || x?.url));
    link = pickFirst(alt?.href || alt?.url);
  }
  if (!link) link = pickFirst(it.guid);

  let desc = stripHtml(
    pickFirst(it.description) || pickFirst(it.summary) || pickFirst(it["content:encoded"]) || ""
  );

  // ✅ Google News에서 description이 "제목 ... 출처" 형태로 오는 경우: 제목 중복 제거
  const t = title.trim();
  if (t && desc.startsWith(t)) {
    desc = desc.slice(t.length).trim();
    // 앞에 남는 구분 기호/점/하이픈 같은 것 정리
    desc = desc.replace(/^[-–—:|·]+\s*/g, "").trim();
  }

  // ✅ 여전히 동일하면 그냥 비우기
  if (desc === t) desc = "";

  const pubDate = pickFirst(it.pubDate) || pickFirst(it.published) || pickFirst(it.updated) || "";

  return { source: feedName, title, description: desc, link, pubDate };
}


// ✅ 전세사기 키워드(강한 키워드)
const JEONSE_FRAUD_KEYWORDS = [
  "전세사기",
  "전세 사기",
  "깡통전세",
  "깡통 전세",
  "보증금 미반환",
  "보증금 반환",
  "전세금 미반환",
  "전세금 반환",
  "임대인 잠적",
  "갭투자 사기",
  "전세보증",
  "전세 보증",
  "전세보증금",
  "전세 보증금",
  "전세사기특별법",
  "전세 사기 특별법",
  "HUG",
  "주택도시보증공사",
  "보증보험",
  "전세보증보험",
  "전세권",
  "대항력",
  "우선변제",
  "경매",
  "근저당",
  "선순위",
  "가압류",
];

function normText(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function isJeonseFraudNews(item) {
  const t = normText(item.title);
  const d = normText(item.description);
  const text = `${t} ${d}`;

  // 1) 강한 키워드가 하나라도 있으면 OK
  if (JEONSE_FRAUD_KEYWORDS.some(k => text.includes(normText(k)))) return true;

  // 2) 보조 규칙: "전세"가 있고 + (사기/피해/보증금/경매 등) 같이 나오면 OK
  const hasJeonse = text.includes("전세");
  const hasFraudSignal =
    text.includes("사기") ||
    text.includes("피해") ||
    text.includes("보증금") ||
    text.includes("미반환") ||
    text.includes("반환") ||
    text.includes("경매") ||
    text.includes("근저당") ||
    text.includes("선순위") ||
    text.includes("가압류");

  return hasJeonse && hasFraudSignal;
}

// ✅ fetch timeout
async function fetchTextWithTimeout(url, ms = 2500, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        ...headers,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await r.text();
    return { text, finalUrl: r.url, status: r.status };
  } finally {
    clearTimeout(timer);
  }
}


app.get("/api/news-debug", async (req, res) => {
  const raw = req.query.url;
  const targetUrl = Array.isArray(raw) ? raw[0] : String(raw || "").trim();
  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: "missing url" });
  }

  try {
    // ✅ 1단계: Google News RSS 링크 HTML
    const r1 = await fetchTextWithTimeout(targetUrl, 4000);
const head1 = String(r1.text || "").slice(0, 500);

    let publisherUrl = null;
    let head2 = null;

    // ✅ 2단계: 원문 URL 추출 후 HTML
    if (targetUrl.includes("news.google.com")) {
      publisherUrl = await resolvePublisherUrlFromGoogleNews(targetUrl);
      const r2 = await fetchTextWithTimeout(publisherUrl, 4000);
head2 = String(r2.text || "").slice(0, 500);
    }

    res.json({
      ok: true,
      inputUrl: targetUrl,
      step1: { head: head1 },
      publisherUrl,
      step2: head2 ? { head: head2 } : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
    console.error("[news-debug]", e);
  }
});



// ✅ 기사 HTML에서 meta description 뽑기 (og 우선)
function extractMetaDescription(html = "") {
  const h = String(html);

  const pick = (re) => {
    const m = h.match(re);
    return m ? stripHtml(m[1]) : "";
  };

  // og:description
  let d =
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i);

  // name="description"
  if (!d) {
    d =
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  }

  // 너무 짧거나 이상하면 버림
  d = (d || "").replace(/\s+/g, " ").trim();
  if (d.length < 20) return "";
  if (d.length > 180) d = d.slice(0, 180).trim() + "…";
  return d;
}

// ✅ Google News RSS 링크(news.google.com/rss/articles/...)에서 "원문 URL" 뽑기
async function resolvePublisherUrlFromGoogleNews(googleNewsUrl) {
  if (!googleNewsUrl || !String(googleNewsUrl).includes("news.google.com")) return googleNewsUrl;

  const { text: html } = await fetchTextWithTimeout(googleNewsUrl, 4000);
  const h = String(html || "");

  // 1) meta refresh
  let m =
    h.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)[^"']*["']/i) ||
    h.match(/content=["'][^"']*url=([^"'>\s]+)[^"']*["'][^>]*http-equiv=["']refresh["']/i);
  if (m?.[1]) return decodeHtmlEntities(m[1]).trim();

  // 2) google redirect url=...
  m = h.match(/https:\/\/www\.google\.com\/url\?[^"'<>]*[?&]url=([^"&]+)[^"'<>]*/i);
  if (m?.[1]) return decodeURIComponent(m[1]).trim();

  // 3) data-n-au="https://publisher..."
  m = h.match(/data-n-au=["'](https?:\/\/[^"']+)["']/i);
  if (m?.[1]) return decodeHtmlEntities(m[1]).trim();

  // 4) a href="https://..." 중 '외부 링크' 첫번째
  const hrefs = [];
  const re = /href=["'](https?:\/\/[^"']+)["']/gi;
  let mm;
  while ((mm = re.exec(h))) hrefs.push(mm[1]);

  const isBadHost = (u) => {
    try {
      const host = new URL(u).hostname;
      return (
        host.endsWith("news.google.com") ||
        host.endsWith("google.com") ||
        host.endsWith("gstatic.com")
      );
    } catch {
      return true;
    }
  };

  const isAssetUrl = (u) => {
  try {
    const p = new URL(u).pathname.toLowerCase();
    // 이미지/리소스 확장자 제외
    return /\.(png|jpg|jpeg|webp|gif|svg|ico|css|js|mp4|mp3|pdf)$/i.test(p);
  } catch {
    return true;
  }
};

  const ext = hrefs.find((u) => !isBadHost(u) && !isAssetUrl(u));
  if (ext) return decodeHtmlEntities(ext).trim();

  // 못 찾으면 원래 링크
  return googleNewsUrl;
}

function looksLikeGoogleBoilerplate(desc = "") {
  const d = String(desc).trim();
  if (!d) return true;
  return (
    d.includes("Google 뉴스가") ||
    d.includes("Google News") ||
    d.includes("종합한 최신 뉴스")
  );
}


// ✅ "구글 RSS description(제목+출처)" 같은 쓰레기값 판별
function looksLikeTitleEcho(title, desc) {
  const t = String(title || "").trim();
  const d = String(desc || "").trim();
  if (!d) return true;

  // 길이가 너무 짧으면 요약이 아님
  if (d.length < 25) return true;

  // 공백/기호 제거 후 비교 (대부분 동일 판별)
  const norm = (s) => s.toLowerCase().replace(/[\s"'`’“”.,·\-–—:|()[\]<>]/g, "");
  const nt = norm(t);
  const nd = norm(d);

  // desc가 title을 거의 포함하면(출처만 붙인 형태 포함) → echo로 판단
  if (nd.includes(nt) || nt.includes(nd)) return true;

  // desc가 title 길이 + 조금 정도면 대부분 "제목+출처"
  if (d.length <= t.length + 15) return true;

  return false;
}

// =========================
// ✅ 기사 본문 요약(Readability) 유틸
// =========================
function summarizeTo1_2Lines(text = "") {
  const s = String(text).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const max = 170; // 1~2줄
  return s.length > max ? s.slice(0, max).trim() + "…" : s;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const r = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    // ✅ 텍스트로만 받기
    responseType: "text",
    transformResponse: [(d) => d], // axios가 이상하게 변환하지 않게
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const ct = String(r.headers?.["content-type"] || "").toLowerCase();

  // ✅ HTML이 아니면(이미지/PDF/바이너리 등) 요약하지 않음
  if (!ct.includes("text/html") && !ct.includes("application/xhtml+xml")) {
    return null;
  }

  return String(r.data || "");
}

function extractTitleFallback(dom) {
  const doc = dom.window.document;
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) return og.trim();

  const tw = doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content");
  if (tw) return tw.trim();

  const t = doc.querySelector("title")?.textContent;
  return (t || "").trim();
}

function extractDescFallback(dom) {
  const doc = dom.window.document;
  const og = doc.querySelector('meta[property="og:description"]')?.getAttribute("content");
  if (og) return og.trim();

  const md = doc.querySelector('meta[name="description"]')?.getAttribute("content");
  if (md) return md.trim();

  return "";
}

async function summarizeFromUrl(url) {
  const u = safeUrl(url);
  if (!u) return "";

  try {
    const html = await fetchHtml(u);
    if (!html) return ""; // ✅ HTML이 아니면 종료

    const dom = new JSDOM(html, { url: u });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    let summary = "";
    if (article?.textContent) summary = summarizeTo1_2Lines(article.textContent);

    if (!summary) summary = summarizeTo1_2Lines(extractDescFallback(dom));
    return summary;
  } catch {
    return "";
  }
}

app.get("/api/news", async (req, res) => {
  try {
    const now = Date.now();

    // ✅ 캐시 강제 갱신 옵션: /api/news?force=1
    const force = String(req.query.force ?? "0") === "1";

    // ✅ 캐시(최소 3개 확보된 캐시만 사용)
    if (!force && NEWS_CACHE.items.length >= 3 && now - NEWS_CACHE.ts < CACHE_MS) {
      return res.json({ ok: true, items: NEWS_CACHE.items });
    }

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

    const all = [];

    for (const feed of RSS_FEEDS) {
      try {
        const r = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const xml = await r.text();
        const data = parser.parse(xml);

        const channel = data?.rss?.channel;
        const rssItems = channel?.item
          ? (Array.isArray(channel.item) ? channel.item : [channel.item])
          : [];

        const atomEntries = data?.feed?.entry
          ? (Array.isArray(data.feed.entry) ? data.feed.entry : [data.feed.entry])
          : [];

        if (rssItems.length) rssItems.forEach((it) => all.push(normalizeItem(feed.name, it)));
        else if (atomEntries.length) atomEntries.forEach((it) => all.push(normalizeItem(feed.name, it)));
      } catch (e) {
        console.warn("[NEWS FEED FAIL]", feed.name, String(e));
      }
    }

    // ✅ title/link 있는 것만 + 중복 제거
    const seen = new Set();
    const cleaned = all
      .filter((x) => x?.title && x?.link)
      .filter((x) => {
        if (seen.has(x.link)) return false;
        seen.add(x.link);
        return true;
      });

    // ✅ 최신순 정렬
    cleaned.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));

    // ✅ 화면에는 최근 3개만
    const top3 = cleaned.slice(0, 3);

    // ✅ (핵심) 최근 3개만 원문 meta description으로 "요약" 보강
    // ✅ (핵심) 최근 3개: "원문 본문(Readability)"로 1~2줄 요약을 만들어 description에 넣기
const enriched = await Promise.all(
  top3.map(async (it) => {
    try {
      const title = (it.title || "").trim();
      const rssDesc = (it.description || "").trim();

      // 1) 먼저 RSS desc가 쓸만하면 그대로 쓰고
      // 2) "제목 복붙/너무 짧음"이면 원문에서 본문요약으로 교체
      const looksBad =
        !rssDesc ||
        rssDesc.length < 30 ||
        looksLikeTitleEcho(title, rssDesc);

      if (!looksBad) return { ...it, description: rssDesc };

      // ✅ Google News 링크면 원문으로 resolve
      const publisherUrl = await resolvePublisherUrlFromGoogleNews(it.link);

      // ✅ 본문 요약(Readability)
      const summary = await summarizeFromUrl(publisherUrl);

      // summary가 있으면 교체, 없으면 RSS desc 유지(혹은 빈값)
      return {
        ...it,
        // 원문으로 바로 보내고 싶으면 아래 주석 해제
        // link: publisherUrl,
        description: summary || rssDesc || "",
      };
    } catch {
      return it;
    }
  })
);



    // ✅ 캐시 저장 (3개 이상일 때)
    if (enriched.length >= 3) {
      NEWS_CACHE = { ts: now, items: enriched };
    } else {
      NEWS_CACHE = { ts: 0, items: [] };
    }

    res.json({ ok: true, items: enriched });
  } catch (e) {
    res.status(500).json({ ok: false, message: "news fetch failed", error: String(e) });
  }
});



// =========================
// ✅ ML-RISK 서버 캐시 (1회 크롤링 고정용: 파일 + 메모리)
// =========================
const ML_CACHE_PATH = path.join(__dirname, "data", "ml_cache.json");
fs.mkdirSync(path.dirname(ML_CACHE_PATH), { recursive: true });

let ML_CACHE = { ts: 0, data: null, running: null };

// ✅ 데모면 길게: 24시간(원하면 더 늘려도 됨)
const ML_CACHE_MS = 24 * 60 * 60 * 1000;

// ✅ 서버 시작 시 파일 캐시 로드
(function loadMlCacheFromDisk() {
  try {
    if (!fs.existsSync(ML_CACHE_PATH)) return;
    const raw = fs.readFileSync(ML_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw || "null");
    if (parsed?.data && parsed?.ts) {
      ML_CACHE.ts = parsed.ts;
      ML_CACHE.data = parsed.data;
      console.log("[ML CACHE] loaded from disk:", new Date(ML_CACHE.ts).toISOString());
    }
  } catch (e) {
    console.warn("[ML CACHE] load fail:", e.message);
  }
})();

function saveMlCacheToDisk() {
  try {
    fs.writeFileSync(
      ML_CACHE_PATH,
      JSON.stringify({ ts: ML_CACHE.ts, data: ML_CACHE.data }, null, 2),
      "utf-8"
    );
    console.log("[ML CACHE] saved to disk");
  } catch (e) {
    console.warn("[ML CACHE] save fail:", e.message);
  }
}

async function computeMlRiskOnce(PORT) {
  // ✅ 여기서만 "크롤링"이 발생 (1회만 실행되게 아래 getMlRiskCached가 막아줌)
  const resp = await fetch(`http://localhost:${PORT}/api/dabang-rooms?maxPages=10&maxItems=800`);
  const data = await resp.json();
  const items = data.items ?? [];

  const py = spawn("python", ["ml/predict.py"], { stdio: ["pipe", "pipe", "pipe"] });

  py.on("error", (e) => {
  console.warn("[PY SPAWN ERROR]", e.message);
});

  let out = "";
  let err = "";

  py.stdout.on("data", (d) => (out += d.toString()));
  py.stderr.on("data", (d) => (err += d.toString()));

  const done = new Promise((resolve) => {
    py.on("close", (code) => {
      if (code !== 0) {
        const enriched = items.map((it) => ({ ...it, mlRiskScore: null, mlRiskGrade: "안전" }));
        return resolve({ model: "fallback(no-ml)", totalCount: enriched.length, items: enriched, err });
      }
      try {
        const parsed = JSON.parse(out);
        const mp = new Map(parsed.predictions.map((p) => [String(p.id), p.risk_score]));
        const enriched = items.map((it) => {
          const s = mp.get(String(it.id)) ?? null;
          return {
            ...it,
            mlRiskScore: s,
            mlRiskGrade: (s ?? 0) >= 60 ? "위험" : (s ?? 0) >= 30 ? "주의" : "안전",
          };
        });
        resolve({ model: parsed.model, totalCount: enriched.length, items: enriched });
      } catch (e) {
        const enriched = items.map((it) => ({ ...it, mlRiskScore: null, mlRiskGrade: "안전" }));
        resolve({ model: "fallback(bad-output)", totalCount: enriched.length, items: enriched, err: String(e) });
      }
    });
  });

  py.stdin.write(JSON.stringify(items));
  py.stdin.end();

  return done;
}

async function getMlRiskCached(PORT, force = false) {
  const now = Date.now();
  const fresh = ML_CACHE.data && (now - ML_CACHE.ts < ML_CACHE_MS);

  // ✅ fresh면 절대 크롤링/ML 안 함
  if (!force && fresh) return ML_CACHE.data;

  // ✅ 동시에 여러 요청 들어와도 "딱 1번"만 실행
  if (ML_CACHE.running) return ML_CACHE.running;

  ML_CACHE.running = (async () => {
    const data = await computeMlRiskOnce(PORT);
    ML_CACHE = { ts: Date.now(), data, running: null };

    // ✅ 파일 저장해서 Render 재시작/페이지 새로고침에도 유지
    saveMlCacheToDisk();
    return data;
  })().catch((e) => {
    ML_CACHE.running = null;
    throw e;
  });

  return ML_CACHE.running;
}

app.get("/api/ml-risk", async (req, res) => {
  try {
    const force = String(req.query.force ?? "0") === "1";
    const data = await getMlRiskCached(PORT, force);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});

/**
 * ✅ 다방 매물 목록 (apt + house-villa + officetel)
 */
app.get("/api/dabang-rooms", async (req, res) => {
  try {
    const bbox = {
      sw: { lat: 35.0864879, lng: 126.7714733 },
      ne: { lat: 35.1839144, lng: 126.8947261 },
    };

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

    // ✅ 공통 필터(기본)
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

  // ✅ apt 필수값(네 로그에 나온 것)
  householdNumRange: { min: 0, max: 999999 },
  parkingNumRange: { min: 0, max: 999999 },
};

    // ✅ 카테고리별로 크롤러 필터링
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

  // ✅ 오피스텔: 네 cURL에 있는 필수값 그대로 반영
  if (catKey === "officetel") {
    return {
      ...BASE_FILTERS,

      // officetel도 SELL 포함(네 cURL 기준)
      sellingTypeList: ["MONTHLY_RENT", "LEASE", "SELL"],

      // ✅ 오피스텔 필수값(네가 받은 400 에러 + cURL 기준)
      parkingNumRange: { min: 0, max: 999999 },
      canParking: false,
      hasElevator: false,
      hasPano: false,
    };
  }

  // apt
  return { ...BASE_FILTERS };
}

    const baseHeaders = {
      accept: "application/json, text/plain, */*",
      "d-api-version": "5.0.0",
      "d-app-version": "1",
      "d-call-type": "web",
      "user-agent": "Mozilla/5.0",
    };

    const MAX_PAGES = Number(req.query.maxPages ?? 30);
    const MAX_ITEMS = Number(req.query.maxItems ?? 800);
    const zoom = String(req.query.zoom ?? 13);
    const useMap = String(req.query.useMap ?? "naver");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const seen = new Set();
    const results = [];

    for (const cat of CATEGORIES) {
      let page = 1;

      while (page <= MAX_PAGES && results.length < MAX_ITEMS) {
        const filtersObj = buildFilters(cat.key);

        const params = new URLSearchParams({
          filters: JSON.stringify(filtersObj),
          bbox: JSON.stringify(bbox),
          zoom,
          useMap,
          page: String(page),
        });

        const url = `${cat.endpoint}?${params.toString()}`;
        const headers = { ...baseHeaders, referer: cat.referer };

        const resp = await fetch(url, { headers });

        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          console.warn("[DABANG FAIL]", cat.key, resp.status, t.slice(0, 300));
          break;
        }

        const data = await resp.json().catch(() => null);
        if (!data || data?.code !== 200) {
          console.warn("[DABANG BAD CODE]", cat.key, data?.code, data?.msg);
          break;
        }

        const r = data.result;
        const list = r?.roomList ?? [];

        // ✅ (버그 수정) 이 로그는 while 내부에서 r/list가 있을 때 찍어야 함
        console.log("[DABANG]", cat.key, "page", page, "got", list.length, "hasMore", r?.hasMore);

        for (const item of list) {
          if (!item?.id) continue;
          if (seen.has(item.id)) continue;

          const dong = item?.dongName ?? "";
          if (dong && !SEOGU_DONGS.has(dong)) continue;

          seen.add(item.id);
          results.push(normalizeDabangItem(item, cat.key));
          if (results.length >= MAX_ITEMS) break;
        }

        if (!r?.hasMore) break;
        page += 1;
        await sleep(150);
      }
    }

    res.json({ totalCount: results.length, items: results });
  } catch (e) {
    res.status(500).json({ error: e?.message || "서버 오류" });
  }
});

/**
 * ✅ 다방 매물 상세 (필수)
 */
app.get("/api/dabang-room-detail", async (req, res) => {
  try {
    const roomId = String(req.query.room_id ?? "").trim();
    if (!roomId) return res.status(400).json({ error: "room_id is required" });

    const url =
      `https://www.dabangapp.com/api/3/new-room/detail` +
      `?room_id=${encodeURIComponent(roomId)}` +
      `&api_version=3.0.1&call_type=web&version=1`;

    const headers = {
      accept: "application/json, text/plain, */*",
      "user-agent": "Mozilla/5.0",
      referer: "https://www.dabangapp.com/map/apt",
    };

    const resp = await fetch(url, { headers });
    const text = await resp.text();

    if (!resp.ok) {
      return res.status(502).json({ error: `dabang detail http ${resp.status}`, raw: text.slice(0, 300) });
    }

    res.type("application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});

/**
 * ✅ 다방 실거래가 (필수)
 */
app.get("/api/dabang-realprice", async (req, res) => {
  try {
    const complexId = String(req.query.complexId ?? "").trim();
    const spaceSeq = String(req.query.spaceSeq ?? "").trim();

    const fromDate = String(req.query.fromDate ?? "202303");
    const toDate = String(req.query.toDate ?? "202602");
    const searchType = String(req.query.searchType ?? "SALE");
    const page = String(req.query.page ?? "1");
    const limit = String(req.query.limit ?? "5");

    if (!complexId || !spaceSeq) return res.status(400).json({ error: "complexId, spaceSeq are required" });

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

    if (!resp.ok) return res.status(resp.status).send(text);
    res.type("application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: e?.message || "server error" });
  }
});

// ===== util =====
// ===== util =====
function parseKoreanMoneyToManwon(s) {
  if (s == null) return null;
  let str = String(s).replace(/,/g, "").trim();
  if (!str) return null;

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

// ✅ catKey(apt / house-villa / officetel) 추가
function normalizeDabangItem(it, catKey = "apt") {
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
    category: catKey,          // ✅ map에서 구분하고 싶을 때 유용
    deposit,
    monthlyRent,
    excluUseAr: area,
    floor,
    buildYear: null,

    roomId: it?.id,
    complexId: it?.complexId ?? null,

    id: it?.id,
    roomTypeName: it?.roomTypeName,
    complexName: it?.complexName,
    roomTitle: it?.roomTitle,
    roomDesc: it?.roomDesc,
    priceTypeName: it?.priceTypeName,
    priceTitle: it?.priceTitle,
    dongName: it?.dongName,
    imgUrlList: it?.imgUrlList ?? [],

    lat: it?.randomLocation?.lat ?? null,
    lng: it?.randomLocation?.lng ?? null,
  };
}

// =========================
// ✅ RTMS (국토부 실거래가) 비교표본 데이터
//  - apt/offi/house(단독다구) 전월세
// =========================
// ✅ 3종(apt/offi/house) 비교표본 한번에
app.get("/api/rtms-compare", async (req, res) => {
  try {
    const lawdCd = String(req.query.lawdCd ?? "29140"); // 기본: 광주 서구(원하면 바꿔)
    const fromYmd = String(req.query.fromYmd ?? "202602"); // 기본: 최신월 후보
    const maxBack = Number(req.query.maxBack ?? 12);

    const [apt, offi, house] = await Promise.all([
      findLatestRtmsMonth("apt", lawdCd, fromYmd, maxBack),
      findLatestRtmsMonth("offi", lawdCd, fromYmd, maxBack),
      findLatestRtmsMonth("house", lawdCd, fromYmd, maxBack),
    ]);

    res.json({
      ok: true,
      lawdCd,
      months: { apt: apt.dealYmd, offi: offi.dealYmd, house: house.dealYmd },
      items: {
        apt: apt.items,
        offi: offi.items,
        house: house.items,
      },
      counts: {
        apt: apt.items.length,
        offi: offi.items.length,
        house: house.items.length,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const RTMS_KEY = process.env.RTMS_KEY; // ✅ .env
if (!RTMS_KEY) console.warn("[ENV] RTMS_KEY: MISSING (set in .env)");

const RTMS_BASE = "https://apis.data.go.kr/1613000";

// ✅ 캐시(지역+월+종류별)
let RTMS_CACHE = new Map(); // key -> { ts, items }
const RTMS_CACHE_MS = 10 * 60 * 1000; // 10분

function cacheGet(key) {
  const v = RTMS_CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > RTMS_CACHE_MS) return null;
  return v.items;
}
function cacheSet(key, items) {
  RTMS_CACHE.set(key, { ts: Date.now(), items });
}

function ymBack(yyyymm, k = 1) {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  let yy = y, mm = m - k;
  while (mm <= 0) { mm += 12; yy -= 1; }
  return String(yy) + String(mm).padStart(2, "0");
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeRtmsItem(kind, it, lawdCd, dealYmd) {
  // 공통 필드명이 조금씩 달라서 최대한 안전하게 pick
  const area = toNum(it?.excluUseAr ?? it?.excluUseAr ?? it?.전용면적);
  const floor = toNum(it?.floor ?? it?.층);
  const buildYear = toNum(it?.buildYear ?? it?.건축년도 ?? it?.buildYear);
  const umdNm = it?.umdNm ?? it?.법정동 ?? it?.umdNm ?? null;

  // 전월세는 보증금/월세가 만원 단위로 오는 케이스가 많음(문서/예시 기준)
  // (표기 혼재 가능하니 일단 숫자만 파싱)
  const deposit = toNum(it?.deposit ?? it?.보증금액 ?? it?.depositAmount);
  const monthlyRent = toNum(it?.monthlyRent ?? it?.월세금액 ?? it?.monthlyRentAmount) ?? 0;

  // 전세/월세 구분이 명시돼 있을 수도/없을 수도 있음 → 월세금액>0 이면 월세로 판단
  const rentType = monthlyRent > 0 ? "MONTHLY" : "LEASE";

  return {
    kind,            // "apt" | "offi" | "house"
    rentType,        // "LEASE" | "MONTHLY"
    deposit,         // 만원
    monthlyRent,     // 만원
    area,            // ㎡
    floor,
    buildYear,
    umdNm,
    lawdCd,
    dealYmd
  };
}

async function fetchRtms(kind, lawdCd, dealYmd, numRows = 2000, pageNo = 1) {
  if (!RTMS_KEY) throw new Error("RTMS_KEY missing in .env");

  const svc =
    kind === "apt" ? "RTMSDataSvcAptRent" :
    kind === "offi" ? "RTMSDataSvcOffiRent" :
    "RTMSDataSvcSHRent"; // 단독/다가구

  const fn =
    kind === "apt" ? "getRTMSDataSvcAptRent" :
    kind === "offi" ? "getRTMSDataSvcOffiRent" :
    "getRTMSDataSvcSHRent";

  const cacheKey = `rtms:${kind}:${lawdCd}:${dealYmd}:${numRows}:${pageNo}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    serviceKey: RTMS_KEY,
    LAWD_CD: String(lawdCd),
    DEAL_YMD: String(dealYmd),
    numOfRows: String(numRows),
    pageNo: String(pageNo),
  });

  const url = `${RTMS_BASE}/${svc}/${fn}?${params.toString()}`;

  const resp = await fetch(url);
  const xml = await resp.text();
  if (!resp.ok) throw new Error(`RTMS HTTP ${resp.status}: ${xml.slice(0, 200)}`);

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const parsed = parser.parse(xml);

  const items = parsed?.response?.body?.items?.item
    ? (Array.isArray(parsed.response.body.items.item) ? parsed.response.body.items.item : [parsed.response.body.items.item])
    : [];

  const norm = items.map((it) => normalizeRtmsItem(kind, it, lawdCd, dealYmd))
                    .filter((x) => x.deposit != null && x.area != null);

  cacheSet(cacheKey, norm);
  return norm;
}

// ✅ "최근 N개월 내 거래가 있는 월" 찾기 (없으면 빈 배열)
async function findLatestRtmsMonth(kind, lawdCd, fromYmd, maxBackMonths = 12) {
  let ymd = String(fromYmd);
  for (let i = 0; i < maxBackMonths; i++) {
    const items = await fetchRtms(kind, lawdCd, ymd, 2000, 1);
    if (items.length > 0) return { dealYmd: ymd, items };
    ymd = ymBack(ymd, 1);
  }
  return { dealYmd: null, items: [] };
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function buildPeerStatsRtms(items, targetArea, areaTol = 3) {
  const tArea = toNum(targetArea);
  if (tArea == null) return { peerN: 0, peerMed: null };

  const deps = [];
  for (const it of items) {
    if (it?.area == null || it?.deposit == null) continue;
    if (Math.abs(it.area - tArea) <= areaTol) deps.push(it.deposit);
  }
  return { peerN: deps.length, peerMed: median(deps) };
}


// ✅ 업로드 저장 위치(임시)
const upload = multer({
  dest: path.join(process.cwd(), "tmp_uploads"),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// -----------------------------
// ✅ /trust 페이지 라우트 추가
// -----------------------------
app.get("/trust", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "trust.html"));
});

// -----------------------------
// ✅ 등기부등본 분석 API
// - PDF 업로드(multipart/form-data)
// - optional: landlordName, contractDate, depositWon, address
// -----------------------------
app.post("/api/trust/analyze", upload.single("registryPdf"), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "PDF 파일이 없습니다." });
    }

    filePath = req.file.path;

    const buf = fs.readFileSync(filePath);
    const parsed = await pdfParseFn(buf);
    const rawText = (parsed.text || "").replace(/\r/g, "");

    // ✅ 너무 텍스트가 적으면 스캔본(이미지) 가능성
    const textLen = rawText.trim().length;

    const extra = {
      landlordName: (req.body.landlordName || "").trim(),
      contractDate: (req.body.contractDate || "").trim(),
      depositWon: Number(req.body.depositWon || 0),
      address: (req.body.address || "").trim(),
    };

    const result = analyzeRegistryText(rawText, extra);

    return res.json({
      ok: true,
      meta: {
        pages: parsed.numpages,
        textLen,
        scannedLikely: textLen < 80,
      },
      result,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "분석 중 오류가 발생했습니다." });
  } finally {
    // ✅ 임시 파일 정리
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

// -----------------------------
// ✅ 등기부 텍스트 기반 룰 엔진
// - “사기 확정”이 아닌 “위험 신호”로 표현
// -----------------------------
function normalizeName(s = "") {
  return String(s)
    .replace(/\(.*?\)/g, "")     // (가명) 같은 괄호 제거
    .replace(/\s+/g, "")
    .trim();
}

function extractOwnerName(text = "") {
  // "소유자 홍길동(가명)" 패턴: 마지막 소유자를 현재 소유자로 가정
  const re = /소유자\s*([가-힣]{2,10})/g;
  let m, last = "";
  while ((m = re.exec(text))) last = m[1] || last;
  return last ? last.trim() : "";
}

function extractJibunAddress(text = "") {
  // "광주광역시 서구 치평동 123-45" 같은 지번 주소
  const re = /([가-힣]+(?:특별시|광역시|도)\s*[가-힣]+(?:시|군|구)\s*[가-힣0-9]+(?:동|읍|면|리)\s*\d+(?:-\d+)?)/;
  const m = String(text).match(re);
  return m?.[1]?.trim() || "";
}

function extractDongHo(text = "") {
  // "제 101동" / "제 2304호" 형태
  const dong = String(text).match(/제\s*(\d+)\s*동/);
  const ho = String(text).match(/제\s*(\d+)\s*호/);
  const out = [];
  if (dong?.[1]) out.push(`${dong[1]}동`);
  if (ho?.[1]) out.push(`${ho[1]}호`);
  return out.join(" ");
}

function normalizeAddr(s = "") {
  return String(s)
    .replace(/\(.*?\)/g, "")                 // 괄호 제거
    .replace(/광주광역시/g, "광주시")        // 같은 지역 표기 통일(필요시 더 추가)
    .replace(/제\s*/g, "")                   // "제 101동" -> "101동" 비교용
    .replace(/[,\s]+/g, "")                  // 공백/쉼표 제거
    .trim();
}

function addrLooksSame(inputAddr = "", pdfAddr = "") {
  const a = normalizeAddr(inputAddr);
  const b = normalizeAddr(pdfAddr);
  if (!a || !b) return true; // 비교 불가면 경고 대신 '확인 필요'로 두고 싶으면 true
  // 한쪽이 다른 쪽을 포함하면 같은 것으로 간주(“치평동123-45” vs “치평동123-45 101동2304호”)
  return a.includes(b) || b.includes(a);
}

function parseYmdAny(s) {
  if (!s) return null;
  const str = String(s).trim();

  // 1) YYYY-MM-DD (input date)
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 2) YYYY.MM.DD / YYYY/MM/DD
  m = str.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 3) YYYY년 M월 D일
  m = str.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 4) YYYYMMDD
  m = str.match(/(\d{4})(\d{2})(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  return null;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function extractLatestOwnershipTransferDate(text = "") {
  const h = String(text);

  // 1) "소유권이전" 근처 구간을 잘라서 날짜를 찾는다(가장 잘 먹힘)
  const reBlock = /소유권\s*이전[\s\S]{0,250}/g;
  let m, best = null;

  while ((m = reBlock.exec(h))) {
    const block = m[0];

    // 날짜 후보들 뽑기
    const dates = block.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d{8}/g) || [];
    for (const ds of dates) {
      const d = parseYmdAny(ds);
      if (!d) continue;
      if (!best || d.getTime() > best.getTime()) best = d;
    }
  }

  // 2) 그래도 없으면 "등기원인일자/원인일자" 같은 키워드로 fallback
  if (!best) {
    const reFallback = /(등기원인일자|원인일자|접수일자)[^\d]{0,20}(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{8}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)/g;
    let mm;
    while ((mm = reFallback.exec(h))) {
      const d = parseYmdAny(mm[2]);
      if (!d) continue;
      if (!best || d.getTime() > best.getTime()) best = d;
    }
  }

  return best;
}


// ✅ 추가정보를 점수에 반영하는 "보정" 레이어
function applyExtraAdjustments({ score, reasons, extra, extracted, text }) {
  let s = score;

  const inputName = (extra?.landlordName || "").trim();
  const inputAddr = (extra?.address || "").trim();
  const inputContract = (extra?.contractDate || "").trim();
  const deposit = Number(extra?.depositWon || 0);

  const pdfOwner = (extracted?.ownerNameFromPdf || "").trim();
  const pdfAddr = (extracted?.propertyAddrFromPdf || "").trim();

  // 1) 임대인 이름 일치/불일치
  if (inputName && pdfOwner) {
    const same = normalizeName(inputName) === normalizeName(pdfOwner);
    if (!same) {
      s += 25;
      reasons.push("추가정보: 임대인 이름이 등기부 소유자와 불일치합니다(계약 상대방 확인 필요).");
    } else {
      s -= 3;
      reasons.push("추가정보: 임대인 이름이 등기부 소유자와 일치합니다.");
    }
  }

  // 2) 주소 일치/불일치
  if (inputAddr && pdfAddr) {
    const same = addrLooksSame(inputAddr, pdfAddr);
    if (!same) {
      s += 15;
      reasons.push("추가정보: 입력 주소가 등기부 표시 주소와 불일치합니다(동/호/지번 확인 필요).");
    } else {
      s -= 2;
      reasons.push("추가정보: 입력 주소가 등기부 표시와 대체로 일치합니다.");
    }
  }

  // 3) 계약일 vs 최근 소유권 이전일(있으면)
  const cd = parseYmdAny(inputContract);
  if (cd) {
    const lastTransfer = extractLatestOwnershipTransferDate(text);
    if (lastTransfer) {
      const d = daysBetween(cd, lastTransfer);

      // 계약일이 소유권 이전과 "가까운" 경우만 주의로 가산
      if (d != null && d <= 7) {
        s += 12;
        reasons.push("추가정보: 계약일이 최근 소유권 이전일과 매우 가깝습니다(7일 이내).");
      } else if (d != null && d <= 30) {
        s += 8;
        reasons.push("추가정보: 계약일이 최근 소유권 이전일과 가깝습니다(30일 이내).");
      }
    }
  }

  // 4) 보증금 입력값 품질
  if (String(extra?.depositWon || "").trim()) {
    if (!Number.isFinite(deposit) || deposit <= 0) {
      s += 4;
      reasons.push("추가정보: 보증금 입력값이 비정상입니다(0 또는 숫자 오류 가능).");
    }
  }

  // clamp
  s = Math.max(0, Math.min(100, s));
  return s;
}

// =========================
// ✅ 권리(을구/갑구) 엔트리 추출(근저당/가압류/압류/가처분/경매/신탁/전세권 등)
// - 목표: "순위", "접수/원인일자", "권리자(채권자)", "채권최고액", "말소/해지" 여부
// =========================

function extractAllDates(text = "") {
  const h = String(text);
  const dates = h.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d{8}/g) || [];
  return dates.map(parseYmdAny).filter(Boolean);
}

function pickLatestDateInBlock(block = "") {
  const ds = extractAllDates(block);
  if (!ds.length) return null;
  return ds.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

function pickDateByLabel(block = "", labelRe) {
  const h = String(block);
  const re = new RegExp(`(${labelRe.source})[^\\d]{0,20}(\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{8}|\\d{4}\\s*년\\s*\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일)`, "i");
  const m = h.match(re);
  return m?.[2] ? parseYmdAny(m[2]) : null;
}

function extractRank(block = "") {
  const h = String(block);
  // "순위번호 1", "순위 1" 등
  const m =
    h.match(/순위\s*번호?\s*[:\-]?\s*(\d{1,4})/i) ||
    h.match(/(\d{1,4})\s*순위/);
  return m?.[1] ? Number(m[1]) : null;
}

function extractCreditor(block = "") {
  const h = String(block);

  // 흔한 라벨: 채권자/근저당권자/권리자/신청인/금융기관 등
  const m =
    h.match(/(채권자|근저당권자|권리자|신청인)\s*[:\-]?\s*([가-힣A-Za-z0-9()·\-\s]{2,50})/i) ||
    h.match(/(주식회사|농협|신협|수협|은행|캐피탈|저축은행)[가-힣A-Za-z0-9()·\-\s]{1,40}/);

  if (!m) return null;

  // 첫 패턴이면 그룹2, 두번째면 전체 매치
  const raw = (m[2] || m[0] || "").trim();
  return raw.replace(/\s{2,}/g, " ").trim();
}

function extractMaxClaimWonFromBlock(block = "") {
  const t = String(block);

  // 1) "채권최고액 금 120,000,000원" 형태
  let m = t.match(/채권\s*최고액[^0-9]{0,30}([0-9]{1,3}(?:,[0-9]{3})+)\s*원/);
  if (m) return Number(m[1].replace(/,/g, ""));

  // 2) "채권최고액 120000000원"
  m = t.match(/채권\s*최고액[^0-9]{0,30}([0-9]{7,12})\s*원/);
  if (m) return Number(m[1]);

  // 3) "채권최고액 1억2천만원" 같은 한글 금액은 MVP에선 스킵(원하면 다음 단계에서 확장)
  return 0;
}

function isCanceled(block = "") {
  const h = String(block);
  return /말소|해지|소멸|변경|이전|경정|말소등기|해제/i.test(h);
}

// ✅ 권리 엔트리 단위로 잘라내기(완벽한 구조화는 어렵지만, "키워드 주변 400~600자"를 엔트리로 근사)
function extractRightEntries(text = "") {
  const h = String(text);

  const KEYWORDS = [
    { type: "MORTGAGE", re: /근저당|저당|담보/gi, label: "근저당/담보" },
    { type: "SEIZURE", re: /가압류|압류|가처분/gi, label: "압류/가압류/가처분" },
    { type: "AUCTION", re: /경매개시|임의경매|강제경매|경매/gi, label: "경매" },
    { type: "TRUST", re: /신탁/gi, label: "신탁" },
    { type: "LEASE_RIGHT", re: /전세권/gi, label: "전세권" },
  ];

  const entries = [];

  for (const k of KEYWORDS) {
    let m;
    while ((m = k.re.exec(h))) {
      const start = Math.max(0, m.index - 120);
      const end = Math.min(h.length, m.index + 520);
      const block = h.slice(start, end);

      const rank = extractRank(block);
      const acceptDate = pickDateByLabel(block, /(접수일자|접수|접수일)/);
      const causeDate = pickDateByLabel(block, /(등기원인일자|원인일자|원인일)/);
      const latestAny = pickLatestDateInBlock(block);

      const creditor = extractCreditor(block);
      const maxClaimWon = extractMaxClaimWonFromBlock(block);
      const canceled = isCanceled(block);

      entries.push({
        type: k.type,
        label: k.label,
        keyword: m[0],
        rank,
        acceptDate: acceptDate ? acceptDate.toISOString().slice(0, 10) : null,
        causeDate: causeDate ? causeDate.toISOString().slice(0, 10) : null,
        latestDate: latestAny ? latestAny.toISOString().slice(0, 10) : null,
        creditor: creditor || null,
        maxClaimWon: maxClaimWon > 0 ? maxClaimWon : null,
        canceled,
        // 디버깅 필요하면 block 일부 노출(원하면 프론트에 안 보내고 서버 로그용으로만)
        // _block: block.replace(/\s+/g, " ").slice(0, 300),
      });
    }
  }

  // ✅ 중복 근사 제거(같은 타입 + 같은 날짜/채권자/채권최고액이면 하나로)
  const uniq = [];
  const seen = new Set();
  for (const e of entries) {
    const key = [
      e.type,
      e.rank ?? "",
      e.acceptDate ?? "",
      e.causeDate ?? "",
      e.creditor ?? "",
      e.maxClaimWon ?? "",
      e.canceled ? "1" : "0",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(e);
  }

  // ✅ 선순위 정렬 느낌: rank 오름차순, 없으면 날짜 최신순
  uniq.sort((a, b) => {
    const ra = a.rank ?? 999999;
    const rb = b.rank ?? 999999;
    if (ra !== rb) return ra - rb;
    const da = Date.parse(a.latestDate || "") || 0;
    const db = Date.parse(b.latestDate || "") || 0;
    return db - da;
  });

  return uniq;
}

function summarizeRights(entries = []) {
  const mort = entries.filter(e => e.type === "MORTGAGE" && !e.canceled);
  const seiz = entries.filter(e => e.type === "SEIZURE" && !e.canceled);
  const auc  = entries.filter(e => e.type === "AUCTION" && !e.canceled);
  const tr   = entries.filter(e => e.type === "TRUST" && !e.canceled);

  const topMortgage = mort[0] || null;

  // 권리변동 최신일(전체)
  const latest = (() => {
    const ds = entries.map(e => e.latestDate).filter(Boolean).map(d => Date.parse(d));
    if (!ds.length) return null;
    const max = Math.max(...ds);
    return new Date(max).toISOString().slice(0, 10);
  })();

  return {
    latestRightChangeDate: latest,
    counts: {
      mortgageActive: mort.length,
      seizureActive: seiz.length,
      auctionActive: auc.length,
      trustActive: tr.length,
      totalHits: entries.length,
    },
    topMortgage, // {rank, acceptDate, causeDate, creditor, maxClaimWon, ...}
  };
}

function analyzeRegistryText(text, extra) {
  const t = (text || "").replace(/[ \t]+/g, " ").toLowerCase();

  // 위험 키워드 탐지
  const flags = {
    auction: /경매|임의경매|강제경매|경매개시/.test(text),
    seizure: /압류|가압류|가처분/.test(text),
    trust: /신탁/.test(text),
    provisional: /가압류|가처분/.test(text),
    mortgage: /근저당|저당|담보/.test(text),
    leaseRight: /전세권/.test(text),
    dispositionBan: /처분금지/.test(text),
    ownershipTransfer: /소유권(이전|이전등기)/.test(text),
  };

  // 채권최고액 추출(가능한 범위에서)
  // 예: "채권최고액 금 120,000,000원" / "채권최고액 1억2천만원" 등 케이스는 다양해서 MVP는 숫자원 중심
  const maxClaimWon = extractMaxClaimWon(text);

  const rightEntries = extractRightEntries(text);
  const rightsSummary = summarizeRights(rightEntries);

  // ✅ maxClaimWon을 "근저당 엔트리의 채권최고액"으로 보강(더 신뢰되는 값)
  // - 기존 extractMaxClaimWon(text)가 못 잡아도, 블록 단위에서 잡히면 채워짐
  const maxClaimWon2 = rightsSummary?.topMortgage?.maxClaimWon ?? 0;
  const maxClaimFinal = (maxClaimWon > 0 ? maxClaimWon : maxClaimWon2);

    // ✅ PDF에서 '현재 소유자'와 '부동산 주소(지번+동호)' 추출
  const ownerNameFromPdf = extractOwnerName(text);
  const jibunFromPdf = extractJibunAddress(text);
  const dongHoFromPdf = extractDongHo(text);

  const propertyAddrFromPdf = [jibunFromPdf, dongHoFromPdf].filter(Boolean).join(" ");


  // 간단 점수(0~100, 높을수록 위험)
  let score = 0;
  const reasons = [];

  // 1) 강한 위험 시그널
  if (flags.auction) { score += 40; reasons.push("등기부에 경매(개시/진행) 관련 문구가 확인됩니다."); }
  if (flags.seizure) { score += 30; reasons.push("등기부에 압류/가압류/가처분 등 권리제한 신호가 확인됩니다."); }
  if (flags.dispositionBan) { score += 25; reasons.push("처분금지 관련 문구가 확인됩니다(권리관계 확인 필요)."); }
  if (flags.trust) { score += 25; reasons.push("신탁 관련 문구가 확인됩니다(계약 상대방/권한 확인 필요)."); }

  // 2) 근저당/담보
  const topM = rightsSummary?.topMortgage;
  if (flags.mortgage || topM) {
    score += 12;

    const parts = [];
    if (topM?.rank != null) parts.push(`순위 ${topM.rank}`);
    if (topM?.creditor) parts.push(`채권자 ${topM.creditor}`);
    if (topM?.causeDate) parts.push(`원인일 ${topM.causeDate}`);
    if (topM?.acceptDate) parts.push(`접수일 ${topM.acceptDate}`);
    if (topM?.maxClaimWon) parts.push(`채권최고액 ${Number(topM.maxClaimWon).toLocaleString("ko-KR")}원`);

    reasons.push(
      parts.length
        ? `근저당/담보가 확인됩니다(${parts.join(" / ")}). 선순위 규모·말소 여부를 확인하세요.`
        : "근저당/담보 설정 문구가 확인됩니다(선순위 채권 규모·채권자·설정일 확인 권장)."
    );
  }

  if (rightsSummary?.latestRightChangeDate) {
    reasons.push(`권리변동(추정) 최신일: ${rightsSummary.latestRightChangeDate} (계약 직전 재발급으로 재확인 권장)`);
  }

  // 3) 채권최고액이 뽑힌 경우: 보증금 대비 간단 비교
  const deposit = Number.isFinite(Number(extra.depositWon)) ? Number(extra.depositWon) : 0;

  if (maxClaimFinal > 0) {
    if (deposit > 0) {
      const ratio = maxClaimFinal / deposit; // 채권최고액 / 보증금
      if (ratio >= 1.0) {
        score += 22;
        reasons.push("채권최고액이 보증금과 같거나 더 큽니다(선순위 부담이 클 수 있음).");
      } else if (ratio >= 0.7) {
        score += 14;
        reasons.push("채권최고액이 보증금의 70% 이상입니다(선순위 부담 주의).");
      } else if (ratio >= 0.4) {
        score += 8;
        reasons.push("채권최고액이 보증금 대비 의미 있는 수준입니다(추가 확인 권장).");
      }
    } else {
      score += 6;
      reasons.push("채권최고액이 확인됩니다(보증금 입력 시 더 정확한 비교가 가능합니다).");
    }
  }

  // 4) 소유권 이전 문구(짧은 기간 반복 여부는 PDF만으로 판단 어려움 → “확인 필요”로 약하게)
  if (flags.ownershipTransfer) {
    score += 5;
    reasons.push("소유권 이전 관련 문구가 확인됩니다(최근 거래 이력/계약 상대방 일치 여부 확인 권장).");
  }

  score = Math.max(0, Math.min(100, score));

    // ✅ 추가정보 보정(점수/등급에 반영)
  score = applyExtraAdjustments({
    score,
    reasons,
    extra,
    extracted: { ownerNameFromPdf, propertyAddrFromPdf },
    text, // 원문 텍스트 넘겨야 "최근 소유권 이전일" 추출 가능
  });


  const grade =
    score >= 70 ? "위험" :
    score >= 40 ? "주의" :
    "양호";

  const badge =
    grade === "위험" ? "🔴" :
    grade === "주의" ? "🟠" : "🟢";

  // 사용자에게 보여줄 주의 문구(실무 톤)
  const notices = buildNotices({ flags, maxClaimFinal, deposit, extra, score, grade });

  // 체크리스트
  const checklist = buildChecklist({
    flags,
    maxClaimFinal,
    deposit,
    extra,
    extracted: {
      ownerNameFromPdf,
      propertyAddrFromPdf
    }
  });
  
    return {
    score,
    grade,
    badge,
    reasons,
    extracted: {
      maxClaimWon: maxClaimFinal || null,
      mortgageDetected: flags.mortgage,
      auctionDetected: flags.auction,
      seizureDetected: flags.seizure,
      trustDetected: flags.trust,

      // ✅ 추가
      ownerNameFromPdf: ownerNameFromPdf || null,
      propertyAddrFromPdf: propertyAddrFromPdf || null,

      rights: {
        latestRightChangeDate: rightsSummary?.latestRightChangeDate ?? null,
        counts: rightsSummary?.counts ?? null,
        topMortgage: rightsSummary?.topMortgage ?? null,
        entries: rightEntries.slice(0, 20), // 너무 길어질 수 있으니 상한(원하면 조정)
      },
    },
    notices,
    checklist,
  };

}

function buildTrustActions({ flags, maxClaimWon, deposit, grade }) {
  const a = [];

  a.push({
    title: "계약 당일 등기부 재발급",
    desc: "계약 직전 다시 발급해 권리변동(근저당/가압류 등)을 확인하세요.",
    tag: "필수",
  });

  if (flags.mortgage || maxClaimWon > 0) {
    a.push({
      title: "선순위 채권(근저당/채권최고액) 확인",
      desc: "보증금 회수 가능성(배당 가능성)을 전문가/중개사와 확인하세요.",
      tag: "중요",
    });
  }

  if (flags.auction || flags.seizure) {
    a.unshift({
      title: "계약 보류 권장",
      desc: "경매/압류/가압류 신호가 있으면 보증금 회수 위험이 큽니다.",
      tag: "강력",
    });
  }

  if (flags.trust) {
    a.push({
      title: "신탁원부/임대 권한 확인",
      desc: "수탁자/위탁자 및 임대 권한 동의서가 없으면 분쟁 위험이 큽니다.",
      tag: "필수",
    });
  }

  if (grade === "양호") {
    a.push({
      title: "보증보험(가능 여부) 확인",
      desc: "가능/불가 여부 자체가 중요한 리스크 신호입니다.",
      tag: "추천",
    });
  }

  return a.slice(0, 3);
}


function extractMaxClaimWon(text) {
  // "채권최고액 ... 120,000,000원" 패턴 우선
  const m = text.match(/채권최고액[^0-9]{0,30}([0-9]{1,3}(?:,[0-9]{3})+)\s*원/);
  if (m) return Number(m[1].replace(/,/g, ""));

  // "채권최고액 120000000원" 같은 케이스
  const m2 = text.match(/채권최고액[^0-9]{0,30}([0-9]{7,12})\s*원/);
  if (m2) return Number(m2[1]);

  return 0;
}

function buildNotices({ flags, maxClaimWon, deposit, score, grade }) {
  const out = [];

  if (flags.auction || flags.seizure) {
    out.push("등기부상 권리제한/경매 신호가 보이면, 계약 전 반드시 중개사·법무사와 선순위 권리 및 배당 가능성을 확인하세요.");
  }
  if (flags.trust) {
    out.push("신탁 부동산일 경우, 위탁자/수탁자 및 임대 권한(동의서/신탁원부 등)을 확인하지 않으면 분쟁 위험이 큽니다.");
  }
  if (flags.mortgage) {
    out.push("근저당이 있으면 ‘선순위 채권’이 존재합니다. 보증금 + 선순위 채권 규모가 커질수록 보증금 회수 위험이 커집니다.");
  }
  if (maxClaimWon > 0 && deposit > 0) {
    const r = maxClaimWon / deposit;
    out.push(`채권최고액/보증금 비율이 ${(r * 100).toFixed(0)}% 수준입니다. (정확도 향상을 위해 시세/선순위 전세 여부도 함께 확인 권장)`);
  }
  if (grade === "양호") {
    out.push("현재 등기부 텍스트에서 강한 위험 신호는 적습니다. 다만 계약서/신분증/계좌 확인 등 기본 검증은 꼭 진행하세요.");
  }
  if (score >= 70) {
    out.push("위험 신호가 다수입니다. ‘계약 보류 + 전문가 확인(법무사/보증기관 상담)’을 강하게 권장합니다.");
  }
  return out;
}

function buildChecklist({ flags, maxClaimWon, deposit, extra, extracted }) {
  const list = [];

  const inputName = (extra?.landlordName || "").trim();
  const inputAddr = (extra?.address || "").trim();

  const pdfOwner = (extracted?.ownerNameFromPdf || "").trim();
  const pdfAddr = (extracted?.propertyAddrFromPdf || "").trim();

  // 1) 임대인(계약상대) vs 등기부 소유자 비교
  if (inputName && pdfOwner) {
    const ok = normalizeName(inputName) === normalizeName(pdfOwner);
    list.push({
      ok,
      text: ok
        ? "등기부 ‘소유자’와 계약 상대방(임대인)이 일치합니다."
        : `임대인 이름 불일치: 입력(${inputName}) / 등기부(${pdfOwner})`
    });
  } else {
    list.push({
      ok: true,
      text: "등기부 ‘소유자’와 계약 상대방(임대인) 일치 여부 확인(임대인 입력/추출 시 자동 비교)"
    });
  }

  // 2) 주소 비교
  if (inputAddr && pdfAddr) {
    const ok = addrLooksSame(inputAddr, pdfAddr);
    list.push({
      ok,
      text: ok
        ? "주소(동/호 포함)가 등기부 표시와 대체로 일치합니다."
        : `주소 불일치: 입력(${inputAddr}) / 등기부(${pdfAddr})`
    });
  } else {
    list.push({
      ok: true,
      text: "주소/동/호가 계약서·등기부와 동일한지 확인(주소 입력/추출 시 자동 비교)"
    });
  }

  // 3) 권리 제한 시그널
  const rights = extracted?.rights;
  const topM = rights?.topMortgage;

  if (flags.mortgage || topM) {
    const info = [];
    if (topM?.rank != null) info.push(`순위 ${topM.rank}`);
    if (topM?.creditor) info.push(`채권자 ${topM.creditor}`);
    if (topM?.causeDate) info.push(`원인일 ${topM.causeDate}`);
    if (topM?.acceptDate) info.push(`접수일 ${topM.acceptDate}`);
    if (topM?.maxClaimWon) info.push(`채권최고액 ${Number(topM.maxClaimWon).toLocaleString("ko-KR")}원`);
    if (topM?.canceled) info.push("말소/해지 추정");

    list.push({
      ok: false,
      text: `근저당권 존재 → ${info.length ? info.join(" / ") : "채권최고액/채권자/설정일/순위 확인"} (선순위 여부 핵심)`
    });
  } else {
    list.push({ ok: true, text: "근저당권(담보) 문구가 뚜렷하지 않음" });
  }

  if (flags.seizure) list.push({ ok: false, text: "압류/가압류/가처분 존재 → 계약 보류 후 권리관계 확인" });
  if (flags.auction) list.push({ ok: false, text: "경매 관련 문구 존재 → 계약 위험 매우 큼(회수 리스크)" });
  if (flags.trust)  list.push({ ok: false, text: "신탁 문구 존재 → 임대 권한/신탁원부 확인 필요" });

  // 4) 채권최고액 vs 보증금
  if (maxClaimWon > 0 && deposit > 0) {
    const r = maxClaimWon / deposit;
    const ok = r < 0.7;
    list.push({ ok, text: `채권최고액 대비 보증금 비율 점검 (${(r * 100).toFixed(0)}%)` });
  } else {
    list.push({ ok: true, text: "보증금 입력 시 선순위 대비 비교가 더 정확해짐" });
  }

  return list;
}


app.listen(PORT, () => {
  console.log(`✅ http://localhost:${PORT} 에서 실행 중`);

  // ✅ 서버 시작하자마자 미리 ML 캐시 생성 (실패해도 서버는 계속)
  getMlRiskCached(PORT, false).then(() => {
    console.log("[WARMUP] ml-risk cache ready");
  }).catch((e) => {
    console.warn("[WARMUP FAIL]", e.message);
  });
});
