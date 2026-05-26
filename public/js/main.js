import { setupFieldCanvas } from './field.js';
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

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;

  requestAnimationFrame(() => {
    renderPending = false;
    drawField(state.robots);
    renderRobots(state.robots, state.gcGoalkeeper);
    renderLegend(state.robots, state.gcGoalkeeper);
    scoreCharts.record(state.robots);
  });
}

drawField(state.robots);
scoreCharts.record(state.robots);
setupSocket({ state, scheduleRender });
setupRos({ state, scheduleRender });
