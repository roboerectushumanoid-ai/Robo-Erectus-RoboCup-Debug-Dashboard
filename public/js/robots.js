import { PENALTY_NAMES, ROBOT_COLORS, ROLE_NAMES } from './constants.js';
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

export function renderRobots(robots, gcGoalkeeper) {
  const panel = document.getElementById('robots-panel');
  const list = [1, 2, 3].map(playerNum => robots[String(playerNum)] ?? { playerNum, empty: true });

  if (!Object.keys(robots).length) {
    panel.innerHTML = '<div class="robots-empty">No robots detected</div>';
    return;
  }

  panel.innerHTML = list.map(robot => {
    if (robot.empty) {
      return `
<div class="robot-card robot-card-empty">
  <div class="card-top">
    <div class="card-avatar card-avatar-empty">${robot.playerNum}</div>
    <div>
      <div class="card-title">Robot ${robot.playerNum}</div>
      <div class="card-role">Waiting</div>
    </div>
  </div>
</div>`;
    }

    const color = ROBOT_COLORS[(robot.playerNum - 1) % ROBOT_COLORS.length];
    const conf = robot.confidence ?? 0;
    let role = robot.role !== undefined ? (ROLE_NAMES[robot.role] ?? `Role ${robot.role}`) : '–';
    if (gcGoalkeeper !== null && robot.playerNum === gcGoalkeeper) role = 'Goalkeeper';

    const badges = [];
    if (robot.stale) badges.push('<span class="badge badge-stale">Stale</span>');
    else if (robot.fallen) badges.push('<span class="badge badge-fallen">Fallen</span>');
    else if (robot.isLead) badges.push('<span class="badge badge-lead">Lead</span>');
    else if (robot.isAlive) badges.push('<span class="badge badge-active">Active</span>');

    const poseStr = robot.pose
      ? `(${fmtN(robot.pose.x / 1000, 2)}, ${fmtN(robot.pose.y / 1000, 2)}) m  ${fmtN(robot.pose.theta * 180 / Math.PI, 1)}°`
      : '–';

    let ballStr;
    if (robot.ballAge >= 0 && robot.ball) {
      ballStr = `${fmtN(robot.ballAge, 1)} s  rel(${fmtN(robot.ball.x / 1000, 2)}, ${fmtN(robot.ball.y / 1000, 2)}) m`;
    } else if (robot.ballZone > 0) {
      ballStr = `Zone ${robot.ballZone} (approx)`;
    } else {
      ballStr = 'Not seen';
    }

    const decAge = robot.decisionTime ? (Date.now() - robot.decisionTime) / 1000 : 999;
    const decision = decAge < 5 ? (robot.decision ?? null) : null;
    const decisionHtml = decision
      ? `<span class="sl">Decision</span><span class="sv"><span class="decision-badge ${decisionClass(decision)}">${decision}</span></span>`
      : '';

    const flashClass = robot.kickEvent ? ' kick-flash' : '';
    const leadIcon = robot.isLead
      ? `<span class="lead-ball" title="Lead robot" aria-label="Lead robot">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.7"></circle>
            <path d="M4.8 8.2 7 10.3 11.4 5.8"></path>
          </svg>
        </span>`
      : '';

    return `
<div class="robot-card${robot.stale ? ' stale' : ''}${flashClass}" style="border-left-color:${color}">
  <div class="card-top">
    <div class="card-avatar" style="background:${robot.fallen ? '#444' : color}">${robot.playerNum}</div>
    <div>
      <div class="card-title" style="color:${color}">Robot ${robot.playerNum}${leadIcon}</div>
      <div class="card-role">${role}</div>
    </div>
  </div>
  <div class="badges">${badges.join('')}</div>
  <div class="card-body">
    <div class="card-stats">
      ${decisionHtml}
      <span class="sl">Pose</span>         <span class="sv">${poseStr}</span>
      <span class="sl">Ball</span>         <span class="sv">${ballStr}</span>
      <span class="sl">Zone / Ball</span>  <span class="sv">${fmtN(robot.zone)} / ${fmtN(robot.ballZone)}</span>
      <span class="sl">Chase / Goalie</span><span class="sv">${fmtN(robot.chaseScore)} / ${fmtN(robot.goalieScore)}</span>
    </div>
    <div class="card-meter">
      <div class="meter-label">Confidence</div>
      <div class="meter-track">
        <div class="meter-fill" style="width:${conf}%;background:${confColor(conf)}"></div>
      </div>
      <div class="meter-val" style="color:${confColor(conf)}">${fmtN(conf)} %</div>
    </div>
  </div>
</div>`;
  }).join('');
}

export function renderLegend(robots, gcGoalkeeper) {
  document.getElementById('legend').innerHTML = Object.values(robots)
    .sort((a, b) => a.playerNum - b.playerNum)
    .map(robot => {
      const color = ROBOT_COLORS[(robot.playerNum - 1) % ROBOT_COLORS.length];
      let role = robot.role !== undefined ? ROLE_NAMES[robot.role] ?? '' : '';
      if (gcGoalkeeper !== null && robot.playerNum === gcGoalkeeper) role = 'Goalkeeper';
      return `<span class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        R${robot.playerNum}${role ? ' · ' + role : ''}
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
