import { FIELD_H_MM, FIELD_W_MM, ROBOT_COLORS } from './constants.js';
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
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.fillStyle = '#f0883e';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
        ctx.beginPath();
        ctx.arc(cx, cy, br, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(240,136,62,0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    Object.values(robots).forEach(robot => {
      const zc = !robot.pose && robot.zone > 0 ? zoneCenterMm(robot.zone) : null;
      if (!robot.pose && !zc) return;
      const { x, y, theta } = robot.pose ?? { x: zc.x, y: zc.y, theta: 0 };
      const [rx, ry] = fieldToCanvas(x, y);
      const color = ROBOT_COLORS[(robot.playerNum - 1) % ROBOT_COLORS.length];
      const rr = Math.max(8, scaleMm(330));

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
      ctx.arc(rx + 2, ry + 2, rr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();

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
      ctx.fillText(String(robot.playerNum), rx, ry + 0.5);

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
