import { setupFieldCanvas } from './field.js';
import { setupExamples } from './examples.js';
import { renderLegend, renderRobots } from './robots.js';
import { setupRos } from './ros.js';
import { setupScoreCharts } from './scoreCharts.js';
import { setupSocket } from './socket.js';

const state = {
  robots: {},
  gcGoalkeeper: null,
  fieldMode: 'zone',
};

const { drawField } = setupFieldCanvas(state, scheduleRender);
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

function handleTrackAction(playerNum, action) {
  const robot = state.robots[String(playerNum)];
  if (!robot) return;

  if (action === 'start') {
    robot.tracking = true;
    robot.trail = robot.rosPose ? [{ x: robot.rosPose.x, y: robot.rosPose.y }] : [];
  } else if (action === 'stop') {
    robot.tracking = false;
  } else if (action === 'clear') {
    robot.trail = [];
  }

  scheduleRender();
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;

  requestAnimationFrame(() => {
    renderPending = false;
    drawField(state.robots);
    renderRobots(state.robots, state.gcGoalkeeper, state.fieldMode, handleTrackAction);
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
