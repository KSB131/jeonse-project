import re
import numpy as np
import pandas as pd
from datetime import datetime

NOW = datetime(2026, 2, 5)

def to_float(x):
    try:
        if x is None: 
            return np.nan
        if isinstance(x, (int, float)):
            return float(x)
        s = str(x).replace(",", "").strip()
        if s == "":
            return np.nan
        return float(s)
    except:
        return np.nan

def parse_korean_money_to_won(v):
    """
    입력 예:
      - "1억2000"  (만원 단위가 아니라 텍스트)
      - "38000" (만원)
      - None
    반환: 원 단위 (int) or np.nan
    """
    if v is None:
        return np.nan
    s = str(v).replace(",", "").strip()
    if s == "":
        return np.nan

    # 이미 숫자만이면 "만원"이라고 가정하고 원으로 변환
    if re.fullmatch(r"\d+(\.\d+)?", s):
        manwon = float(s)
        return int(round(manwon * 10000))

    m = re.match(r"(\d+)\s*억\s*(\d+)?", s)
    if m:
        eok = int(m.group(1))
        rest = int(m.group(2) or 0)
        manwon = eok * 10000 + rest
        return int(manwon * 10000)

    # 마지막 fallback: 숫자만 추출
    nums = re.findall(r"\d+", s)
    if not nums:
        return np.nan
    manwon = float("".join(nums))
    return int(round(manwon * 10000))

def jeonse_estimate_won(deposit_manwon, monthly_manwon, cap_rate=0.07):
    """
    월세보증금 + (월세*12/0.07) 를 "만원" 단위에서 계산 후 원으로 변환
    """
    if np.isnan(deposit_manwon):
        return np.nan
    monthly_manwon = 0.0 if np.isnan(monthly_manwon) else float(monthly_manwon)
    jeonse_manwon = float(deposit_manwon) + (monthly_manwon * 12.0 / cap_rate)
    return int(round(jeonse_manwon * 10000))

def area_to_pyeong(area_m2):
    if np.isnan(area_m2):
        return np.nan
    return float(area_m2) / 3.305785

def age_score(approval_year):
    if np.isnan(approval_year):
        return np.nan
    age = NOW.year - int(approval_year)
    if age <= 5:  return 1.0
    if age <= 15: return 0.5
    return 0.0

def direction_score(direction_str):
    if not direction_str:
        return np.nan
    d = str(direction_str).strip()
    mapping = {
        "남": 5.0, "남동": 4.5, "남서": 4.0, "동": 3.5, "서": 3.0,
        "북동": 2.5, "북서": 2.0, "북": 1.5
    }
    return mapping.get(d, np.nan)

OPTION_SCORES = {
    # 1.0
    "냉장고":1.0, "세탁기":1.0, "가스레인지":1.0, "전자레인지":1.0, "싱크대":1.0,
    # 0.8
    "침대":0.8, "건조기":0.8,
    # 0.6
    "옷장":0.6, "신발장":0.6, "벽걸이형 에어컨":0.6, "벽걸이에어컨":0.6,
    # 0.5
    "책상":0.5, "식탁":0.5, "샤워부스":0.5, "붙박이장":0.5, "스탠드형 에어컨":0.5, "스탠드형에어컨":0.5,
    # 0.4
    "인덕션":0.4, "욕조":0.4, "천장형 에어컨":0.4, "천장형에어컨":0.4, "베란다":0.4,
    # 0.3
    "쇼파":0.3, "마당":0.3, "무인택배함":0.3, "가스오븐":0.3, "식기세척기":0.3, "TV":0.3,
    # 0.2
    "화재 경보기":0.2, "화재경보기":0.2
}

def option_score(room_title):
    if not room_title:
        return 0.0
    t = str(room_title)
    s = 0.0
    for k, v in OPTION_SCORES.items():
        if k in t:
            s += v
    return min(10.0, s)  # 최대 10점

def building_use_insurance_score(use_str):
    if not use_str:
        return np.nan
    u = str(use_str)
    if "공동주택" in u: return 1.0
    if "단독주택" in u: return 0.3
    if "업무시설" in u: return 0.1
    return 0.0

