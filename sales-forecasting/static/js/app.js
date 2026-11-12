/* ══════════════════════════════════════════════════
   FORECASTAI — COMPLETE FRONTEND LOGIC
══════════════════════════════════════════════════ */

// ── Chart.js CDN loaded inline ──────────────────────────
const CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
let chartJsLoaded = false;
let chartJsQueue  = [];

function ensureChartJs(cb) {
  if (window.Chart) { cb(); return; }
  chartJsQueue.push(cb);
  if (chartJsLoaded) return;
  chartJsLoaded = true;
  const s = document.createElement("script");
  s.src = CDN;
  s.onload = () => { chartJsQueue.forEach(fn => fn()); chartJsQueue = []; };
  document.head.appendChild(s);
}

// ── Active chart instances (destroy before re-draw) ─────
const charts = {};
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── State ───────────────────────────────────────────────
let allProducts = [];
let lastForecast = null;
let lastForecastProduct = null;
let chartView = "forecast";

const MODEL_COLORS = {
  "Linear":           "#6366f1",
  "Polynomial":       "#a78bfa",
  "Holt-Winters":     "#38bdf8",
  "Random Forest":    "#4ade80",
  "Gradient Boosting":"#fbbf24",
  "Ensemble":         "#f87171",
};

// ══════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════

function switchTab(id) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach(n => n.classList.remove("active"));
  document.getElementById("tab-" + id).classList.add("active");
  const lnk = document.querySelector(`[data-tab="${id}"]`);
  if (lnk) lnk.classList.add("active");
  if (window.innerWidth < 768) document.getElementById("sidebar").classList.remove("open");

  if (id === "dashboard") loadDashboard();
  if (id === "products")  loadProducts();
  if (id === "forecast")  refreshFcProductSelect();
  if (id === "compare")   loadCompare();
  if (id === "history")   loadHistory();
}

document.querySelectorAll(".nav-link").forEach(l =>
  l.addEventListener("click", e => { e.preventDefault(); switchTab(l.dataset.tab); }));

document.getElementById("burger").addEventListener("click", () =>
  document.getElementById("sidebar").classList.toggle("open"));

// ══════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════

function toast(msg, dur = 3200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.remove("show"), dur);
}

// ══════════════════════════════════════════════════════════
//  LOADING OVERLAY
// ══════════════════════════════════════════════════════════

function showLoading(title = "Processing…", steps = []) {
  const el = document.getElementById("genLoading");
  document.getElementById("glTitle").textContent  = title;
  document.getElementById("glStatus").textContent = steps[0] || "";
  const stepsEl = document.getElementById("glSteps");
  stepsEl.innerHTML = steps.map(s => `<div class="gls">${s}</div>`).join("");
  if (stepsEl.firstChild) stepsEl.firstChild.classList.add("active");
  el.style.display = "flex";
  return stepsEl;
}

function animateSteps(stepsEl) {
  return new Promise(resolve => {
    const items = stepsEl.querySelectorAll(".gls");
    let i = 0;
    const iv = setInterval(() => {
      if (i > 0) { items[i-1].classList.remove("active"); items[i-1].classList.add("done"); items[i-1].textContent = "✓ " + items[i-1].textContent; }
      if (i < items.length) { items[i].classList.add("active"); i++; }
      else { clearInterval(iv); setTimeout(resolve, 250); }
    }, 480);
  });
}

function hideLoading() { document.getElementById("genLoading").style.display = "none"; }

// ══════════════════════════════════════════════════════════
//  SEED DEMO
// ══════════════════════════════════════════════════════════

async function seedDemo() {
  const stepsEl = showLoading("Loading Demo Data…", ["Generating time series…","Adding seasonal patterns…","Seeding 8 products…"]);
  animateSteps(stepsEl);
  const r = await fetch("/api/seed", { method: "POST" });
  const d = await r.json();
  hideLoading();
  if (d.success) {
    toast(`✅ Seeded ${d.added} demo products!`);
    await loadDashboard();
    loadProducts();
    refreshFcProductSelect();
    loadCompare();
  } else {
    toast(d.message || "Already has data");
    loadDashboard();
  }
}

// ══════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════

