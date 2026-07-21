import { PENALTY_NAMES, ROBOT_COLORS, ROLE_NAMES } from './constants.js';
import { roleSwitchView } from './roleSwitch.js';
import { confColor, fmtN } from './utils.js';

function decisionClass(decision) {
  if (!decision) return '';
  if (decision.includes('kick')) return 'dc-kick';
  if (decision.includes('chase')) return 'dc-chase';
  if (decision.includes('adjust')) return 'dc-adjust';
  if (decision.includes('find')) return 'dc-find';
  if (decision.includes('retreat')) return 'dc-retreat';
  if (decision.includes('cross')) return 'dc-cross';
  if (decision.includes('hold')) return 'dc-hold';
  return 'dc-other';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const BALL_CONFIDENCE_PATH = {
  ok:  'M4.5 8.2 7 10.7 11.8 5.5',
  bad: 'M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8',
};

function buildBallConfidenceIcon() {
  const wrap = document.createElement('span');
  wrap.className = 'ball-confidence-icon';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  svg.appendChild(path);
  wrap.appendChild(svg);
  return { wrap, path };
}

function updateBallConfidenceIcon(icon, conf) {
  const confident = conf > 50;
  const label = confident ? 'Ball confidence above 50%' : 'Ball confidence below 50%';
  icon.wrap.className = `ball-confidence-icon ${confident ? 'ok' : 'bad'}`;
  icon.wrap.title = label;
  icon.wrap.setAttribute('aria-label', label);
  icon.path.setAttribute('d', confident ? BALL_CONFIDENCE_PATH.ok : BALL_CONFIDENCE_PATH.bad);
}

const LEAD_ICON_HTML = `<svg viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6.7"></circle>
  <path d="M4.8 8.2 7 10.3 11.4 5.8"></path>
</svg>`;

// Robot cards are built once per player number and mutated in place on every
// render instead of being torn down via innerHTML. The tracking buttons live
// on those same nodes: while the game is running, renders happen many times
// a second (every team-comm/GC packet and every ROS pose message), and
// rebuilding the button elements that often meant a click's mousedown and
// mouseup could straddle a rebuild and land on two different DOM nodes,
// which the browser silently drops as a click. Keeping the nodes stable
// fixes that regardless of render frequency.
const cardCache = new Map();

function buildRobotCard(playerNum) {
  const root = document.createElement('div');
  root.className = 'robot-card';

  const cardTop = document.createElement('div');
  cardTop.className = 'card-top';

  const avatar = document.createElement('div');
  avatar.className = 'card-avatar';
  avatar.textContent = String(playerNum);

  const titleCol = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'card-title';
  const titleText = document.createTextNode(`Robot ${playerNum}`);
  const leadIcon = document.createElement('span');
  leadIcon.className = 'lead-ball';
  leadIcon.title = 'Lead robot';
  leadIcon.setAttribute('aria-label', 'Lead robot');
  leadIcon.innerHTML = LEAD_ICON_HTML;
  leadIcon.hidden = true;
  title.append(titleText, leadIcon);

  const role = document.createElement('div');
  role.className = 'card-role';

  titleCol.append(title, role);
  cardTop.append(avatar, titleCol);

  const badges = document.createElement('div');
  badges.className = 'badges';

  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';

  const roleSwitchBanner = document.createElement('div');
  roleSwitchBanner.className = 'role-switch-banner';
  roleSwitchBanner.hidden = true;
  const roleSwitchMain = document.createElement('span');
  roleSwitchMain.className = 'role-switch-main';
  const roleSwitchSeq = document.createElement('span');
  roleSwitchSeq.className = 'role-switch-seq';
  roleSwitchBanner.append(roleSwitchMain, roleSwitchSeq);

  const cardStats = document.createElement('div');
  cardStats.className = 'card-stats';

  const decisionLabel = document.createElement('span');
  decisionLabel.className = 'sl';
  decisionLabel.textContent = 'Decision';
  decisionLabel.hidden = true;
  const decisionValue = document.createElement('span');
  decisionValue.className = 'sv';
  decisionValue.hidden = true;
  const decisionBadge = document.createElement('span');
  decisionBadge.className = 'decision-badge';
  decisionValue.append(decisionBadge);

  const poseLabel = mkEl('span', 'sl', 'Pose');
  const poseValue = mkEl('span', 'sv');
  const ballLabel = mkEl('span', 'sl', 'Ball');
  const ballValue = mkEl('span', 'sv');
  const ballZoneLabel = mkEl('span', 'sl', 'Ball Zone');
  const ballZoneValue = document.createElement('span');
  ballZoneValue.className = 'sv ball-zone-val';
  const ballZoneNum = document.createTextNode('');
  const ballZoneIcon = buildBallConfidenceIcon();
  ballZoneValue.append(ballZoneNum, document.createTextNode(' '), ballZoneIcon.wrap);

  const chaseLabel = mkEl('span', 'sl score-label', 'Chase Score');
  const chaseValue = mkEl('span', 'sv tactical-score');
  const goalieLabel = mkEl('span', 'sl score-label', 'Goalie Score');
  const goalieValue = mkEl('span', 'sv tactical-score');

  const trackingLabel = mkEl('span', 'sl', 'Tracking');
  trackingLabel.hidden = true;
  const trackingValue = document.createElement('span');
  trackingValue.className = 'sv';
  trackingValue.hidden = true;
  const startBtn = trackButton(playerNum, 'start', 'Start');
  const stopBtn = trackButton(playerNum, 'stop', 'Stop');
  const clearBtn = trackButton(playerNum, 'clear', 'Clear');
  trackingValue.append(startBtn, stopBtn, clearBtn);

  cardStats.append(
    decisionLabel, decisionValue,
    poseLabel, poseValue,
    ballLabel, ballValue,
    ballZoneLabel, ballZoneValue,
    chaseLabel, chaseValue,
    goalieLabel, goalieValue,
    trackingLabel, trackingValue,
  );

  const cardMeter = document.createElement('div');
  cardMeter.className = 'card-meter';
  const meterLabel = document.createElement('div');
  meterLabel.className = 'meter-label';
  meterLabel.textContent = 'Confidence';
  const meterTrack = document.createElement('div');
  meterTrack.className = 'meter-track';
  const meterFill = document.createElement('div');
  meterFill.className = 'meter-fill';
  meterTrack.append(meterFill);
  const meterVal = document.createElement('div');
  meterVal.className = 'meter-val';
  cardMeter.append(meterLabel, meterTrack, meterVal);

  cardBody.append(roleSwitchBanner, cardStats, cardMeter);
  root.append(cardTop, badges, cardBody);

  return {
    playerNum, root, avatar, title, titleText, leadIcon, role, badges, cardBody,
    roleSwitchBanner, roleSwitchMain, roleSwitchSeq,
    decisionLabel, decisionValue, decisionBadge,
    poseValue, ballValue, ballZoneNum, ballZoneIcon,
    chaseValue, goalieValue,
    trackingLabel, trackingValue, startBtn, stopBtn, clearBtn,
    meterFill, meterVal,
  };
}

function mkEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function trackButton(playerNum, action, label) {
  const btn = document.createElement('button');
  btn.className = 'track-btn';
  btn.dataset.player = String(playerNum);
  btn.dataset.action = action;
  btn.textContent = label;
  return btn;
}

function updateRobotCard(card, robot) {
  card.avatar.textContent = String(robot.playerNum);
  card.avatar.className = 'card-avatar card-avatar-empty';
  card.avatar.style.background = '';
  card.avatar.style.color = '';
  card.title.style.color = '';
  card.titleText.textContent = `Robot ${robot.playerNum}`;
  card.leadIcon.hidden = true;
  card.role.textContent = 'Waiting';
  card.badges.innerHTML = '';
  card.badges.hidden = true;
  card.cardBody.hidden = true;
  card.root.className = 'robot-card robot-card-empty';
  card.root.style.borderLeftColor = '';
}

export function setupRobotsPanel(onTrackAction) {
  const panel = document.getElementById('robots-panel');
  panel.addEventListener('click', e => {
    const btn = e.target.closest('.track-btn');
    if (!btn) return;
    onTrackAction(parseInt(btn.dataset.player, 10), btn.dataset.action);
  });
}

export function renderRobots(robots, gcGoalkeeper, fieldMode) {
  const panel = document.getElementById('robots-panel');

  if (!Object.keys(robots).length) {
    cardCache.clear();
    panel.innerHTML = '<div class="robots-empty">No robots detected</div>';
    return;
  }

  [1, 2, 3].forEach(playerNum => {
    if (!cardCache.has(playerNum)) {
      const card = buildRobotCard(playerNum);
      cardCache.set(playerNum, card);
      panel.appendChild(card.root);
    }
  });

  // Reorder to match player-number order (cheap: appendChild moves existing
  // nodes rather than recreating them, so button identity is preserved).
  [1, 2, 3].forEach(playerNum => panel.appendChild(cardCache.get(playerNum).root));

  [1, 2, 3].forEach(playerNum => {
    const card = cardCache.get(playerNum);
    const robot = robots[String(playerNum)];

    if (!robot) {
      updateRobotCard(card, { playerNum });
      return;
    }

    const statusColor = robot.stale ? '#8b949e' : robot.isLead ? '#2ea043' : '#f0f6fc';
    const avatarTextColor = robot.stale || robot.isLead ? '#ffffff' : '#0d1117';
    const conf = robot.confidence ?? 0;
    const roleName = robot.role !== undefined ? (ROLE_NAMES[robot.role] ?? `Role ${robot.role}`) : '–';
    const isGcGoalkeeper = gcGoalkeeper !== null && robot.playerNum === gcGoalkeeper;

    card.root.className = 'robot-card'
      + (robot.stale ? ' stale' : '')
      + (robot.isLead ? ' lead' : '')
      + (robot.kickEvent ? ' kick-flash' : '');
    card.root.style.borderLeftColor = statusColor;

    card.avatar.className = 'card-avatar';
    card.avatar.style.background = statusColor;
    card.avatar.style.color = avatarTextColor;
    card.badges.hidden = false;
    card.cardBody.hidden = false;

    card.title.style.color = statusColor;
    card.titleText.textContent = `Robot ${robot.playerNum}`;
    card.leadIcon.hidden = !robot.isLead;

    card.role.innerHTML = isGcGoalkeeper && roleName !== 'Goalkeeper'
      ? `${roleName} <span class="gc-gk-tag" title="GameController-designated goalkeeper">GC: GK</span>`
      : roleName;

    let badgeHtml = '';
    if (robot.stale) badgeHtml = '<span class="badge badge-stale">Stale</span>';
    else if (robot.fallen) badgeHtml = '<span class="badge badge-fallen">Fallen</span>';
    else if (robot.isLead) badgeHtml = '<span class="badge badge-lead">Lead</span>';
    else if (robot.isAlive) badgeHtml = '<span class="badge badge-active">Active</span>';
    card.badges.innerHTML = badgeHtml;

    const roleSwitch = roleSwitchView(robot, robots);
    card.roleSwitchBanner.hidden = !roleSwitch;
    if (roleSwitch) {
      card.roleSwitchBanner.className = `role-switch-banner ${roleSwitch.cls}`;
      card.roleSwitchMain.textContent = roleSwitch.text;
      card.roleSwitchSeq.textContent = roleSwitch.seq;
    }

    const decAge = robot.decisionTime ? (Date.now() - robot.decisionTime) / 1000 : 999;
    const decision = decAge < 5 ? (robot.decision ?? null) : null;
    card.decisionLabel.hidden = !decision;
    card.decisionValue.hidden = !decision;
    if (decision) {
      card.decisionBadge.className = `decision-badge ${decisionClass(decision)}`;
      card.decisionBadge.textContent = decision;
    }

    card.poseValue.textContent = robot.pose
      ? `(${fmtN(robot.pose.x / 1000, 2)}, ${fmtN(robot.pose.y / 1000, 2)}) m  ${fmtN(robot.pose.theta * 180 / Math.PI, 1)}°`
      : '–';

    if (robot.ballAge >= 0 && robot.ball) {
      card.ballValue.textContent = `${fmtN(robot.ballAge, 1)} s  rel(${fmtN(robot.ball.x / 1000, 2)}, ${fmtN(robot.ball.y / 1000, 2)}) m`;
    } else if (robot.ballZone > 0) {
      card.ballValue.textContent = `Zone ${robot.ballZone} (approx)`;
    } else {
      card.ballValue.textContent = 'Not seen';
    }

    card.ballZoneNum.textContent = fmtN(robot.ballZone);
    updateBallConfidenceIcon(card.ballZoneIcon, conf);

    card.chaseValue.textContent = fmtN(robot.chaseScore);
    card.goalieValue.textContent = fmtN(robot.goalieScore);

    const showTracking = fieldMode === 'pose';
    card.trackingLabel.hidden = !showTracking;
    card.trackingValue.hidden = !showTracking;
    card.startBtn.disabled = Boolean(robot.tracking);
    card.stopBtn.disabled = !robot.tracking;
    card.clearBtn.disabled = !robot.trail?.length;

    card.meterFill.style.width = `${conf}%`;
    card.meterFill.style.background = confColor(conf);
    card.meterVal.style.color = confColor(conf);
    card.meterVal.textContent = `${fmtN(conf)} %`;
  });
}

export function renderLegend(robots, gcGoalkeeper) {
  document.getElementById('legend').innerHTML = Object.values(robots)
    .sort((a, b) => a.playerNum - b.playerNum)
    .map(robot => {
      const color = ROBOT_COLORS[(robot.playerNum - 1) % ROBOT_COLORS.length];
      const role = robot.role !== undefined ? ROLE_NAMES[robot.role] ?? '' : '';
      const isGcGoalkeeper = gcGoalkeeper !== null && robot.playerNum === gcGoalkeeper;
      const roleLabel = isGcGoalkeeper && role !== 'Goalkeeper' ? `${role} (GC: GK)` : role;
      return `<span class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        R${robot.playerNum}${roleLabel ? ' · ' + roleLabel : ''}
      </span>`;
    }).join('');
}

export function renderPenalties(teams) {
  const el = document.getElementById('penalty-rows');
  if (!teams?.length) return;

  const rows = [];
  teams.forEach(team => (team.players ?? []).forEach(player => {
    if (!player.penalty) return;
    rows.push(`<div class="pen-row">
      <span class="pen-label">T${team.teamNumber}&nbsp;P${player.playerNum}</span>
      <span class="pen-reason">${PENALTY_NAMES[player.penalty] ?? `#${player.penalty}`}</span>
      ${player.secsTillUnpenalised > 0 ? `<span class="pen-time">(${player.secsTillUnpenalised}s)</span>` : ''}
    </div>`);
  }));

  el.innerHTML = rows.length ? rows.join('') : '<span class="muted-placeholder">None</span>';
}
