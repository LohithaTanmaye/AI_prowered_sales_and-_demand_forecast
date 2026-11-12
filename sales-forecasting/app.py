"""
AI-Powered Sales & Demand Forecasting System
=============================================
Models included:
  - Linear Regression (trend baseline)
  - Polynomial Regression (non-linear trend)
  - Moving Average (smoothing)
  - Exponential Smoothing (Holt-Winters inspired)
  - Seasonal Decomposition
  - Random Forest Regressor (ensemble ML)
  - Ensemble / Blended forecast

Features:
  - Multi-product / multi-category management
  - Upload CSV or use demo data
  - Configurable forecast horizon (1–24 months)
  - Confidence intervals
  - KPI dashboard (MAPE, RMSE, MAE, R²)
  - Seasonal & trend analysis
  - Anomaly detection
  - Inventory recommendations
  - Full persistence (JSON)
"""

from flask import Flask, render_template, request, jsonify, send_file
import json, os, uuid, math, random
from datetime import datetime, timedelta
from io import StringIO, BytesIO
import numpy as np

# scikit-learn
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline

app = Flask(__name__)

DATA_DIR   = os.path.join(os.path.dirname(__file__), "data")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(DATA_DIR,   exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

PRODUCTS_FILE  = os.path.join(DATA_DIR, "products.json")
FORECASTS_FILE = os.path.join(DATA_DIR, "forecasts.json")

# ══════════════════════════════════════════════════════════
#  DEMO DATA GENERATOR
# ══════════════════════════════════════════════════════════

DEMO_PRODUCTS = [
    {"name": "Laptop Pro X1",      "category": "Electronics",  "unit": "units",  "price": 75000},
    {"name": "Wireless Headphones","category": "Electronics",  "unit": "units",  "price": 3500},
    {"name": "Organic Coffee",     "category": "Food & Bev",   "unit": "kg",     "price": 850},
    {"name": "Running Shoes",      "category": "Apparel",      "unit": "pairs",  "price": 4200},
    {"name": "Smart Watch",        "category": "Electronics",  "unit": "units",  "price": 18000},
    {"name": "Vitamin C Tablets",  "category": "Healthcare",   "unit": "bottles","price": 320},
    {"name": "Yoga Mat",           "category": "Sports",       "unit": "units",  "price": 1200},
    {"name": "Hand Sanitizer",     "category": "Healthcare",   "unit": "liters", "price": 180},
]

def generate_sales_data(product_name, months=36, base=None, trend=None, seasonality=None, noise_level=0.12):
    """Generate realistic synthetic sales time series with trend + seasonality + noise."""
    random.seed(hash(product_name) % 10000)
    np.random.seed(hash(product_name) % 10000)

    if base is None:
        base = random.randint(200, 2000)
    if trend is None:
        trend = random.uniform(-0.005, 0.025)
    if seasonality is None:
        # Different seasonal patterns per category
        cat_season = {
            "Electronics":  [0.85,0.80,0.90,0.95,0.92,0.88,0.95,0.98,1.10,1.05,1.30,1.55],
            "Food & Bev":   [0.90,0.88,0.95,1.05,1.10,1.15,1.20,1.15,1.00,0.95,0.95,1.15],
            "Apparel":      [0.80,0.78,0.95,1.10,1.15,1.05,0.90,0.95,1.05,1.10,1.20,1.45],
            "Healthcare":   [1.20,1.15,1.00,0.90,0.88,0.85,0.85,0.90,0.95,1.00,1.05,1.25],
            "Sports":       [0.85,0.88,1.05,1.15,1.20,1.18,1.10,1.05,1.00,0.90,0.85,0.80],
        }
        seasonality = cat_season.get("Electronics")  # default

    data = []
    start_date = datetime.now() - timedelta(days=months * 30)

    for i in range(months):
        month_idx   = i % 12
        seasonal    = seasonality[month_idx] if seasonality else 1.0
        trend_mult  = 1 + trend * i
        noise       = np.random.normal(1.0, noise_level)
        # Occasional spike (promotions / events)
        if random.random() < 0.05:
            noise *= random.uniform(1.3, 1.8)
        value = max(10, base * seasonal * trend_mult * noise)
        date  = start_date + timedelta(days=i * 30)
        data.append({
            "date":  date.strftime("%Y-%m"),
            "value": round(value, 1),
        })
    return data


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path) as f: return json.load(f)
        except: pass
    return default