async function loadDashboard() {
  const r = await fetch("/api/dashboard");
  const d = await r.json();

  setText("kpi-products",   d.total_products || 0);
  setText("kpi-revenue",    "₹" + fmtNum(d.total_revenue || 0));
  setText("kpi-forecasts",  d.total_forecasts || 0);
  setText("kpi-categories", Object.keys(d.categories || {}).length);
  setText("sb-products",    d.total_products || 0);
  setText("sb-forecasts",   d.total_forecasts || 0);

  // Show/hide getting started
  const gs = document.getElementById("getStarted");
  if (gs) gs.style.display = d.total_products === 0 ? "block" : "none";

  // Top performers
  const tp = document.getElementById("topPerformers");
  if (tp) tp.innerHTML = (d.top_performers || []).map(p => `
    <div class="perf-item">
      <span class="perf-name">${escHtml(p.name)}</span>
      <span class="perf-val">${p.recent}/mo</span>
      <span class="perf-change up">+${p.change}%</span>
    </div>`).join("") || "<p style='color:var(--muted);font-size:.8rem'>No data yet</p>";

  // Low performers
  const lp = document.getElementById("lowPerformers");
  if (lp) lp.innerHTML = (d.low_performers || []).map(p => `
    <div class="perf-item">
      <span class="perf-name">${escHtml(p.name)}</span>
      <span class="perf-val">${p.recent}/mo</span>
      <span class="perf-change ${p.change >= 0 ? "up" : "down"}">${p.change >= 0 ? "+" : ""}${p.change}%</span>
    </div>`).join("") || "<p style='color:var(--muted);font-size:.8rem'>No data yet</p>";

  // Category chart
  const cc = document.getElementById("catChart");
  if (cc && d.categories) {
    const cats = Object.entries(d.categories);
    const max  = Math.max(...cats.map(c => c[1]), 1);
    cc.innerHTML = cats.map(([cat, count]) => `
      <div class="cat-row">
        <span class="cat-lbl">${escHtml(cat)}</span>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${(count/max)*100}%"></div></div>
        <span class="cat-count">${count}</span>
      </div>`).join("") || "<p style='color:var(--muted);font-size:.8rem'>No data</p>";
  }

  // Recent forecasts
  const rf = document.getElementById("recentForecasts");
  if (rf && d.recent_forecasts) {
    rf.innerHTML = (d.recent_forecasts || []).map(f => {
      const trend = f.trend || {};
      const dir   = (trend.growth_rate || 0) >= 0;
      return `<div class="rf-item">
        <div><div class="rf-name">${escHtml(f.product_name)}</div><div class="rf-meta">${f.horizon}m horizon · ${new Date(f.generated_at).toLocaleDateString()}</div></div>
        <span class="${dir ? "rf-trend-up" : "rf-trend-down"}">${dir ? "+" : ""}${trend.growth_rate || 0}%</span>
      </div>`;
    }).join("") || "<p style='color:var(--muted);font-size:.8rem'>No forecasts yet</p>";
  }
}

// ══════════════════════════════════════════════════════════
//  PRODUCTS
// ══════════════════════════════════════════════════════════

async function loadProducts() {
  const r = await fetch("/api/products");
  allProducts = await r.json();
  renderProducts(allProducts);
}

