import json
import joblib
import numpy as np
import pandas as pd
import os
import sys

from features import build_features

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    registry = json.load(open(os.path.join(here, "model_registry.json"), "r", encoding="utf-8"))
    bundle = joblib.load(registry["active_path"])

    model = bundle["model"]
    feature_cols = bundle["features"]

    # stdin으로 items(json array) 받기
    raw = sys.stdin.read()
    items = json.loads(raw)

    X, _y, _cols, meta = build_features(items)

    # 학습 때 쓴 컬럼 정렬 강제
    X = X.reindex(columns=feature_cols).fillna(-1)

    pred = model.predict(X)
    pred = np.clip(pred, 0, 100)

    # id와 함께 반환
    out = []
    if meta is not None and "id" in meta.columns:
        for i in range(len(pred)):
            out.append({"id": meta.iloc[i]["id"], "risk_score": float(pred[i])})
    else:
        for i in range(len(pred)):
            out.append({"idx": i, "risk_score": float(pred[i])})

    print(json.dumps({"model": registry["active_model"], "predictions": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
