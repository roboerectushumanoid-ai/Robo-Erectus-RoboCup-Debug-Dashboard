import { roleSwitchView } from './roleSwitch.js';

const STORAGE_KEY = 'scoreHistoryV1';
const MAX_HISTORY_MS = 5 * 60 * 1000;
const RANGES = {
  '60s': 60 * 1000,
  '5m': MAX_HISTORY_MS,
};

function robotEntries(robots) {
  return Object.values(robots ?? {})
    .filter(robot => robot && !robot.empty)
    .sort((a, b) => (a.playerNum ?? 0) - (b.playerNum ?? 0));
}

function scoreValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function fmtScore(value) {
  return value === null ? '-' : value.toFixed(0);
}

function clampScore(value) {
  if (value === null) return 0;
  return Math.max(0, Math.min(100, value));
}

function robotTone(robot) {
  if (robot?.stale) return { cls: 'stale', color: '#8b949e', label: 'Stale' };
  if (robot?.isLead) return { cls: 'lead', color: '#3fb950', label: 'Lead' };
  return { cls: 'active', color: '#f0f6fc', label: 'Active' };
}

function snapshot(robots, now) {
  return {
    time: now,
    robots: robotEntries(robots).map(robot => ({
      playerNum: robot.playerNum,
      chaseScore: scoreValue(robot.chaseScore),
      goalieScore: scoreValue(robot.goalieScore),
      stale: Boolean(robot.stale),
      isLead: Boolean(robot.isLead),
      isAlive: Boolean(robot.isAlive),
    })),
  };
}

function pruneHistory(history, now = Date.now()) {
  return history.filter(sample => sample?.time >= now - MAX_HISTORY_MS);
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return pruneHistory(parsed)
      .filter(sample => typeof sample.time === 'number' && Array.isArray(sample.robots))
      .map(sample => ({
        time: sample.time,
        robots: sample.robots
          .filter(robot => typeof robot.playerNum === 'number')
          .map(robot => ({
            playerNum: robot.playerNum,
            chaseScore: scoreValue(robot.chaseScore),
            goalieScore: scoreValue(robot.goalieScore),
            stale: Boolean(robot.stale),
            isLead: Boolean(robot.isLead),
            isAlive: Boolean(robot.isAlive),
          })),
      }));
  } catch (e) {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    // Ignore quota/private-mode failures; live in-memory charts still work.
  }
}

function resizeCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pxWidth = Math.floor(width * ratio);
  const pxHeight = Math.floor(height * ratio);

  if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
    canvas.width = pxWidth;
    canvas.height = pxHeight;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function drawGrid(ctx, bounds) {
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  [0, 25, 50, 75, 100].forEach(value => {
    const y = bounds.top + bounds.height - (value / 100) * bounds.height;
    ctx.beginPath();
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.left + bounds.width, y);
    ctx.stroke();
    ctx.fillText(String(value), bounds.left - 8, y);
  });
}