function renderProducts(products) {
  const grid = document.getElementById("productsGrid");
  if (!products.length) {
    grid.innerHTML = `<div class="prod-empty"><div style="font-size:2rem;margin-bottom:.5rem">📦</div><p>No products yet. Add a product or <button onclick="seedDemo()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit">load demo data</button>.</p></div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const vals   = (p.data || []).map(d => d.value);
    const mean   = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(0) : 0;
    const last3  = vals.slice(-3);
    const prev3  = vals.slice(-6,-3);
    const l3avg  = last3.length ? last3.reduce((a,b)=>a+b,0)/last3.length : 0;
    const p3avg  = prev3.length ? prev3.reduce((a,b)=>a+b,0)/prev3.length : l3avg;
    const change = p3avg > 0 ? ((l3avg - p3avg)/p3avg*100).toFixed(1) : 0;
    const isUp   = parseFloat(change) >= 0;
    const months = (p.data || []).length;
    const sparkId = "spark-" + p.id;

    return `
    <div class="prod-card">
      <div class="pc-header">
        <div>
          <div class="pc-name">${escHtml(p.name)}</div>
          <span class="pc-cat">${escHtml(p.category)}</span>
        </div>
        <span class="${isUp ? "pc-trend-up" : "pc-trend-down"}">${isUp ? "↑" : "↓"} ${Math.abs(change)}%</span>
      </div>
      <canvas class="pc-sparkline" id="${sparkId}" height="50"></canvas>
      <div class="pc-meta">
        <div class="pc-meta-item"><span>Avg/Month</span><strong>${fmtNum(mean)} ${escHtml(p.unit)}</strong></div>
        <div class="pc-meta-item"><span>Data Points</span><strong>${months} months</strong></div>
        ${p.price ? `<div class="pc-meta-item"><span>Unit Price</span><strong>₹${fmtNum(p.price)}</strong></div>` : ""}
      </div>
      <div class="pc-actions">
        <button class="btn-glow" style="padding:.35rem .85rem;font-size:.75rem" onclick="quickForecast('${p.id}')">🔮 Forecast</button>
        <button class="btn-outline-sm" onclick="deleteProduct('${p.id}')">🗑 Delete</button>
        <button class="btn-outline-sm" onclick="exportProduct('${p.id}')">⬇ Export</button>
      </div>
    </div>`;
  }).join("");

  // Draw sparklines after DOM update
  setTimeout(() => {
    products.forEach(p => {
      const vals = (p.data || []).map(d => d.value);
      if (vals.length > 1) drawSparkline("spark-" + p.id, vals);
    });
  }, 50);
}

function drawSparkline(canvasId, values) {
  ensureChartJs(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    destroyChart(canvasId);
    const isUp  = values[values.length-1] >= values[0];
    const color = isUp ? "#4ade80" : "#f87171";
    charts[canvasId] = new Chart(canvas, {
      type: "line",
      data: {
        labels: values.map((_,i) => i),
        datasets: [{ data: values, borderColor: color, borderWidth: 1.5,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0,0,0,50);
            g.addColorStop(0, color + "30"); g.addColorStop(1, color + "00");
            return g;
          },
          pointRadius: 0, tension: 0.4 }]
      },
      options: { responsive: false, animation: false, plugins: { legend: { display:false } },
        scales: { x: { display:false }, y: { display:false } } }
    });
  });
}

async function deleteProduct(pid) {
  if (!confirm("Delete this product and all its data?")) return;
  await fetch(`/api/products/delete/${pid}`, { method: "DELETE" });
  toast("🗑 Product deleted");
  loadProducts();
  loadDashboard();
  refreshFcProductSelect();
}

async function exportProduct(pid) {
  window.open(`/api/export/${pid}`, "_blank");
  toast("⬇ Exporting…");
}

function quickForecast(pid) {
  document.getElementById("fcProduct").value = pid;
  switchTab("forecast");
  onProductSelect();
}

// ── Add Product Modal ────────────────────────────────────
function openAddProduct() { document.getElementById("addProdModal").style.display = "flex"; }
function closeProdModal() { document.getElementById("addProdModal").style.display = "none"; }

async function saveProduct() {
  const name     = document.getElementById("pName").value.trim();
  const category = document.getElementById("pCategory").value;
  const unit     = document.getElementById("pUnit").value;
  const price    = parseFloat(document.getElementById("pPrice").value || 0);
  const rawData  = document.getElementById("pData").value.trim();

  if (!name) { toast("⚠️ Product name is required"); return; }

  let data = [];
  if (rawData) {
    rawData.split("\n").forEach(line => {
      const parts = line.split(",");
      if (parts.length >= 2) {
        const date  = parts[0].trim();
        const value = parseFloat(parts[1].trim());
        if (!isNaN(value) && date) data.push({ date, value });
      }
    });
  }

  if (data.length === 0) {
    // Generate synthetic data if none provided
    const base  = Math.random() * 800 + 200;
    const trend = (Math.random() - 0.3) * 0.02;
    const start = new Date(); start.setMonth(start.getMonth() - 24);
    for (let i = 0; i < 24; i++) {
      const d = new Date(start); d.setMonth(d.getMonth() + i);
      const season = 1 + 0.2 * Math.sin((i / 12) * Math.PI * 2);
      const noise  = 1 + (Math.random() - 0.5) * 0.15;
      data.push({ date: d.toISOString().slice(0,7), value: Math.round(base * season * (1 + trend*i) * noise) });
    }
    toast("ℹ️ No data provided — sample data generated");
  }

  const r = await fetch("/api/products/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, category, unit, price, data })
  });
  const d = await r.json();
  if (d.success) {
    toast(`✅ "${name}" added!`);
    closeProdModal();
    loadProducts();
    loadDashboard();
    refreshFcProductSelect();
    ["pName","pPrice","pData"].forEach(id => document.getElementById(id).value = "");
  } else {
    toast("❌ " + (d.error || "Error"));
  }
}

// ── CSV Upload ───────────────────────────────────────────
function openCSVUpload()  { document.getElementById("csvModal").style.display = "flex"; }
function closeCSVModal()  { document.getElementById("csvModal").style.display = "none"; }

async function uploadCSV() {
  const name     = document.getElementById("csvName").value.trim() || "Uploaded Product";
  const category = document.getElementById("csvCategory").value;
  const price    = document.getElementById("csvPrice").value || 0;
  const file     = document.getElementById("csvFile").files[0];
  if (!file) { toast("⚠️ Please select a CSV file"); return; }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("name", name);
  fd.append("category", category);
  fd.append("price", price);
  fd.append("unit", "units");

  const r = await fetch("/api/upload_csv", { method: "POST", body: fd });
  const d = await r.json();
  if (d.success) {
    toast(`✅ "${name}" uploaded with ${d.product.data.length} months of data!`);
    closeCSVModal();
    loadProducts();
    loadDashboard();
    refreshFcProductSelect();
  } else {
    toast("❌ " + (d.error || "Upload failed"));
  }
}

// ══════════════════════════════════════════════════════════
//  FORECAST
// ══════════════════════════════════════════════════════════

async function refreshFcProductSelect() {
  const sel = document.getElementById("fcProduct");
  const r   = await fetch("/api/products");
  allProducts = await r.json();
  const cur  = sel.value;
  sel.innerHTML = `<option value="">— Select a product —</option>` +
    allProducts.map(p => `<option value="${p.id}" ${p.id===cur?"selected":""}>${escHtml(p.name)} (${p.category})</option>`).join("");
}

function onProductSelect() {
  const pid = document.getElementById("fcProduct").value;
  if (!pid) return;
}

function updateHorizon() {
  const v = document.getElementById("horizonSlider").value;
  document.getElementById("horizonVal").textContent = `${v} month${v>1?"s":""}`;
}

async function runForecast() {
  const pid     = document.getElementById("fcProduct").value;
  const horizon = parseInt(document.getElementById("horizonSlider").value);

  if (!pid) { toast("⚠️ Please select a product"); return; }

  const stepsEl = showLoading("Running Forecast…", [
    "Loading historical data",
    "Training Linear & Polynomial models",
    "Training Holt-Winters ETS",
    "Training Random Forest",
    "Training Gradient Boosting",
    "Building ensemble & confidence intervals",
  ]);
  animateSteps(stepsEl);

  try {
    const r = await fetch(`/api/forecast/${pid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horizon })
    });
    const d = await r.json();
    hideLoading();

    if (!r.ok) { toast("❌ " + (d.error || "Forecast failed")); return; }

    lastForecast        = d;
    lastForecastProduct = d.product;
    toast(`✅ Forecast complete! ${horizon}-month projection ready.`);

    document.getElementById("fcEmpty").style.display  = "none";
    document.getElementById("fcOutput").style.display = "block";

    renderForecastKPIs(d);
    renderForecastChart(d, "forecast");
    renderMetricsTable(d.metrics || {});
    renderForecastTable(d);
    renderInventory(d.inventory || {});
    renderAnomalies(d.anomalies || []);
    renderTrend(d.trend || {}, d.stats || {});
    renderRevenueChart(d);
    loadDashboard();
    setText("sb-forecasts", (parseInt(document.getElementById("sb-forecasts").textContent)||0)+1);

  } catch(e) {
    hideLoading();
    toast("❌ Network error: " + e.message);
  }
}