def save_json(path, data):
    with open(path, "w") as f: json.dump(data, f, indent=2, default=str)

def load_products(): return load_json(PRODUCTS_FILE, [])
def save_products(p): save_json(PRODUCTS_FILE, p)
def load_forecasts(): return load_json(FORECASTS_FILE, [])
def save_forecasts(f): save_json(FORECASTS_FILE, f)

# ══════════════════════════════════════════════════════════
#  FORECASTING ENGINE
# ══════════════════════════════════════════════════════════

def prepare_features(values, lags=3):
    """Create lag features for ML models."""
    X, y = [], []
    for i in range(lags, len(values)):
        X.append(values[i-lags:i][::-1])  # most recent first
        y.append(values[i])
    return np.array(X), np.array(y)

def moving_average_forecast(values, window, horizon):
    """Simple moving average forecast."""
    preds = []
    hist  = list(values)
    for _ in range(horizon):
        w = min(window, len(hist))
        pred = np.mean(hist[-w:])
        preds.append(pred)
        hist.append(pred)
    return preds

def exponential_smoothing(values, alpha=0.3, beta=0.1, gamma=0.2, season_len=12):
    """Holt-Winters triple exponential smoothing."""
    n = len(values)
    if n < season_len * 2:
        # Fall back to simple double exponential
        level  = values[0]
        trend  = (values[1] - values[0]) if n > 1 else 0
        result = []
        for v in values:
            prev_l = level
            level  = alpha * v + (1 - alpha) * (level + trend)
            trend  = beta  * (level - prev_l) + (1 - beta) * trend
            result.append(level + trend)
        return result, level, trend, None

    # Initialise
    season  = [values[i] / (np.mean(values[:season_len]) + 1e-9) for i in range(season_len)]
    level   = np.mean(values[:season_len])
    trend   = (np.mean(values[season_len:season_len*2]) - np.mean(values[:season_len])) / season_len
    result  = []

    for i, v in enumerate(values):
        s_idx   = i % season_len
        prev_l  = level
        level   = alpha * (v / (season[s_idx] + 1e-9)) + (1 - alpha) * (level + trend)
        trend   = beta  * (level - prev_l) + (1 - beta) * trend
        season[s_idx] = gamma * (v / (level + 1e-9)) + (1 - gamma) * season[s_idx]
        result.append((level + trend) * season[s_idx])

    return result, level, trend, season

def holt_winters_predict(level, trend, season, horizon, season_len=12):
    """Project Holt-Winters forecast forward."""
    preds = []
    s = list(season) if season else None
    for h in range(1, horizon + 1):
        if s:
            s_idx = (len(s) + h - 1) % season_len
            pred  = (level + h * trend) * s[s_idx]
        else:
            pred = level + h * trend
        preds.append(max(0, pred))
    return preds

def linear_forecast(values, horizon):
    """Linear regression forecast."""
    X = np.arange(len(values)).reshape(-1, 1)
    y = np.array(values)
    model = LinearRegression().fit(X, y)
    future_X = np.arange(len(values), len(values) + horizon).reshape(-1, 1)
    return model.predict(future_X).tolist(), float(model.coef_[0]), float(model.intercept_)

def polynomial_forecast(values, horizon, degree=3):
    """Polynomial regression forecast."""
    X = np.arange(len(values)).reshape(-1, 1)
    y = np.array(values)
    pipe = Pipeline([("poly", PolynomialFeatures(degree)), ("lr", LinearRegression())])
    pipe.fit(X, y)
    future_X = np.arange(len(values), len(values) + horizon).reshape(-1, 1)
    preds = pipe.predict(future_X)
    return [max(0, p) for p in preds]

