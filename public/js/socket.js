import { renderPenalties } from './robots.js';
import { fmtTime } from './utils.js';

function setStatus(text, cls) {
  const el = document.getElementById('conn-status');
  el.textContent = text;
  el.className = cls;
}

export function setupSocket({ state, scheduleRender }) {
  const socket = window.io();

  socket.on('connect', () => setStatus('Connected', 'ok'));
  socket.on('disconnect', () => setStatus('Disconnected', 'err'));

  socket.on('state', ({ gameState, robots = {}, teamId }) => {
    document.getElementById('ib-teamid').textContent = teamId ?? '–';

    if (gameState) {
      const dot = document.getElementById('state-dot');
      dot.className = { Playing: 'playing', Ready: 'ready', Set: 'set', Finished: 'finished' }[gameState.state] ?? '';

      document.getElementById('ib-state-val').textContent = gameState.state;
      document.getElementById('ib-phase').textContent = gameState.gamePhase;
      document.getElementById('ib-half').textContent = gameState.firstHalf ? '1st Half' : '2nd Half';
      document.getElementById('ib-time').textContent = fmtTime(gameState.secsRemaining);
      document.getElementById('ib-setplay').textContent = gameState.setPlay;
      document.getElementById('ib-kicking').textContent = gameState.kickingTeam === 255 ? 'None' : (gameState.kickingTeam ?? '–');
      setStatus(`GC v${gameState.version} ✓`, 'ok');

      if (gameState.teams?.length >= 2) {
        document.getElementById('team0-name').textContent = `Team ${gameState.teams[0].teamNumber}`;
        document.getElementById('team1-name').textContent = `Team ${gameState.teams[1].teamNumber}`;
        document.getElementById('score0').textContent = gameState.teams[0].score;
        document.getElementById('score1').textContent = gameState.teams[1].score;
        renderPenalties(gameState.teams);

        const ourTeam = gameState.teams.find(team => team.teamNumber === teamId);
        state.gcGoalkeeper = ourTeam?.goalkeeper ?? null;
      }
    }

    Object.entries(robots ?? {}).forEach(([key, serverRobot]) => {
      const prev = state.robots[key] || {};
      const rosSeen = prev.lastSeen && (Date.now() - prev.lastSeen < 5000);
      state.robots[key] = {
        ...prev,
        ...serverRobot,
        pose: serverRobot.pose ?? prev.pose,
        decision: prev.decision,
        decisionTime: prev.decisionTime,
        rosBallAbs: prev.rosBallAbs,
        kickEvent: prev.kickEvent,
        stale: serverRobot.stale && !rosSeen ? true : (serverRobot.stale === false ? false : prev.stale),
      };
    });

    scheduleRender();
  });

  return socket;
}
