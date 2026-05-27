import { DEFAULT_ROBOTS } from './constants.js';

const rosConns = {};

function toggleRos() {
  const panel = document.getElementById('ros-panel');
  const btn = document.getElementById('ros-toggle');
  panel.classList.toggle('open');
  btn.classList.toggle('active', panel.classList.contains('open'));
}

function saveRosCfg() {
  const rows = document.querySelectorAll('.ros-row');
  const cfg = [...rows].map(row => ({
    playerNum: parseInt(row.querySelector('.ros-sel').value),
    ip: row.querySelector('.ros-ip').value.trim(),
  }));

  try {
    localStorage.setItem('rosCfg', JSON.stringify(cfg));
  } catch (e) {}
}

function rosSubscribe(ros, playerNum, state, scheduleRender) {
  const key = String(playerNum);
  const subs = [];

  function topic(name, type, cb) {
    const t = new window.ROSLIB.Topic({ ros, name, messageType: type });
    t.subscribe(cb);
    subs.push(t);
  }

  topic('/booster_soccer/player_decision', 'std_msgs/String', msg => {
    if (!state.robots[key]) state.robots[key] = { playerNum };
    state.robots[key].decision = msg.data;
    state.robots[key].decisionTime = Date.now();
    scheduleRender();
  });

  return subs;
}

function rosConnect(btn, state, scheduleRender) {
  const row = btn.closest('.ros-row');
  const playerNum = parseInt(row.querySelector('.ros-sel').value);
  const ip = row.querySelector('.ros-ip').value.trim();
  const stat = row.querySelector('.ros-stat');
  saveRosCfg();

  if (rosConns[playerNum]) {
    rosConns[playerNum].subs.forEach(sub => {
      try {
        sub.unsubscribe();
      } catch (e) {}
    });
    try {
      rosConns[playerNum].ros.close();
    } catch (e) {}
    delete rosConns[playerNum];
  }

  if (btn.textContent === 'Disconnect') {
    btn.textContent = 'Connect';
    btn.className = 'ros-btn';
    stat.textContent = '';
    return;
  }

  stat.textContent = '…';
  btn.textContent = 'Connecting…';
  btn.className = 'ros-btn';

  const ros = new window.ROSLIB.Ros({ url: `ws://${ip}:9090` });

  ros.on('connection', () => {
    stat.textContent = '✓';
    stat.style.color = '#3fb950';
    btn.textContent = 'Disconnect';
    btn.className = 'ros-btn ok';
    const subs = rosSubscribe(ros, playerNum, state, scheduleRender);
    rosConns[playerNum] = { ros, subs };
  });

  ros.on('error', () => {
    stat.textContent = '✗';
    stat.style.color = '#f85149';
    btn.textContent = 'Retry';
    btn.className = 'ros-btn err';
    console.warn(`[ROS] Connection to ws://${ip}:9090 failed. Run on robot: ros2 launch rosbridge_server rosbridge_websocket_launch.xml`);
  });

  ros.on('close', () => {
    if (btn.textContent !== 'Retry') {
      stat.textContent = '';
      btn.textContent = 'Connect';
      btn.className = 'ros-btn';
    }

    delete rosConns[playerNum];
    const key = String(playerNum);
    if (state.robots[key] && !state.robots[key].zone && !state.robots[key].ballZone) {
      delete state.robots[key];
      scheduleRender();
    }
  });
}

function addRosRow(cfg, state, scheduleRender) {
  const container = document.getElementById('ros-rows');
  const n = container.children.length + 1;
  const playerNum = cfg?.playerNum ?? n;
  const ip = cfg?.ip ?? `192.168.0.1${playerNum}`;

  const row = document.createElement('div');
  row.className = 'ros-row';
  row.innerHTML = `
    <select class="ros-sel" title="Player number">
      ${[1, 2, 3, 4, 5].map(i => `<option ${i === playerNum ? 'selected' : ''}>${i}</option>`).join('')}
    </select>
    <input class="ros-ip" value="${ip}" placeholder="192.168.0.11">
    <button class="ros-btn">Connect</button>
    <span class="ros-stat"></span>`;

  const connectBtn = row.querySelector('.ros-btn');
  connectBtn.addEventListener('click', () => rosConnect(connectBtn, state, scheduleRender));
  container.appendChild(row);
}

export function setupRos({ state, scheduleRender }) {
  document.getElementById('ros-toggle').addEventListener('click', toggleRos);
  document.getElementById('ros-add-btn').addEventListener('click', () => addRosRow(null, state, scheduleRender));

  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem('rosCfg') ?? '[]');
  } catch (e) {}

  const cfg = saved.length ? saved : DEFAULT_ROBOTS;
  cfg.forEach(robotCfg => addRosRow(robotCfg, state, scheduleRender));
}