def rf_forecast(values, horizon, lags=6):
    """Random Forest ML forecast with recursive strategy."""
    if len(values) < lags + 5:
        return moving_average_forecast(values, 3, horizon)
    X, y = prepare_features(values, lags)
    model = RandomForestRegressor(n_estimators=100, random_state=42, max_depth=6)
    model.fit(X, y)
    hist  = list(values)
    preds = []
    for _ in range(horizon):
        feat = np.array(hist[-lags:][::-1]).reshape(1, -1)
        pred = float(model.predict(feat)[0])
        pred = max(0, pred)
        preds.append(pred)
        hist.append(pred)
    return preds

def gb_forecast(values, horizon, lags=6):
    """Gradient Boosting forecast."""
    if len(values) < lags + 5:
        return moving_average_forecast(values, 3, horizon)
    X, y = prepare_features(values, lags)
    model = GradientBoostingRegressor(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42)
    model.fit(X, y)
    hist  = list(values)
    preds = []
    for _ in range(horizon):
        feat = np.array(hist[-lags:][::-1]).reshape(1, -1)
        pred = float(model.predict(feat)[0])
        pred = max(0, pred)
        preds.append(pred)
        hist.append(pred)
    return preds

def compute_metrics(actual, predicted):
    """MAPE, MAE, RMSE, R²."""
    actual    = np.array(actual)
    predicted = np.array(predicted)
    n         = min(len(actual), len(predicted))
    if n == 0: return {}
    a, p = actual[:n], predicted[:n]
    mape = float(np.mean(np.abs((a - p) / (a + 1e-9))) * 100)
    mae  = float(mean_absolute_error(a, p))
    rmse = float(np.sqrt(mean_squared_error(a, p)))
    r2   = float(r2_score(a, p)) if n > 1 else 0.0
    return {"mape": round(mape,2), "mae": round(mae,2), "rmse": round(rmse,2), "r2": round(r2,4)}

def detect_anomalies(values, threshold=2.5):
    """Z-score anomaly detection."""
    arr   = np.array(values)
    mean  = np.mean(arr)
    std   = np.std(arr) + 1e-9
    z     = np.abs((arr - mean) / std)
    return [{"index": int(i), "value": float(v), "z_score": round(float(z[i]),2)}
            for i, v in enumerate(values) if z[i] > threshold]

def seasonal_decompose(values, period=12):
    """Simple seasonal decomposition (additive)."""
    n = len(values)
    if n < period * 2:
        return {"trend": values, "seasonal": [0]*n, "residual": [0]*n}
    # Trend via centred moving average
    half = period // 2
    trend = []
    for i in range(n):
        start = max(0, i - half)
        end   = min(n, i + half + 1)
        trend.append(float(np.mean(values[start:end])))
    # Seasonal indices
    detrended = [values[i] - trend[i] for i in range(n)]
    season_idx = [0.0] * period
    counts     = [0] * period
    for i, d in enumerate(detrended):
        season_idx[i % period] += d
        counts[i % period]     += 1
    season_avg = [season_idx[i] / (counts[i] or 1) for i in range(period)]
    seasonal   = [season_avg[i % period] for i in range(n)]
    residual   = [values[i] - trend[i] - seasonal[i] for i in range(n)]
    return {"trend": [round(t,2) for t in trend],
            "seasonal": [round(s,2) for s in seasonal],
            "residual": [round(r,2) for r in residual]}

def confidence_intervals(preds, hist_std, ci=0.95):
    """Compute expanding confidence intervals."""
    z = 1.96 if ci == 0.95 else 1.645
    lower, upper = [], []
    for i, p in enumerate(preds):
        margin = z * hist_std * math.sqrt(i + 1)
        lower.append(round(max(0, p - margin), 1))
        upper.append(round(p + margin, 1))
    return lower, upper

