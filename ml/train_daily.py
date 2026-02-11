import json
import os
from datetime import datetime
import joblib
import numpy as np

from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error
from sklearn.ensemble import StackingRegressor
from sklearn.linear_model import Ridge

import lightgbm as lgb
import xgboost as xgb
from catboost import CatBoostRegressor

from data_fetch import fetch_dabang_rooms
from features import build_features

def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))

def train_and_eval_models(X, y, seed=42, test_size=0.2):
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=test_size, random_state=seed)

    models = {}

    models["lgbm"] = lgb.LGBMRegressor(
        n_estimators=1200,
        learning_rate=0.03,
        num_leaves=64,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=seed
    )

    models["xgb"] = xgb.XGBRegressor(
        n_estimators=1500,
        learning_rate=0.03,
        max_depth=6,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        random_state=seed,
        tree_method="hist"
    )

    models["cat"] = CatBoostRegressor(
        iterations=2000,
        learning_rate=0.03,
        depth=8,
        loss_function="RMSE",
        random_seed=seed,
        verbose=False
    )

    # stacking (lgbm + xgb + cat) -> ridge
    estimators = [
        ("lgbm", models["lgbm"]),
        ("xgb", models["xgb"]),
        ("cat", models["cat"])
    ]
    models["stacking"] = StackingRegressor(
        estimators=estimators,
        final_estimator=Ridge(alpha=1.0),
        passthrough=True,
        n_jobs=-1
    )

    results = {}
    fitted = {}

    for name, m in models.items():
        m.fit(Xtr, ytr)
        pred = m.predict(Xte)
        results[name] = {"rmse": rmse(yte, pred)}
        fitted[name] = m

    return fitted, results

def pick_best(results, current_best_name=None, current_best_rmse=None, min_improve=0.002):
    # rmse 낮을수록 좋음
    best_name = min(results.keys(), key=lambda k: results[k]["rmse"])
    best_rmse = results[best_name]["rmse"]

    # 너무 자주 바뀌는 걸 막기 위한 “스위칭 임계값”
    if current_best_name is not None and current_best_rmse is not None:
        improve = current_best_rmse - best_rmse
        if improve < min_improve:
            return current_best_name, current_best_rmse, False

    return best_name, best_rmse, True

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = json.load(open(os.path.join(here, "config.json"), "r", encoding="utf-8"))

    base_url = cfg["base_url"]
    items = fetch_dabang_rooms(base_url, cfg["max_pages"], cfg["max_items"])

    X, y, feature_cols, _meta = build_features(items)

    fitted, results = train_and_eval_models(X, y, seed=cfg["random_seed"], test_size=cfg["test_size"])

    # registry 로드
    registry_path = os.path.join(here, "model_registry.json")
    registry = {}
    if os.path.exists(registry_path):
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                txt = f.read().strip()
            if txt:
                registry = json.loads(txt)
        except Exception:
            registry = {}
    else:
        registry = {}

    current_name = registry.get("active_model")
    current_rmse = registry.get("active_rmse")
    best_name, best_rmse, switched = pick_best(
        results,
        current_best_name=current_name,
        current_best_rmse=current_rmse,
        min_improve=cfg["min_improve_to_switch"]
    )

    # 저장
    os.makedirs(os.path.join(here, "models"), exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    out_path = os.path.join(here, "models", f"{best_name}_{stamp}.joblib")

    joblib.dump(
        {"model": fitted[best_name], "features": feature_cols, "trained_at": stamp, "metric": results[best_name]},
        out_path
    )

    registry = {
        "active_model": best_name,
        "active_rmse": best_rmse,
        "active_path": out_path,
        "last_train_date": stamp,
        "all_results": results
    }
    json.dump(registry, open(registry_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(json.dumps(registry, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
