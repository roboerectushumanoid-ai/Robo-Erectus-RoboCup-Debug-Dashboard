import { setupFieldCanvas } from './field.js';
import { setupExamples } from './examples.js';
import { renderLegend, renderRobots } from './robots.js';
import { setupRos } from './ros.js';
import { setupScoreCharts } from './scoreCharts.js';
import { setupSocket } from './socket.js';

const state = {
  robots: {},
  gcGoalkeeper: null,
};

const { drawField } = setupFieldCanvas(state);
const scoreCharts = setupScoreCharts(state);

let renderPending = false;
let roleSwitchExpiryTimer = null;

function scheduleRoleSwitchExpiry() {
  if (roleSwitchExpiryTimer) return;
  const hasRecentRoleSwitch = Object.values(state.robots).some(robot =>
    robot.roleSwitch?.opcode && robot.roleSwitchTime && Date.now() - robot.roleSwitchTime < 8500
  );
  if (!hasRecentRoleSwitch) return;

  roleSwitchExpiryTimer = setTimeout(() => {
    roleSwitchExpiryTimer = null;
    scheduleRender();
  }, 8200);
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;

  requestAnimationFrame(() => {
    renderPending = false;
    drawField(state.robots);
    renderRobots(state.robots, state.gcGoalkeeper);
    renderLegend(state.robots, state.gcGoalkeeper);
    scoreCharts.record(state.robots);
    scheduleRoleSwitchExpiry();
  });
}

drawField(state.robots);
scoreCharts.record(state.robots);
setupSocket({ state, scheduleRender });
setupRos({ state, scheduleRender });
setupExamples();
