# 📈 AI-Powered Sales & Demand Forecasting System

A full-stack ML forecasting app with 6 models, confidence intervals, and inventory recommendations.

## HOW TO RUN

```bash
cd sales-forecasting
pip install -r requirements.txt
python app.py
```
Open: http://127.0.0.1:5000

Click **"Load Demo Data"** in the sidebar to get 8 products with 36 months of realistic data instantly.

---

## FEATURES

| Feature | Details |
|---------|---------|
| 6 ML Models | Linear Regression, Polynomial (deg 3), Holt-Winters ETS, Random Forest, Gradient Boosting, Ensemble Blend |
| Confidence Intervals | 95% CI bands on ensemble forecast |
| Forecast Horizon | 1–24 months, slider-configurable |
| Model Metrics | MAPE, MAE, RMSE, R² on held-out validation data |
| Chart Views | Forecast overlay, Seasonal Decomposition, Moving Averages (3/6/12m) |
| Inventory AI | Safety stock, reorder point, suggested order qty |
| Anomaly Detection | Z-score based outlier flagging |
| Revenue Forecast | Monthly revenue projection with bar chart |
| Product Compare | Side-by-side multi-product trend comparison |
| CSV Upload | Import your own data (date, value format) |
| Export | CSV forecast export, JSON product data |
| Persistence | All data saved to JSON, survives restarts |

## TROUBLESHOOTING

- **"python not found"** → try `python3 app.py`
- **"pip not found"** → try `pip3 install -r requirements.txt`
- **Port in use** → edit last line of app.py, change `port=5000` to `port=5001`

## CSV FORMAT

Upload your own sales data as:
```
date,sales
2024-01,500
2024-02,530
2024-03,480
```

## PROJECT STRUCTURE

```
sales-forecasting/
├── app.py              ← Flask + 6 ML models
├── requirements.txt
├── README.md
├── data/               ← Auto-created JSON storage
├── templates/
│   └── index.html      ← Full UI
└── static/
    ├── css/style.css
    └── js/app.js       ← Charts + interactions
```