function renderForecastKPIs(d) {
  const ens    = d.forecasts?.Ensemble || [];
  const hist   = d.historical || [];
  const stats  = d.stats || {};
  const trend  = d.trend || {};
  const total  = ens.reduce((a,b)=>a+b,0);
  const avgFc  = ens.length ? (total/ens.length).toFixed(0) : 0;
  const best   = Object.entries(d.metrics||{}).reduce((b,[m,v])=> (!b.mape||v.mape<b.mape)?{model:m,...v}:b, {});

  document.getElementById("fcKpis").innerHTML = `
    <div class="fk-tile"><span class="fk-val">${fmtNum(avgFc)}</span><div class="fk-lbl">Avg Monthly Forecast</div></div>
    <div class="fk-tile"><span class="fk-val">${trend.direction||"—"}</span><div class="fk-lbl">Overall Trend</div></div>
    <div class="fk-tile"><span class="fk-val" style="color:var(--green)">${trend.growth_rate||0}%</span><div class="fk-lbl">Projected Growth</div></div>
    <div class="fk-tile"><span class="fk-val" style="color:var(--amber)">${best.mape ? best.mape.toFixed(1)+"%" : "—"}</span><div class="fk-lbl">Best MAPE (${best.model||"—"})</div></div>
  `;
}

