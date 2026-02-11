// dabang_filter_seogu.js
// 실행: node dabang_filter_seogu.js
import fs from "fs";

const INPUT = "dabang_gwangju_rooms.json";
const OUTPUT = "dabang_gwangju_seogu_rooms.json";

// ✅ 광주 서구 동(법정동/행정동 기준) - 실무에서 자주 쓰는 목록
// 필요하면 너 데이터(dong_stats) 보고 추가/삭제하면 됨.
const SEOGU_DONGS = new Set([
  "치평동",
  "쌍촌동",
  "농성동",
  "화정동",
  "풍암동",
  "금호동",
  "마륵동",
  "유촌동",
  "내방동",
  "동천동",
  "서창동",
  "매월동",
  "벽진동",
  "세하동",
  "용두동",     // (서구 서창/용두동 쪽 포함 가능성)
  "상무동",     // (데이터에 뜰 수도 있음)
]);

function summarizeByDong(items) {
  const map = new Map();
  for (const it of items) {
    const dong = it?.dongName ?? "(unknown)";
    map.set(dong, (map.get(dong) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dongName, count]) => ({ dongName, count }));
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`❌ 입력 파일이 없습니다: ${INPUT}`);
    process.exit(1);
  }

  const all = JSON.parse(fs.readFileSync(INPUT, "utf-8"));
  const seogu = all.filter((x) => SEOGU_DONGS.has(x?.dongName));

  fs.writeFileSync(OUTPUT, JSON.stringify(seogu, null, 2), "utf-8");

  const stats = summarizeByDong(seogu);
  fs.writeFileSync("dabang_gwangju_seogu_dong_stats.json", JSON.stringify(stats, null, 2), "utf-8");

  console.log(`✅ all: ${all.length}`);
  console.log(`✅ seogu: ${seogu.length}`);
  console.log(`✅ saved -> ${OUTPUT}`);
  console.log(`✅ saved -> dabang_gwangju_seogu_dong_stats.json`);
}

main();
