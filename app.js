// Dashboard vanilla JS — sin frameworks. Lee la API de solo lectura del bot
// (src/api/server.js) y refresca cada 30s. Todo el estado vive en el DOM,
// no hay build step: este archivo se sirve tal cual desde GitHub Pages.

// ---------- Config ----------
// Cambiá esto por la IP/dominio real del servidor (ver README.md). Se puede
// sobreescribir sin editar el archivo agregando ?api=http://IP:3001 a la URL,
// o guardando una vez en localStorage con localStorage.setItem('nuvera_api', '...').
const DEFAULT_API_BASE = 'https://shorter-sprung-process.ngrok-free.dev';

function resolveApiBase() {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('api');
  if (fromQuery) {
    localStorage.setItem('nuvera_api', fromQuery);
    return fromQuery;
  }
  return localStorage.getItem('nuvera_api') || DEFAULT_API_BASE;
}

const API_BASE = resolveApiBase();
const REFRESH_MS = 30000;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => (n === null || n === undefined ? '—' : `$${n.toFixed(2)}`);
const fmtPct = (n, digits = 1) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`);
const pnlClass = (n) => (n >= 0 ? 'pnl-pos' : 'pnl-neg');

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    // Evita la página de advertencia HTML que ngrok inyecta en tunnels free
    // cuando detecta un user-agent de navegador (rompería el fetch de JSON).
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function setConnWarning(show) {
  $('conn-warning').style.display = show ? 'block' : 'none';
}

// ---------- Render: header + stat cards ----------
function renderStatus(s) {
  const paused = s.estado !== 'operando';
  const dot = $('status-dot');
  const badge = $('status-badge');
  dot.style.background = paused ? 'var(--critical)' : 'var(--accent)';
  dot.style.boxShadow = paused ? '0 0 8px var(--critical)' : '0 0 8px var(--accent)';
  badge.textContent = paused ? '⏸️ PAUSADO' : '✅ OPERANDO';
  badge.className = `badge ${paused ? 'paused' : 'ok'}`;

  $('hdr-capital').textContent = fmtUsd(s.capital);
  const varHoyPct = s.capital ? (s.pnlHoy / s.capital) * 100 : 0;
  const varEl = $('hdr-var');
  varEl.textContent = `${fmtUsd(s.pnlHoy)} (${fmtPct(varHoyPct, 2)})`;
  varEl.className = `value mono ${pnlClass(s.pnlHoy)}`;

  $('hdr-fng').textContent = s.fearGreed !== null ? `${s.fearGreed} ${fngEmoji(s.fearGreed)} ${s.fearGreedLabel}` : 'N/A';

  $('stat-capital').textContent = fmtUsd(s.capital);

  const pnlEl = $('stat-pnl-hoy');
  pnlEl.textContent = fmtUsd(s.pnlHoy);
  pnlEl.className = `value mono ${pnlClass(s.pnlHoy)}`;

  $('stat-winrate').textContent = `${s.winrateHoy?.toFixed(1) ?? '0.0'}%`;

  const fondoPct = s.fondoServidorMeta > 0 ? (s.fondoServidor / s.fondoServidorMeta) * 100 : 0;
  $('stat-fondo').textContent = `${fmtUsd(s.fondoServidor)}/${fmtUsd(s.fondoServidorMeta)}`;

  // Progress bar (sección 7)
  $('fondo-progress').style.width = `${Math.min(fondoPct, 100).toFixed(1)}%`;
  $('fondo-detalle').textContent = `${fmtUsd(s.fondoServidor)} / ${fmtUsd(s.fondoServidorMeta)} (${fondoPct.toFixed(1)}%)`;
  $('fondo-eta').textContent = s.fondoServidorEtaDias !== null && s.fondoServidorEtaDias !== undefined
    ? `Estimado: ~${s.fondoServidorEtaDias} días para completar`
    : 'Estimado: calculando (sin datos de la última semana)';
}

function fngEmoji(value) {
  if (value === null || value === undefined) return '';
  if (value < 20) return '🔴';
  if (value < 35) return '🟠';
  if (value <= 65) return '🟡';
  if (value <= 80) return '🟢';
  return '🟢';
}

// ---------- Render: posiciones abiertas ----------
function renderPositions(positions) {
  const tbody = document.querySelector('#tbl-positions tbody');
  tbody.innerHTML = '';
  $('positions-empty').style.display = positions.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-positions').style.display = positions.length === 0 ? 'none' : 'table';

  for (const p of positions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="pair-cell mono">${p.par}</td>
      <td class="mono">${p.nivel ?? '—'}</td>
      <td class="mono">${p.precioEntrada ?? '—'}</td>
      <td class="mono">${p.precioActual ?? '—'}</td>
      <td class="mono ${pnlClass(p.pnlActual ?? 0)}">${p.pnlActual !== null ? fmtUsd(p.pnlActual) : '—'}</td>
      <td class="mono ${pnlClass(p.pnlPct ?? 0)}">${p.pnlPct !== null ? fmtPct(p.pnlPct, 2) : '—'}</td>
      <td class="mono">${p.tiempoAbierto ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ---------- Render: últimos trades ----------
function renderTrades(trades) {
  const tbody = document.querySelector('#tbl-trades tbody');
  tbody.innerHTML = '';
  $('trades-empty').style.display = trades.length === 0 ? 'block' : 'none';
  document.getElementById('tbl-trades').style.display = trades.length === 0 ? 'none' : 'table';

  for (const t of trades) {
    const tr = document.createElement('tr');
    const isWin = t.outcome === 'win';
    tr.innerHTML = `
      <td class="pair-cell mono">${t.par}</td>
      <td><span class="outcome-tag ${isWin ? 'win' : 'loss'}">${isWin ? 'WIN' : 'LOSS'}</span></td>
      <td class="mono ${pnlClass(t.pnl)}">${fmtUsd(t.pnl)}</td>
      <td class="mono">${t.duracion ?? '—'}</td>
      <td class="mono">${t.fecha ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ---------- Render: estadísticas por par ----------
function renderPairs(pairs) {
  const grid = $('pair-grid');
  grid.innerHTML = '';
  $('pairs-empty').style.display = pairs.length === 0 ? 'block' : 'none';

  for (const p of pairs) {
    const total = p.wins + p.losses;
    const wr = total > 0 ? (p.wins / total) * 100 : null;
    const card = document.createElement('div');
    card.className = 'pair-stat-card';
    card.innerHTML = `
      <div class="pair-name mono">${p.par}</div>
      <div class="row"><span>${p.wins}W ${p.losses}L</span><span class="wr">${wr !== null ? wr.toFixed(0) + '%' : '—'} WR</span></div>
      <div class="row"><span>PnL</span><span class="mono ${pnlClass(p.pnl)}">${fmtUsd(p.pnl)}</span></div>
      <div class="row"><span>Precio</span><span class="mono">${p.precio ?? '—'}</span></div>
      <div class="row"><span>Cambio 1h</span><span class="mono ${pnlClass(p.cambio1h ?? 0)}">${p.cambio1h !== null ? fmtPct(p.cambio1h, 2) : '—'}</span></div>
      <div class="health-bar-track"><div class="health-bar-fill" style="width:${Math.min(Math.max(p.salud ?? 0, 0), 150) / 1.5}%"></div></div>
    `;
    grid.appendChild(card);
  }
}

// ---------- Chart: capital histórico ----------
let capitalChart = null;
function renderCapitalChart(history) {
  const ctx = document.getElementById('capital-chart');
  const labels = history.map((h) => h.fecha.slice(5)); // MM-DD
  const values = history.map((h) => h.capital);
  const trendUp = values.length >= 2 ? values[values.length - 1] >= values[0] : true;
  const lineColor = trendUp ? '#00ff88' : '#f85149';

  const cssRoot = getComputedStyle(document.documentElement);
  const gridColor = cssRoot.getPropertyValue('--grid-line').trim() || 'rgba(255,255,255,0.06)';
  const textMuted = cssRoot.getPropertyValue('--text-muted').trim() || '#6e7681';

  const data = {
    labels,
    datasets: [{
      label: 'Capital',
      data: values,
      borderColor: lineColor,
      backgroundColor: trendUp ? 'rgba(0,255,136,0.08)' : 'rgba(248,81,73,0.08)',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: lineColor,
      pointHitRadius: 12,
      tension: 0.25,
      fill: true,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c2330',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#e6edf3',
        padding: 10,
        callbacks: {
          label: (item) => `Capital: $${item.parsed.y.toFixed(2)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: textMuted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        border: { color: gridColor },
      },
      y: {
        grid: { color: gridColor, drawTicks: false },
        ticks: { color: textMuted, callback: (v) => `$${v}` },
        border: { display: false },
      },
    },
  };

  if (capitalChart) {
    capitalChart.data = data;
    capitalChart.options = options;
    capitalChart.update();
  } else {
    capitalChart = new Chart(ctx, { type: 'line', data, options });
  }
}

// ---------- Main loop ----------
async function refreshAll() {
  try {
    const [status, positions, trades, capitalHistory, pairs] = await Promise.all([
      fetchJson('/api/status'),
      fetchJson('/api/positions'),
      fetchJson('/api/trades?limit=50'),
      fetchJson('/api/capital-history'),
      fetchJson('/api/pairs'),
    ]);

    setConnWarning(false);
    renderStatus(status);
    renderPositions(positions);
    renderTrades(trades);
    renderCapitalChart(capitalHistory);
    renderPairs(pairs);
  } catch (err) {
    console.error('[nuvera-dashboard] Error actualizando datos:', err.message);
    setConnWarning(true);
  }
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);