function renderForecastChart(d, view) {
  chartView = view;
  const hist  = d.historical || [];
  const hdates= d.historical_dates || hist.map((_,i)=>`M-${hist.length-i}`);
  const fdates= d.future_dates || [];

  const allLabels = [...hdates, ...fdates];

  ensureChartJs(() => {
    destroyChart("fcChart");
    const ctx = document.getElementById("fcChart");
    if (!ctx) return;

    let datasets = [];

    if (view === "forecast") {
      // Historical line
      datasets.push({
        label: "Historical",
        data: [...hist.map(v=>({x:hdates[hist.indexOf(v)||0], y:v})),
               ...fdates.map(()=>null)],
        borderColor: "rgba(255,255,255,0.6)",
        backgroundColor: "rgba(255,255,255,0.03)",
        fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2,
        data: hist.map((v,i) => v),
        parsing: false,
      });

      // Selected model forecasts
      const selectedModels = [...document.querySelectorAll(".mchk input:checked")].map(c=>c.value);
      selectedModels.forEach(model => {
        const fc  = d.forecasts?.[model] || [];
        const color = MODEL_COLORS[model] || "#888";
        const isEns = model === "Ensemble";
        datasets.push({
          label: model,
          data: [...Array(hist.length).fill(null), ...fc],
          borderColor: color,
          backgroundColor: isEns ? color + "18" : "transparent",
          fill: isEns,
          tension: 0.4, borderWidth: isEns ? 2.5 : 1.5,
          borderDash: isEns ? [] : [4,3],
          pointRadius: 0,
        });
      });

      // CI bands
      const ci_lower = d.ci_lower || [];
      const ci_upper = d.ci_upper || [];
      if (ci_lower.length && selectedModels.includes("Ensemble")) {
        datasets.push({
          label: "CI Upper",
          data: [...Array(hist.length).fill(null), ...ci_upper],
          borderColor: "transparent", backgroundColor: "rgba(248,113,113,0.08)",
          fill: "+1", pointRadius: 0, tension: 0.4
        });
        datasets.push({
          label: "CI Lower",
          data: [...Array(hist.length).fill(null), ...ci_lower],
          borderColor: "transparent", backgroundColor: "transparent",
          fill: false, pointRadius: 0, tension: 0.4
        });
      }

    } else if (view === "decomposition") {
      const dec = d.decomposition || {};
      datasets = [
        { label:"Original",  data: hist, borderColor:"rgba(255,255,255,0.5)", borderWidth:1.5, pointRadius:0, tension:0.3 },
        { label:"Trend",     data: dec.trend||[], borderColor:"#6366f1", borderWidth:2, pointRadius:0, tension:0.4 },
        { label:"Seasonal",  data: (dec.seasonal||[]).map((v,i)=>hist[i]+v), borderColor:"#4ade80", borderWidth:1.5, borderDash:[4,3], pointRadius:0, tension:0.4 },
        { label:"Residual",  data: (dec.residual||[]).map((v,i)=>hist[i]+v), borderColor:"#fbbf24", borderWidth:1, borderDash:[2,4], pointRadius:0, tension:0.4 },
      ];
    } else if (view === "ma") {
      const ma = d.moving_averages || {};
      datasets = [
        { label:"Actual", data: hist, borderColor:"rgba(255,255,255,0.4)", borderWidth:1.5, pointRadius:0, tension:0.3 },
        { label:"MA-3",   data: ma.ma3||[], borderColor:"#38bdf8", borderWidth:2, pointRadius:0, tension:0.4 },
        { label:"MA-6",   data: ma.ma6||[], borderColor:"#4ade80", borderWidth:2, pointRadius:0, tension:0.4 },
        { label:"MA-12",  data: ma.ma12||[], borderColor:"#fbbf24", borderWidth:2, pointRadius:0, tension:0.4 },
      ];
    }

    // Add vertical divider annotation at hist end
    const histLen = hist.length;

    charts["fcChart"] = new Chart(ctx, {
      type: "line",
      data: { labels: allLabels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color:"#8a90b8", font:{ size:11, family:"Outfit" }, boxWidth:12, boxHeight:12 }, display:true },
          tooltip: { backgroundColor:"#162540", borderColor:"rgba(255,255,255,.1)", borderWidth:1,
                     titleColor:"#e4edff", bodyColor:"#8a90b8", padding:10, cornerRadius:8 }
        },
        scales: {
          x: { grid:{ color:"rgba(255,255,255,.04)" }, ticks:{ color:"#4a5878", font:{size:10,family:"Outfit"}, maxTicksLimit:14 } },
          y: { grid:{ color:"rgba(255,255,255,.04)" }, ticks:{ color:"#4a5878", font:{size:10,family:"Outfit"} } }
        }
      }
    });
  });
}