function drawSeries(ctx, samples, playerNum, key, color, bounds, rangeMs, now) {
  const points = [];
  const start = now - rangeMs;

  samples.forEach(sample => {
    const robot = sample.robots.find(entry => entry.playerNum === playerNum);
    const value = scoreValue(robot?.[key]);
    if (value === null) return;

    const x = bounds.left + Math.max(0, Math.min(1, (sample.time - start) / rangeMs)) * bounds.width;
    const y = bounds.top + bounds.height - (clampScore(value) / 100) * bounds.height;
    points.push({ x, y });
  });

  if (!points.length) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMetricChart(canvas, history, playerNum, key, label, tone, rangeMs) {
  const ctx = canvas.getContext('2d');
  const { width, height } = resizeCanvas(canvas, ctx);
  const now = Date.now();
  const samples = history.filter(sample => sample.time >= now - rangeMs);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  const bounds = {
    left: 36,
    top: 14,
    width: Math.max(1, width - 54),
    height: Math.max(1, height - 42),
  };

  drawGrid(ctx, bounds);
  drawSeries(ctx, samples, playerNum, key, tone.color, bounds, rangeMs, now);

  if (!samples.some(sample => {
    const robot = sample.robots.find(entry => entry.playerNum === playerNum);
    return scoreValue(robot?.[key]) !== null;
  })) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '12px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`No ${label.toLowerCase()} history`, width / 2, height / 2);
  }

  ctx.fillStyle = '#8b949e';
  ctx.font = '10px Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, bounds.left, 5);

  ctx.fillStyle = '#8b949e';
  ctx.font = '10px Consolas, monospace';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(`-${rangeMs === RANGES['60s'] ? '60s' : '5m'}`, bounds.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText('now', bounds.left + bounds.width, height - 8);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildScoreCard(playerNum) {
  const card = el('section', 'score-graph-card');
  card.dataset.playerNum = String(playerNum);

  const top = el('div', 'score-graph-top');
  const ident = el('div', 'score-graph-ident');
  const dot = el('span', 'score-robot-dot active');
  const title = el('h3', '', `Robot ${playerNum}`);
  const status = el('span', 'score-robot-status', 'Active');
  ident.append(dot, title, status);

  const values = el('div', 'score-current-values');
  const chaseBox = el('div', 'score-current-box');
  chaseBox.append(el('span', '', 'Chase'), el('strong', '', '-'));
  const goalieBox = el('div', 'score-current-box');
  goalieBox.append(el('span', '', 'Goalie'), el('strong', '', '-'));
  values.append(chaseBox, goalieBox);
  top.append(ident, values);
  const roleSwitchBanner = el('div', 'role-switch-banner');
  roleSwitchBanner.hidden = true;

  const charts = el('div', 'score-chart-pair');
  const chasePane = el('div', 'score-chart-pane');
  const chaseTitle = el('div', 'score-chart-title', 'Chase Score');
  const chaseCanvas = document.createElement('canvas');
  chaseCanvas.className = 'score-robot-canvas';
  chasePane.append(chaseTitle, chaseCanvas);

  const goaliePane = el('div', 'score-chart-pane');
  const goalieTitle = el('div', 'score-chart-title', 'Goalie Score');
  const goalieCanvas = document.createElement('canvas');
  goalieCanvas.className = 'score-robot-canvas';
  goaliePane.append(goalieTitle, goalieCanvas);
  charts.append(chasePane, goaliePane);

  card.append(top, roleSwitchBanner, charts);

  return {
    root: card,
    dot,
    status,
    roleSwitchBanner,
    chaseValue: chaseBox.querySelector('strong'),
    goalieValue: goalieBox.querySelector('strong'),
    chaseCanvas,
    goalieCanvas,
  };
}

export function setupScoreCharts(state) {
  const toggleBtn = document.getElementById('scores-toggle');
  const clearBtn = document.getElementById('scores-clear');
  const dashboardView = document.getElementById('right-dashboard-view');
  const scoreView = document.getElementById('right-score-view');
  const graphList = document.getElementById('score-robot-graphs');
  const rangeButtons = [...document.querySelectorAll('.score-range-btn')];

  let history = loadHistory();
  let activeRange = '60s';
  let scoreMode = false;
  const cards = new Map();

  function setScoreMode(nextMode) {
    scoreMode = nextMode;
    dashboardView.hidden = scoreMode;
    scoreView.hidden = !scoreMode;
    toggleBtn.classList.toggle('active', scoreMode);
    toggleBtn.textContent = scoreMode ? 'Robot Data' : 'Scores';
    if (scoreMode) render();
  }

  function setRange(range) {
    activeRange = RANGES[range] ? range : '60s';
    rangeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.range === activeRange));
    if (scoreMode) render();
  }

  function syncCards(entries) {
    const activePlayers = new Set(entries.map(robot => robot.playerNum));

    cards.forEach((card, playerNum) => {
      if (!activePlayers.has(playerNum)) {
        card.root.remove();
        cards.delete(playerNum);
      }
    });

    entries.forEach(robot => {
      if (!cards.has(robot.playerNum)) {
        cards.set(robot.playerNum, buildScoreCard(robot.playerNum));
      }
    });

    graphList.replaceChildren(...entries.map(robot => cards.get(robot.playerNum).root));
  }

  function render() {
    const entries = robotEntries(state.robots);
    syncCards(entries);

    if (!entries.length) {
      const empty = el('div', 'score-empty', 'Waiting for robot scores...');
      graphList.replaceChildren(empty);
      return;
    }

    entries.forEach(robot => {
      const card = cards.get(robot.playerNum);
      const tone = robotTone(robot);
      card.dot.className = `score-robot-dot ${tone.cls}`;
      card.status.textContent = tone.label;
      const roleSwitch = roleSwitchView(robot);
      if (roleSwitch) {
        card.roleSwitchBanner.className = `role-switch-banner ${roleSwitch.cls}`;
        card.roleSwitchBanner.replaceChildren(
          el('span', 'role-switch-main', roleSwitch.text),
          el('span', 'role-switch-seq', roleSwitch.seq),
        );
        card.roleSwitchBanner.hidden = false;
      } else {
        card.roleSwitchBanner.hidden = true;
      }

      card.chaseValue.textContent = fmtScore(scoreValue(robot.chaseScore));
      card.goalieValue.textContent = fmtScore(scoreValue(robot.goalieScore));
      drawMetricChart(card.chaseCanvas, history, robot.playerNum, 'chaseScore', 'Chase Score', tone, RANGES[activeRange]);
      drawMetricChart(card.goalieCanvas, history, robot.playerNum, 'goalieScore', 'Goalie Score', tone, RANGES[activeRange]);
    });
  }

  function record(robots) {
    const sample = snapshot(robots, Date.now());
    if (sample.robots.length) {
      history.push(sample);
      history = pruneHistory(history, sample.time);
      saveHistory(history);
    }

    if (scoreMode) render();
  }

  function clearHistory() {
    history = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}

    if (scoreMode) render();
  }

  toggleBtn.addEventListener('click', () => setScoreMode(!scoreMode));
  clearBtn.addEventListener('click', clearHistory);
  rangeButtons.forEach(btn => btn.addEventListener('click', () => setRange(btn.dataset.range)));
  window.addEventListener('resize', () => {
    if (scoreMode) render();
  });

  setRange(activeRange);

  return { record, render, toggleScoreView: () => setScoreMode(!scoreMode), clearHistory };
}