def make_label_by_category(df: pd.DataFrame):
    """
    카테고리별 dep_per_m2 분포에서 벗어난 정도를 0~100 라벨로 생성하되,
    ✅ 신축(=age_score 높음)일수록 '비싼 편차(z>0)'를 덜 위험으로 간주(완화)
    - z<0 (너무 쌈): 그대로(또는 더 민감) 유지
    """
    df = df.copy()

    dep = df["deposit_manwon"]
    area = df["area_m2"]
    df["dep_per_m2"] = dep / area
    df.loc[~np.isfinite(df["dep_per_m2"]), "dep_per_m2"] = np.nan

    if "category" not in df.columns:
        df["category"] = "unknown"

    # age_score: 신축일수록 1.0, 중간 0.5, 노후 0.0 (이미 네 코드에 있음)
    if "age_score" not in df.columns:
        df["age_score"] = np.nan
    age = df["age_score"].fillna(0.0).clip(0.0, 1.0)

    scores = pd.Series(index=df.index, dtype=float)

    for cat, g in df.groupby("category", dropna=False):
        x = g["dep_per_m2"].dropna()
        if len(x) < 15:
            med = df["dep_per_m2"].median()
            mad = (df["dep_per_m2"] - med).abs().median()
        else:
            med = x.median()
            mad = (x - med).abs().median()

        mad = float(mad) if np.isfinite(mad) and mad > 0 else 1e-6

        z = (g["dep_per_m2"] - med) / (mad + 1e-6)
        z = z.clip(-3, 3)

        # ✅ 가중치:
        # - 비싼 편차(z>0): 신축일수록 완화 (최대 55%까지 깎기)
        # - 싼 편차(z<0): 그대로(원하면 1.1로 더 민감하게도 가능)
        # ✅ 신축 프리미엄 완화 강화 버전
        age_g = g["age_score"].fillna(0.0).clip(0.0, 1.0)

        # 비선형: 신축(1.0)에 더 강하게 먹게 (1.0^2=1.0 / 0.5^2=0.25)
        newness = age_g ** 2

        # ✅ 최대 80%까지 완화 (기존 55% -> 80%)
        # age=1.0 => 0.20배, age=0.5 => 1 - 0.8*0.25 = 0.80배, age=0 => 1.0배
        pos_w = (1.0 - 0.80 * newness)

        # 너무 과하게 깎여서 항상 안전으로 가는 걸 방지하려면 하한을 둠(권장)
        pos_w = np.clip(pos_w, 0.20, 1.0)

        neg_w = 1.0  # z<0(너무 쌈)은 그대로
        w = np.where(z >= 0, pos_w, neg_w)
        z_abs = (z.abs() * w).clip(0, 3)

        score = z_abs * (100 / 3)
        scores.loc[g.index] = score

    return scores.clip(0, 100)


def build_features(items: list):
    df = pd.DataFrame(items)

    # 필요한 컬럼 표준화
    df["deposit_manwon"] = df.get("deposit").apply(to_float)
    df["monthly_manwon"] = df.get("monthlyRent").apply(to_float)
    df["area_m2"] = df.get("excluUseAr").apply(to_float)
    df["floor"] = df.get("floor").apply(to_float)

    # ✅ category 확보 (없으면 unknown)
    if "category" not in df.columns:
        df["category"] = "unknown"
    df["category"] = df["category"].fillna("unknown").astype(str)

    # 전세추정가(원)
    df["jeonse_won"] = df.apply(
        lambda r: jeonse_estimate_won(r["deposit_manwon"], r["monthly_manwon"]),
        axis=1
    )

    # 면적 파생
    df["area_pyeong"] = df["area_m2"].apply(area_to_pyeong)

    # 층/면적당 가격 파생
    df["dep_per_m2_manwon"] = df["deposit_manwon"] / df["area_m2"]
    df["jeonse_per_m2_won"] = df["jeonse_won"] / df["area_m2"]

    # 옵션/방향
    df["option_score"] = df.get("roomTitle", pd.Series([None]*len(df))).apply(option_score)
    df["direction_score"] = df.get("direction", pd.Series([None]*len(df))).apply(direction_score)

    # 노후도
    df["approval_year"] = df.get("buildYear", pd.Series([np.nan]*len(df))).apply(to_float)
    df["age_score"] = df["approval_year"].apply(age_score)

    # 건축물 용도 점수
    df["building_use_score"] = df.get("buildingUse", pd.Series([None]*len(df))).apply(building_use_insurance_score)

    # ✅ 결측/이상치 필터(필수)
    df = df[df["area_m2"].notna() & df["deposit_manwon"].notna()]

    # ✅ 라벨(카테고리별) 생성
    df["y"] = make_label_by_category(df)

    # ✅ category one-hot (3종 + 기타 대비)
    cat_dum = pd.get_dummies(df["category"], prefix="category")
    # 학습 시점에 컬럼이 빠지지 않도록 3종은 강제 생성
    for c in ["category_apt", "category_house-villa", "category_officetel"]:
        if c not in cat_dum.columns:
            cat_dum[c] = 0
    df = pd.concat([df, cat_dum], axis=1)

    # 모델 피처만 선택
    feature_cols = [
        "deposit_manwon","monthly_manwon","jeonse_won",
        "area_m2","area_pyeong","floor",
        "dep_per_m2_manwon","jeonse_per_m2_won",
        "option_score","direction_score",
        "age_score","building_use_score",
        # ✅ category
        "category_apt","category_house-villa","category_officetel",
    ]

    X = df[feature_cols].copy()
    y = df["y"].copy()

    X = X.replace([np.inf, -np.inf], np.nan).fillna(-1)

    meta_cols = ["id","roomId","complexId","lat","lng","dongName","complexName","priceTitle","category"]
    meta = df[meta_cols].copy() if "id" in df.columns else None

    return X, y, feature_cols, meta