function setChartView(btn, view) {
  document.querySelectorAll(".ctb").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (lastForecast) renderForecastChart(lastForecast, view);
}

function renderMetricsTable(metrics) {
  const el = document.getElementById("metricsTable");
  if (!Object.keys(metrics).length) { el.innerHTML = "<p style='color:var(--muted);font-size:.8rem'>Not enough data for validation metrics (need >8 months)</p>"; return; }

  const order = ["Ensemble","Random Forest","Gradient Boosting","Holt-Winters","Polynomial","Linear"];
  const rows  = order.filter(m => metrics[m]).map(m => ({ model: m, ...metrics[m] }));
  if (!rows.length) { el.innerHTML = "<p style='color:var(--muted);font-size:.8rem'>Insufficient validation data</p>"; return; }

  const bestMape = Math.min(...rows.map(r => r.mape || 999));

  el.innerHTML = `
    <table class="mt-table">
      <thead><tr><th>Model</th><th>MAPE (%)</th><th>MAE</th><th>RMSE</th><th>R²</th></tr></thead>
      <tbody>
        ${rows.map(r => `
        <tr class="${r.mape===bestMape?'best':''}">
          <td class="mt-model" style="color:${MODEL_COLORS[r.model]||'#8a90b8'}">${r.model}${r.mape===bestMape?' ⭐':''}</td>
          <td class="${r.mape===bestMape?'mt-best':'mt-val'}">${r.mape?.toFixed(2)||'—'}%</td>
          <td class="mt-val">${r.mae?.toFixed(1)||'—'}</td>
          <td class="mt-val">${r.rmse?.toFixed(1)||'—'}</td>
          <td class="mt-val" style="color:${(r.r2||0)>0.8?'var(--green)':'var(--amber)'}">${r.r2?.toFixed(3)||'—'}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderForecastTable(d) {
  const ens    = d.forecasts?.Ensemble || [];
  const fdates = d.future_dates || [];
  const lower  = d.ci_lower || [];
  const upper  = d.ci_upper || [];
  const price  = d.product?.price || 0;
  const hist   = d.historical || [];
  const lastH  = hist[hist.length-1] || 1;

  const tbl = document.getElementById("fcTable");
  tbl.innerHTML = `
    <thead><tr>
      <th>Month</th><th>Forecast (Ensemble)</th><th>CI Lower</th><th>CI Upper</th>
      <th>vs Last Actual</th>${price > 0 ? "<th>Est. Revenue (₹)</th>" : ""}
    </tr></thead>
    <tbody>
      ${ens.map((v,i) => {
        const chg     = ((v - lastH)/lastH*100).toFixed(1);
        const isUp    = parseFloat(chg) >= 0;
        const revCell = price > 0 ? `<td>₹${fmtNum((v*price).toFixed(0))}</td>` : "";
        return `<tr>
          <td>${fdates[i]||""}</td>
          <td><strong>${fmtNum(v.toFixed(1))}</strong></td>
          <td style="color:var(--sub)">${lower[i]||"—"}</td>
          <td style="color:var(--sub)">${upper[i]||"—"}</td>
          <td class="${isUp?"trend-up":"trend-dn"}">${isUp?"+":""}${chg}%</td>
          ${revCell}
        </tr>`;
      }).join("")}
    </tbody>`;
}

function renderInventory(inv) {
  const el = document.getElementById("inventoryRec");
  if (!Object.keys(inv).length) { el.innerHTML = "<p style='color:var(--muted);font-size:.8rem'>—</p>"; return; }
  el.innerHTML = `
    <div class="inv-item"><span class="inv-label">Avg Monthly Demand</span><span class="inv-val">${inv.avg_monthly_demand}</span></div>
    <div class="inv-item"><span class="inv-label">Safety Stock</span><span class="inv-val" style="color:var(--amber)">${inv.safety_stock} units</span></div>
    <div class="inv-item"><span class="inv-label">Reorder Point</span><span class="inv-val" style="color:var(--blue)">${inv.reorder_point} units</span></div>
    <div class="inv-item"><span class="inv-label">Suggested Order Qty</span><span class="inv-val" style="color:var(--green)">${inv.suggested_order_qty} units</span></div>
    <div class="inv-item"><span class="inv-label">Lead Time</span><span class="inv-val">${inv.lead_time_days} days</span></div>
    <div class="inv-item"><span class="inv-label">Service Level</span><span class="inv-val">${inv.service_level}</span></div>`;
}

function renderAnomalies(anomalies) {
  const el = document.getElementById("anomalyList");
  if (!anomalies.length) { el.innerHTML = `<div class="no-anom">✅ No anomalies detected</div>`; return; }
  el.innerHTML = anomalies.map(a => `
    <div class="anom-item">
      <div class="anom-dot"></div>
      <div class="anom-txt">Month ${a.index + 1}: value = <strong>${a.value}</strong></div>
      <span class="anom-z">z=${a.z_score}</span>
    </div>`).join("");
}

function renderTrend(trend, stats) {
  const el = document.getElementById("trendAnalysis");
  el.innerHTML = `
    <div class="trend-big"><div class="trend-dir">${trend.direction || "—"}</div></div>
    <div class="trend-row"><span class="trend-lbl">Monthly Slope</span><span class="trend-v">${trend.slope||0} units/mo</span></div>
    <div class="trend-row"><span class="trend-lbl">Monthly Change %</span><span class="trend-v">${trend.monthly_pct||0}%</span></div>
    <div class="trend-row"><span class="trend-lbl">Projected Growth (${lastForecast?.horizon||6}m)</span><span class="trend-v" style="color:${(trend.growth_rate||0)>=0?"var(--green)":"var(--red)"}">${(trend.growth_rate||0)>=0?"+":""}${trend.growth_rate||0}%</span></div>
    <div class="trend-row"><span class="trend-lbl">Historical Mean</span><span class="trend-v">${stats.mean||0}</span></div>
    <div class="trend-row"><span class="trend-lbl">Std Deviation</span><span class="trend-v">${stats.std||0}</span></div>
    <div class="trend-row"><span class="trend-lbl">Coefficient of Variation</span><span class="trend-v">${stats.cv||0}%</span></div>
    <div class="trend-row"><span class="trend-lbl">Min / Max</span><span class="trend-v">${stats.min||0} / ${stats.max||0}</span></div>`;
}

function renderRevenueChart(d) {
  const revCard = document.getElementById("revenueCard");
  const revFc   = d.revenue_forecast || [];
  if (!revFc.length) { revCard.style.display = "none"; return; }
  revCard.style.display = "block";

  ensureChartJs(() => {
    destroyChart("revenueChart");
    const ctx = document.getElementById("revenueChart");
    if (!ctx) return;
    charts["revenueChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: d.future_dates || [],
        datasets: [{
          label: "Revenue (₹)",
          data: revFc,
          backgroundColor: revFc.map((_,i) => `rgba(99,102,241,${0.4 + i/revFc.length*0.4})`),
          borderColor: "#6366f1", borderWidth: 1, borderRadius: 6,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{backgroundColor:"#162540",titleColor:"#e4edff",bodyColor:"#8a90b8",padding:10,cornerRadius:8,callbacks:{label:(c)=>`₹${fmtNum(c.raw.toFixed(0))}`}}},
        scales:{
          x:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#4a5878",font:{size:10}}},
          y:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#4a5878",font:{size:10},callback:(v)=>"₹"+fmtNum(v)}}
        }
      }
    });
  });
}

