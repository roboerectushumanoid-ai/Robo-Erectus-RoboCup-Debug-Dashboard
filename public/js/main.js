import { setupFieldCanvas } from './field.js';
import { renderLegend, renderRobots } from './robots.js';
import { setupRos } from './ros.js';
import { setupSocket } from './socket.js';

const state = {
  robots: {},
  gcGoalkeeper: null,
};

const { drawField } = setupFieldCanvas(state);

let renderPending = false;

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;

  requestAnimationFrame(() => {
    renderPending = false;
    drawField(state.robots);
    renderRobots(state.robots, state.gcGoalkeeper);
    renderLegend(state.robots, state.gcGoalkeeper);
  });
}

drawField(state.robots);
setupSocket({ state, scheduleRender });
setupRos({ state, scheduleRender });