def ensemble_forecast(lin, poly, hw, rf, gb, weights=None):
    """Weighted ensemble of all models."""
    if weights is None:
        weights = [0.10, 0.15, 0.25, 0.30, 0.20]  # lin, poly, hw, rf, gb
    n = min(len(lin), len(poly), len(hw), len(rf), len(gb))
    result = []
    for i in range(n):
        v = (lin[i]*weights[0] + poly[i]*weights[1] +
             hw[i] *weights[2] + rf[i] *weights[3] + gb[i]*weights[4])
        result.append(round(max(0, v), 1))
    return result

def full_forecast(values, horizon=12):
    """Run all models and return complete forecast package."""
    vals  = [float(v) for v in values]
    n     = len(vals)
    std   = float(np.std(vals))
    mean  = float(np.mean(vals))

    # Hold-out last 3 months for validation (if enough data)
    val_n = min(3, n // 4)
    train = vals[:-val_n] if val_n > 0 else vals
    val   = vals[-val_n:] if val_n > 0 else []

    # --- Run all models on training data ---
    lin_p, lin_slope, lin_intercept = linear_forecast(train, horizon + val_n)
    poly_p  = polynomial_forecast(train, horizon + val_n, degree=min(3, len(train)//4))
    hw_res, hw_level, hw_trend, hw_season = exponential_smoothing(train)
    hw_p    = holt_winters_predict(hw_level, hw_trend, hw_season, horizon + val_n)
    rf_p    = rf_forecast(train, horizon + val_n)
    gb_p    = gb_forecast(train, horizon + val_n)

    # Ensemble on future horizon
    lin_fut  = lin_p[val_n:]
    poly_fut = poly_p[val_n:]
    hw_fut   = hw_p[val_n:] if len(hw_p) >= val_n + horizon else hw_p[:horizon]
    rf_fut   = rf_p[val_n:]
    gb_fut   = gb_p[val_n:]

    # Ensure all same length
    min_len = min(len(lin_fut), len(poly_fut), len(hw_fut), len(rf_fut), len(gb_fut), horizon)
    lin_fut  = lin_fut[:min_len]
    poly_fut = poly_fut[:min_len]
    hw_fut   = hw_fut[:min_len]
    rf_fut   = rf_fut[:min_len]
    gb_fut   = gb_fut[:min_len]

    ens_fut  = ensemble_forecast(lin_fut, poly_fut, hw_fut, rf_fut, gb_fut)

    # Confidence intervals on ensemble
    ci_lower, ci_upper = confidence_intervals(ens_fut, std * 0.15)

    # Validation metrics
    metrics = {}
    if val and val_n > 0:
        for name, pred in [("Linear", lin_p[:val_n]), ("Polynomial", poly_p[:val_n]),
                            ("Holt-Winters", hw_p[:val_n]),
                            ("Random Forest", rf_p[:val_n]), ("Gradient Boosting", gb_p[:val_n])]:
            metrics[name] = compute_metrics(val, pred[:val_n])
        metrics["Ensemble"] = compute_metrics(val, ens_fut[:val_n])

    # Seasonal decomposition
    decomp = seasonal_decompose(vals)

    # Anomaly detection
    anomalies = detect_anomalies(vals)

    # Trend analysis
    trend_dir   = "Upward 📈" if lin_slope > mean * 0.002 else ("Downward 📉" if lin_slope < -mean * 0.002 else "Stable ➡️")
    trend_pct   = round((lin_slope / (mean + 1e-9)) * 100, 2)
    growth_rate = round(((ens_fut[-1] - vals[-1]) / (vals[-1] + 1e-9)) * 100, 1) if ens_fut else 0

    # Moving averages (for chart overlay)
    ma3  = [round(float(np.mean(vals[max(0,i-2):i+1])), 1) for i in range(n)]
    ma6  = [round(float(np.mean(vals[max(0,i-5):i+1])), 1) for i in range(n)]
    ma12 = [round(float(np.mean(vals[max(0,i-11):i+1])),1) for i in range(n)]

    return {
        "historical":   vals,
        "forecasts": {
            "Linear":           [round(v,1) for v in lin_fut],
            "Polynomial":       [round(v,1) for v in poly_fut],
            "Holt-Winters":     [round(v,1) for v in hw_fut],
            "Random Forest":    [round(v,1) for v in rf_fut],
            "Gradient Boosting":[round(v,1) for v in gb_fut],
            "Ensemble":         ens_fut,
        },
        "ci_lower":   ci_lower,
        "ci_upper":   ci_upper,
        "metrics":    metrics,
        "decomposition": decomp,
        "anomalies":  anomalies,
        "trend": {
            "direction":   trend_dir,
            "slope":       round(lin_slope, 3),
            "monthly_pct": trend_pct,
            "growth_rate": growth_rate,
        },
        "stats": {
            "mean":   round(mean, 1),
            "std":    round(std,  1),
            "min":    round(float(min(vals)), 1),
            "max":    round(float(max(vals)), 1),
            "cv":     round(std / (mean + 1e-9) * 100, 1),
        },
        "moving_averages": {"ma3": ma3, "ma6": ma6, "ma12": ma12},
        "validation_actual": val,
    }

def inventory_recommendation(product, forecast_values, lead_time_days=30, service_level=0.95):
    """Calculate reorder point, safety stock, EOQ."""
    if not forecast_values: return {}
    avg_monthly = float(np.mean(forecast_values))
    std_monthly = float(np.std(forecast_values)) if len(forecast_values) > 1 else avg_monthly * 0.1

    daily_demand     = avg_monthly / 30
    std_daily_demand = std_monthly / 30
    z = 1.645 if service_level == 0.95 else 2.326  # 95% or 99%

    safety_stock  = round(z * std_daily_demand * math.sqrt(lead_time_days), 0)
    reorder_point = round(daily_demand * lead_time_days + safety_stock, 0)
    order_qty     = round(avg_monthly * 1.5, 0)          # simplified EOQ

    return {
        "avg_monthly_demand": round(avg_monthly, 1),
        "safety_stock":       int(safety_stock),
        "reorder_point":      int(reorder_point),
        "suggested_order_qty":int(order_qty),
        "lead_time_days":     lead_time_days,
        "service_level":      f"{int(service_level*100)}%",
    }

# ══════════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════════

@app.route("/")
def index():
    products = load_products()
    return render_template("index.html", product_count=len(products))

@app.route("/api/products")
def get_products():
    return jsonify(load_products())

@app.route("/api/products/add", methods=["POST"])
def add_product():
    d        = request.json
    products = load_products()
    pid      = str(uuid.uuid4())[:8]
    product  = {
        "id":       pid,
        "name":     d.get("name","").strip(),
        "category": d.get("category","General"),
        "unit":     d.get("unit","units"),
        "price":    float(d.get("price", 0)),
        "data":     d.get("data", []),
        "created_at": datetime.now().isoformat(),
    }
    if not product["name"]:
        return jsonify({"error": "Product name required"}), 400
    products.append(product)
    save_products(products)
    return jsonify({"success": True, "product": product})

@app.route("/api/products/delete/<pid>", methods=["DELETE"])
def delete_product(pid):
    products = [p for p in load_products() if p["id"] != pid]
    save_products(products)
    return jsonify({"success": True})

@app.route("/api/products/update/<pid>", methods=["PUT"])
def update_product(pid):
    d        = request.json
    products = load_products()
    for p in products:
        if p["id"] == pid:
            for field in ["name","category","unit","price","data"]:
                if field in d: p[field] = d[field]
            p["updated_at"] = datetime.now().isoformat()
    save_products(products)
    return jsonify({"success": True})

@app.route("/api/forecast/<pid>", methods=["POST"])
def run_forecast(pid):
    cfg      = request.json or {}
    horizon  = int(cfg.get("horizon", 6))
    products = load_products()
    product  = next((p for p in products if p["id"] == pid), None)
    if not product:
        return jsonify({"error": "Product not found"}), 404

    data   = product.get("data", [])
    values = [float(row["value"]) for row in data if "value" in row]
    dates  = [row["date"] for row in data if "date" in row]

    if len(values) < 4:
        return jsonify({"error": "Need at least 4 months of data to forecast"}), 400

    result = full_forecast(values, horizon)

    # Generate future date labels
    if dates:
        last = datetime.strptime(dates[-1], "%Y-%m")
    else:
        last = datetime.now().replace(day=1)
    future_dates = [(last + timedelta(days=32 * (i+1))).strftime("%Y-%m") for i in range(horizon)]
    future_dates = [datetime.strptime(d, "%Y-%m").strftime("%Y-%m") for d in future_dates]

    result["future_dates"]  = future_dates
    result["historical_dates"] = dates
    result["product"]       = product
    result["horizon"]       = horizon
    result["generated_at"]  = datetime.now().isoformat()

    # Inventory recommendation
    ens = result["forecasts"]["Ensemble"]
    result["inventory"] = inventory_recommendation(product, ens)

    # Revenue forecast (ensemble × price)
    price = float(product.get("price", 0))
    if price > 0:
        result["revenue_forecast"] = [round(v * price, 2) for v in ens]
        result["total_forecast_revenue"] = round(sum(result["revenue_forecast"]), 2)

    # Save to forecast history
    forecasts = load_forecasts()
    forecasts.insert(0, {
        "id":          str(uuid.uuid4())[:8],
        "product_id":  pid,
        "product_name":product["name"],
        "horizon":     horizon,
        "ensemble":    ens,
        "future_dates":future_dates,
        "metrics":     result["metrics"],
        "trend":       result["trend"],
        "generated_at":result["generated_at"],
    })
    save_forecasts(forecasts[:100])

    return jsonify(result)

@app.route("/api/seed", methods=["POST"])
def seed_demo():
    products = load_products()
    if len(products) >= 3:
        return jsonify({"message": "Already has products", "count": len(products)})

    season_maps = {
        "Electronics":  [0.85,0.80,0.90,0.95,0.92,0.88,0.95,0.98,1.10,1.05,1.30,1.55],
        "Food & Bev":   [0.90,0.88,0.95,1.05,1.10,1.15,1.20,1.15,1.00,0.95,0.95,1.15],
        "Apparel":      [0.80,0.78,0.95,1.10,1.15,1.05,0.90,0.95,1.05,1.10,1.20,1.45],
        "Healthcare":   [1.20,1.15,1.00,0.90,0.88,0.85,0.85,0.90,0.95,1.00,1.05,1.25],
        "Sports":       [0.85,0.88,1.05,1.15,1.20,1.18,1.10,1.05,1.00,0.90,0.85,0.80],
    }

    added = 0
    for dp in DEMO_PRODUCTS:
        season = season_maps.get(dp["category"], season_maps["Electronics"])
        base   = {"Laptop Pro X1":150,"Wireless Headphones":800,"Organic Coffee":1200,
                  "Running Shoes":500,"Smart Watch":300,"Vitamin C Tablets":3000,
                  "Yoga Mat":600,"Hand Sanitizer":2000}.get(dp["name"], 400)
        trend  = {"Laptop Pro X1":0.018,"Wireless Headphones":0.022,"Organic Coffee":0.008,
                  "Running Shoes":0.012,"Smart Watch":0.025,"Vitamin C Tablets":0.005,
                  "Yoga Mat":0.010,"Hand Sanitizer":-0.003}.get(dp["name"], 0.01)
        data   = generate_sales_data(dp["name"], months=36, base=base, trend=trend, seasonality=season)
        pid    = str(uuid.uuid4())[:8]
        products.append({
            "id":       pid,
            "name":     dp["name"],
            "category": dp["category"],
            "unit":     dp["unit"],
            "price":    dp["price"],
            "data":     data,
            "created_at": datetime.now().isoformat(),
        })
        added += 1

    save_products(products)
    return jsonify({"success": True, "added": added, "total": len(products)})

@app.route("/api/dashboard")
def dashboard():
    products  = load_products()
    forecasts = load_forecasts()

    total_revenue = 0
    categories    = {}
    for p in products:
        cat = p.get("category","Other")
        categories[cat] = categories.get(cat, 0) + 1
        vals = [r["value"] for r in p.get("data",[]) if "value" in r]
        if vals and p.get("price"):
            total_revenue += sum(vals[-12:]) * float(p["price"])

    # Best/worst performers (recent 3m avg vs prior 3m)
    performers = []
    for p in products:
        vals = [r["value"] for r in p.get("data",[]) if "value" in r]
        if len(vals) >= 6:
            recent = np.mean(vals[-3:])
            prior  = np.mean(vals[-6:-3])
            change = round((recent - prior) / (prior + 1e-9) * 100, 1)
            performers.append({"name":p["name"],"change":change,"recent":round(recent,1),"id":p["id"]})
    performers.sort(key=lambda x: x["change"], reverse=True)

    return jsonify({
        "total_products": len(products),
        "total_forecasts":len(forecasts),
        "total_revenue":  round(total_revenue, 0),
        "categories":     categories,
        "top_performers": performers[:3],
        "low_performers": performers[-3:] if len(performers) >= 3 else [],
        "recent_forecasts": forecasts[:5],
    })

@app.route("/api/compare", methods=["POST"])
def compare_products():
    """Compare multiple products side by side."""
    pids     = request.json.get("ids", [])
    products = load_products()
    result   = []
    for p in products:
        if p["id"] in pids:
            vals = [r["value"] for r in p.get("data",[]) if "value" in r]
            if vals:
                result.append({
                    "id":       p["id"],
                    "name":     p["name"],
                    "category": p["category"],
                    "data":     vals,
                    "dates":    [r["date"] for r in p.get("data",[]) if "date" in r],
                    "mean":     round(float(np.mean(vals)), 1),
                    "trend":    round(float((vals[-1]-vals[0])/(vals[0]+1e-9)*100), 1),
                })
    return jsonify(result)

@app.route("/api/upload_csv", methods=["POST"])
def upload_csv():
    """Parse uploaded CSV and create a product."""
    f        = request.files.get("file")
    name     = request.form.get("name","Uploaded Product")
    category = request.form.get("category","General")
    price    = float(request.form.get("price", 0))
    unit     = request.form.get("unit","units")

    if not f:
        return jsonify({"error": "No file uploaded"}), 400

    content  = f.read().decode("utf-8")
    lines    = [l.strip() for l in content.strip().split("\n") if l.strip()]
    data     = []
    for line in lines[1:]:   # skip header
        parts = line.split(",")
        if len(parts) >= 2:
            try:
                date  = parts[0].strip().strip('"')
                value = float(parts[1].strip())
                data.append({"date": date, "value": value})
            except: pass

    if len(data) < 4:
        return jsonify({"error": "CSV must have at least 4 rows (date, value)"}), 400

    products = load_products()
    pid      = str(uuid.uuid4())[:8]
    product  = {"id":pid,"name":name,"category":category,"unit":unit,
                "price":price,"data":data,"created_at":datetime.now().isoformat()}
    products.append(product)
    save_products(products)
    return jsonify({"success":True,"product":product})

@app.route("/api/forecasts/history")
def forecast_history():
    return jsonify(load_forecasts()[:20])

@app.route("/api/export/<pid>")
def export_product(pid):
    products = load_products()
    p = next((p for p in products if p["id"] == pid), None)
    if not p: return jsonify({"error": "Not found"}), 404
    from flask import make_response
    resp = make_response(json.dumps(p, indent=2))
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = f"attachment; filename={p['name'].replace(' ','_')}_data.json"
    return resp

if __name__ == "__main__":
    print("\n" + "="*56)
    print("  📈 Sales & Demand Forecasting System")
    print("  Running at: http://127.0.0.1:5000")
    print("="*56 + "\n")
    app.run(debug=True, port=5000)