function exportForecastCSV() {
  if (!lastForecast) { toast("No forecast to export"); return; }
  const ens   = lastForecast.forecasts?.Ensemble || [];
  const dates = lastForecast.future_dates || [];
  const lower = lastForecast.ci_lower || [];
  const upper = lastForecast.ci_upper || [];
  const price = lastForecast.product?.price || 0;
  let csv = "Date,Ensemble Forecast,CI Lower,CI Upper" + (price ? ",Revenue (₹)" : "") + "\n";
  ens.forEach((v,i) => {
    csv += `${dates[i]||""},${v},${lower[i]||""},${upper[i]||""}${price?","+((v*price).toFixed(2)):""}\n`;
  });
  const blob = new Blob([csv], {type:"text/csv"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `forecast_${lastForecastProduct?.name||"product"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("⬇ Forecast CSV downloaded!");
}

// ══════════════════════════════════════════════════════════
//  COMPARE
// ══════════════════════════════════════════════════════════

function loadCompare() {
  const el = document.getElementById("compareSel");
  if (!allProducts.length) {
    el.innerHTML = "<p style='color:var(--muted);font-size:.82rem'>No products to compare. Add products first.</p>";
    return;
  }
  el.innerHTML = allProducts.map(p => `
    <div class="cmp-chip" data-pid="${p.id}" onclick="toggleCompare(this)">
      ${escHtml(p.name)} <span style="color:var(--muted);font-size:.65rem">(${p.category})</span>
    </div>`).join("");
}

function toggleCompare(el) { el.classList.toggle("selected"); }

async function runComparison() {
  const selected = [...document.querySelectorAll(".cmp-chip.selected")].map(e => e.dataset.pid);
  if (selected.length < 2) { toast("⚠️ Select at least 2 products to compare"); return; }

  const r = await fetch("/api/compare", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ids: selected})
  });
  const d = await r.json();
  if (!d.length) { toast("No data found"); return; }

  document.getElementById("compareOutput").style.display = "block";

  const colors = ["#6366f1","#4ade80","#f87171","#fbbf24","#38bdf8","#a78bfa","#f472b6"];
  const maxLen = Math.max(...d.map(p => p.data.length));
  const labels = Array.from({length:maxLen},(_,i)=>i+1);

  ensureChartJs(() => {
    destroyChart("compareChart");
    const ctx = document.getElementById("compareChart");
    charts["compareChart"] = new Chart(ctx, {
      type:"line",
      data:{
        labels,
        datasets: d.map((p,i)=>({
          label: p.name,
          data:  p.data,
          borderColor: colors[i%colors.length],
          backgroundColor: colors[i%colors.length]+"15",
          fill: false, tension:0.4, borderWidth:2, pointRadius:0,
        }))
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{labels:{color:"#8a90b8",font:{size:11,family:"Outfit"},boxWidth:12}},
          tooltip:{backgroundColor:"#162540",titleColor:"#e4edff",bodyColor:"#8a90b8",padding:10,cornerRadius:8}},
        scales:{
          x:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#4a5878",font:{size:10},maxTicksLimit:12}},
          y:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#4a5878",font:{size:10}}}
        }
      }
    });
  });

  // Comparison table
  document.getElementById("compareTable").innerHTML = `
    <table class="cmp-table">
      <thead><tr><th>Product</th><th>Category</th><th>Avg/Month</th><th>Trend (full period)</th><th>Data Points</th></tr></thead>
      <tbody>
        ${d.map((p,i) => `
          <tr>
            <td style="color:${colors[i%colors.length]};font-weight:600">${escHtml(p.name)}</td>
            <td>${escHtml(p.category)}</td>
            <td>${fmtNum(p.mean)}</td>
            <td class="${p.trend>=0?"trend-up":"trend-dn"}">${p.trend>=0?"+":""}${p.trend}%</td>
            <td>${p.data.length} months</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ══════════════════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════════════════

async function loadHistory() {
  const r = await fetch("/api/forecasts/history");
  const d = await r.json();
  const el = document.getElementById("historyList");
  if (!d.length) {
    el.innerHTML = `<div class="hist-empty"><div style="font-size:2rem;margin-bottom:.5rem">📋</div><p>No forecasts run yet. Go to Forecast tab to get started.</p></div>`;
    return;
  }
  el.innerHTML = d.map(f => {
    const trend = f.trend || {};
    const dir   = (trend.growth_rate||0) >= 0;
    return `<div class="hist-card">
      <div class="hc-icon">📈</div>
      <div class="hc-info">
        <div class="hc-name">${escHtml(f.product_name)}</div>
        <div class="hc-meta">${new Date(f.generated_at).toLocaleString("en-IN")} · ${f.horizon}-month horizon</div>
        <div class="hc-badges">
          <span class="hc-badge">${f.horizon}m forecast</span>
          <span class="hc-badge" style="color:${dir?"var(--green)":"var(--red)"}">${dir?"+":""}${trend.growth_rate||0}% growth</span>
          <span class="hc-badge">${trend.direction||""}</span>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

function escHtml(s = "") {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function setText(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function fmtNum(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return n;
  if (num >= 1e7)  return (num/1e7).toFixed(1) + "Cr";
  if (num >= 1e5)  return (num/1e5).toFixed(1) + "L";
  if (num >= 1000) return (num/1000).toFixed(1) + "k";
  return num.toLocaleString("en-IN");
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

window.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
  loadProducts();
  refreshFcProductSelect();
  loadCompare();

  // Close modals on backdrop
  ["addProdModal","csvModal"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", e => { if (e.target === el) el.style.display = "none"; });
  });

  // Enter on instruction
  document.getElementById("pData")?.addEventListener("keydown", e => e.stopPropagation());
});
