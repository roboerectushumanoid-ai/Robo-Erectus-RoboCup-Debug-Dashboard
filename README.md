# RoboCup Debug Dashboard

A lightweight, locally-hosted debug dashboard for RoboCup HSL matches.
It **only listens** — it never sends anything to the robots.

## Folder structure

```
robocup-gui/
├── server.js        ← Node.js backend: UDP listeners + WebSocket server
├── package.json
└── public/
    └── index.html   ← Frontend: runs in your browser (served by server.js)
```

> **Why not a separate `frontend/` folder?**
> Separate frontend/backend folders are used when the frontend has its own
> build step (e.g. React or Vue with Vite). This dashboard is plain HTML + JS,
> so Express just serves `public/` as static files — no build step needed.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- Your laptop connected to the **same network** as the robots and GameController

## Install & run

```bash
cd robocup-gui
npm install
npm start
```

Then open **http://localhost:8080** in your browser.

If your team ID is not 55:

```bash
node server.js <team_id>
```

To test without real robots (demo mode):

```bash
node server.js --demo
```

Demo mode injects 3 moving robots, a live countdown timer, scores, and a penalty so every panel is populated. Flags can be combined: `node server.js 55 --demo`

## What it displays

| Panel | Data |
|---|---|
| Score bar | Both team scores, live from GameController |
| Info bar | Game state, phase, half, time remaining, set play, kicking team |
| Field canvas | Robot positions + heading arrows, ball position (orange) |
| Robot cards | Pose (m, °), localisation confidence, zone, ball info, role, chase/goalie score |
| Penalties | Any penalised player with reason and countdown |

## UDP ports (receive only)

| Port | Source | Content |
|---|---|---|
| `3838` | GameController broadcast | Game state (score, phase, time, penalties) |
| `3738` | GameController re-broadcast | Robot status: exact pose (x, y, θ) and ball position |
| `10000 + team_id` | Robot-to-robot team comms | Confidence, zone, role, chase/goalie scores |

## Competition legality

This tool is a **passive monitor** — it never sends data to the robots.

- Port `3838` and `10000+teamId` are standard network broadcasts that any device
  on the network receives.
- Port `3738` is a monitoring feed the GameController already provides for
  exactly this purpose (the `StatusMessageForwarder` in the official GC).
- The HSL rule against "manual interaction via communications mechanism" targets
  sending commands to robots, not passive monitoring.

Confirm with your TC before the match if in doubt.

## Troubleshooting

**No robot data appearing**
- Make sure your laptop is on the same subnet as the robots (e.g. `192.168.0.x`).
- Check Windows Firewall is not blocking UDP on ports 3838, 3738, and 10055.

**Positions look wrong**
- Verify `team_id` matches `team_id` in `robocup_demo/src/brain/config/config.yaml` (default: 55).

**Port already in use**
- Another process is using port 8080. Change `WEB_PORT` at the top of `server.js`.
