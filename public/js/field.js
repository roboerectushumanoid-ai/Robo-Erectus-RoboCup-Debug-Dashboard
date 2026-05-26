import { FIELD_H_MM, FIELD_W_MM, ROBOT_COLORS, ROLE_NAMES } from './constants.js';
import { zoneCenterMm } from './utils.js';

export function setupFieldCanvas(state) {
  const canvas = document.getElementById('field');
  const canvasWrap = document.getElementById('canvas-wrap');
  const ctx = canvas.getContext('2d');

  let canvasWidth = 540;
  let canvasHeight = 360;
  let displayWidth = 360;
  let displayHeight = 540;
  let pixelRatio = 1;

  function fieldToCanvas(x, y) {
    return [
      canvasWidth / 2 + x * (canvasWidth / FIELD_W_MM),
      canvasHeight / 2 - y * (canvasHeight / FIELD_H_MM),
    ];
  }

  function scaleMm(mm) {
    return mm * (canvasWidth / FIELD_W_MM);
  }

  function shortRole(role) {
    return {
      1: 'Striker',
      2: 'Goalie',
      3: 'Defender',
    }[role] ?? ROLE_NAMES[role] ?? '';
  }

  function zoneSpreadOffset(index, count) {
    if (count <= 1) return { x: 0, y: 0 };

    const colSpacing = FIELD_W_MM / 12;
    const rowSpacing = FIELD_H_MM / 12;
    const offsets = {
      2: [
        { x: -colSpacing, y: 0 },
        { x:  colSpacing, y: 0 },
      ],
      3: [
        { x: -colSpacing, y:  rowSpacing * 0.55 },
        { x:  colSpacing, y:  rowSpacing * 0.55 },
        { x: 0,           y: -rowSpacing * 0.85 },
      ],
    };

    if (offsets[count]) return offsets[count][index];

    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return {
      x: Math.cos(angle) * colSpacing,
      y: Math.sin(angle) * rowSpacing,
    };
  }

  function getRobotDrawEntries(robots) {
    const zoneOnlyRobots = Object.values(robots)
      .filter(robot => !robot.pose && robot.zone > 0)
      .sort((a, b) => a.playerNum - b.playerNum);
    const zoneGroups = new Map();
    zoneOnlyRobots.forEach(robot => {
      const key = String(robot.zone);
      if (!zoneGroups.has(key)) zoneGroups.set(key, []);
      zoneGroups.get(key).push(robot.playerNum);
    });

    return Object.values(robots).map(robot => {
      const zc = !robot.pose && robot.zone > 0 ? zoneCenterMm(robot.zone) : null;
      if (!robot.pose && !zc) return null;
      let { x, y, theta } = robot.pose ?? { x: zc.x, y: zc.y, theta: 0 };
      if (!robot.pose && zc) {
        const group = zoneGroups.get(String(robot.zone)) ?? [];
        const offset = zoneSpreadOffset(group.indexOf(robot.playerNum), group.length);
        x += offset.x;
        y += offset.y;
      }

      const [rx, ry] = fieldToCanvas(x, y);
      return { robot, x, y, theta, rx, ry };
    }).filter(Boolean);
  }

  function ballDisplayPosition(cx, cy, radius, robotEntries) {
    const clearance = Math.max(18, radius + scaleMm(900));
    const overlaps = (x, y) => robotEntries.some(({ rx, ry }) => Math.hypot(rx - x, ry - y) < clearance);
    if (!overlaps(cx, cy)) return { x: cx, y: cy };

    const step = clearance * 0.85;
    const candidates = [
      [ step, 0], [-step, 0], [0,  step], [0, -step],
      [ step,  step], [ step, -step], [-step,  step], [-step, -step],
    ].map(([dx, dy]) => ({
      x: Math.max(radius, Math.min(canvasWidth - radius, cx + dx)),
      y: Math.max(radius, Math.min(canvasHeight - radius, cy + dy)),
    }));

    return candidates
      .map(pos => ({
        ...pos,
        score: Math.min(...robotEntries.map(({ rx, ry }) => Math.hypot(rx - pos.x, ry - pos.y))),
      }))
      .sort((a, b) => b.score - a.score)[0] ?? { x: cx, y: cy };
  }

  function drawFootball(cx, cy, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = Math.max(1, radius * 0.12);
    ctx.stroke();
    ctx.clip();

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / 5;
      const px = cx + Math.cos(angle) * radius * 0.34;
      const py = cy + Math.sin(angle) * radius * 0.34;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / 5;
      const px = cx + Math.cos(angle) * radius * 0.82;
      const py = cy + Math.sin(angle) * radius * 0.82;
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * radius * 0.38, cy + Math.sin(angle) * radius * 0.38);
      ctx.lineTo(cx + Math.cos(angle) * radius * 0.64, cy + Math.sin(angle) * radius * 0.64);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = Math.max(1, radius * 0.08);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawZones() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);

    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * canvasWidth / 3, 0);
      ctx.lineTo(i * canvasWidth / 3, canvasHeight);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * canvasHeight / 3);
      ctx.lineTo(canvasWidth, i * canvasHeight / 3);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawField(robots) {
    if (!canvasWidth || !canvasHeight) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.setTransform(0, -pixelRatio, pixelRatio, 0, 0, pixelRatio * canvasWidth);

    ctx.fillStyle = '#0d3d0d';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    for (let s = 0; s < 9; s++) {
      if (s % 2 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(s * canvasWidth / 9, 0, canvasWidth / 9, canvasHeight);
      }
    }

    const halfFieldW = FIELD_W_MM / 2;
    const halfFieldH = FIELD_H_MM / 2;
    const goalW = 2600;
    const goalDepth = 500;
    const penaltyAreaW = 5600;
    const penaltyAreaDepth = 3000;
    const penaltyMarkDistance = 2000;

    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1, scaleMm(18));

    const [bx, by] = fieldToCanvas(-halfFieldW, halfFieldH);
    ctx.strokeRect(bx, by, scaleMm(FIELD_W_MM), scaleMm(FIELD_H_MM));

    drawZones();

    const [hla, hly1] = fieldToCanvas(0, halfFieldH);
    const [, hly2] = fieldToCanvas(0, -halfFieldH);
    ctx.beginPath();
    ctx.moveTo(hla, hly1);
    ctx.lineTo(hla, hly2);
    ctx.stroke();

    const [ccx, ccy] = fieldToCanvas(0, 0);
    ctx.beginPath();
    ctx.arc(ccx, ccy, scaleMm(1500), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(ccx, ccy, scaleMm(55), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    const [lgx, lgy] = fieldToCanvas(-halfFieldW, goalW / 2);
    ctx.fillRect(lgx, lgy, scaleMm(goalDepth), scaleMm(goalW));
    ctx.strokeRect(lgx, lgy, scaleMm(goalDepth), scaleMm(goalW));

    const [rgx, rgy] = fieldToCanvas(halfFieldW - goalDepth, goalW / 2);
    ctx.fillRect(rgx, rgy, scaleMm(goalDepth), scaleMm(goalW));
    ctx.strokeRect(rgx, rgy, scaleMm(goalDepth), scaleMm(goalW));

    const [lpx, lpy] = fieldToCanvas(-halfFieldW, penaltyAreaW / 2);
    ctx.strokeRect(lpx, lpy, scaleMm(penaltyAreaDepth), scaleMm(penaltyAreaW));

    const [rpx, rpy] = fieldToCanvas(halfFieldW - penaltyAreaDepth, penaltyAreaW / 2);
    ctx.strokeRect(rpx, rpy, scaleMm(penaltyAreaDepth), scaleMm(penaltyAreaW));

    [
      [-halfFieldW + penaltyMarkDistance, 0],
      [halfFieldW - penaltyMarkDistance, 0],
    ].forEach(([px, py]) => {
      const [sx, sy] = fieldToCanvas(px, py);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(sx, sy, scaleMm(55), 0, Math.PI * 2);
      ctx.fill();
    });

    const robotEntries = getRobotDrawEntries(robots);
    const seenBalls = [];
    Object.values(robots).forEach(robot => {
      if (!robot.pose || robot.ballAge < 0 || robot.ballAge > 3 || !robot.ball) return;
      const { x, y, theta } = robot.pose;
      const bx = x + robot.ball.x * Math.cos(theta) - robot.ball.y * Math.sin(theta);
      const by = y + robot.ball.x * Math.sin(theta) + robot.ball.y * Math.cos(theta);
      if (seenBalls.some(b => Math.hypot(b[0] - bx, b[1] - by) < 300)) return;
      seenBalls.push([bx, by]);

      const [cx, cy] = fieldToCanvas(bx, by);
      const br = Math.max(6, scaleMm(180));
      const pos = ballDisplayPosition(cx, cy, br, robotEntries);
      drawFootball(pos.x, pos.y, br);
    });

    if (!seenBalls.length) {
      let bestZone = 0;
      Object.values(robots).forEach(robot => {
        if (robot.ballZone > 0) bestZone = robot.ballZone;
      });

      const zc = zoneCenterMm(bestZone);
      if (zc) {
        const [cx, cy] = fieldToCanvas(zc.x, zc.y);
        const br = Math.max(8, scaleMm(400));
        const pos = ballDisplayPosition(cx, cy, br, robotEntries);
        drawFootball(pos.x, pos.y, br);
      }
    }

    robotEntries.forEach(({ robot, theta, rx, ry }) => {
      const color = ROBOT_COLORS[(robot.playerNum - 1) % ROBOT_COLORS.length];
      const rr = Math.max(8, scaleMm(330));
      const role = shortRole(robot.role);

      ctx.save();
      ctx.globalAlpha = robot.stale ? 0.3 : 1;

      const arrLen = rr * 2.4;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(theta) * arrLen, ry - Math.sin(theta) * arrLen);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, scaleMm(55));
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fillStyle = robot.fallen ? '#333' : color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, scaleMm(38));
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, scaleMm(280))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(rx, ry);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(String(robot.playerNum), 0, 0.5);

      if (role) {
        ctx.font = `800 ${Math.max(10, scaleMm(260))}px Consolas, monospace`;
        const labelPadX = Math.max(8, scaleMm(180));
        const labelW = ctx.measureText(role).width + labelPadX * 2;
        const labelH = Math.max(20, scaleMm(470));
        const labelY = -rr - labelH;
        const labelX = -labelW / 2;
        const labelTop = labelY - labelH / 2;

        ctx.fillStyle = '#0d1117';
        ctx.fillRect(labelX - 2, labelTop - 2, labelW + 4, labelH + 4);
        ctx.fillStyle = 'rgba(22,27,34,0.96)';
        ctx.fillRect(labelX, labelTop, labelW, labelH);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, scaleMm(28));
        ctx.strokeRect(labelX, labelTop, labelW, labelH);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(role, 0, labelY + 0.5);
      }

      ctx.restore();
    });
  }

  new ResizeObserver(() => {
    const { width, height } = canvasWrap.getBoundingClientRect();
    if (!width || !height) return;
    const fw = FIELD_W_MM / 1000;
    const fh = FIELD_H_MM / 1000;
    const scale = Math.min(width / fh, height / fw);
    canvasWidth = Math.floor(scale * fw);
    canvasHeight = Math.floor(scale * fh);
    displayWidth = canvasHeight;
    displayHeight = canvasWidth;
    pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(displayWidth * pixelRatio);
    canvas.height = Math.floor(displayHeight * pixelRatio);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    drawField(state.robots);
  }).observe(canvasWrap);

  return { drawField };
}
