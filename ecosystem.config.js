// PM2 process definition for the Link signaling server.
//
// Why this file exists: prior to this, `snapdrop` was started ad hoc via
// `PORT=3032 pm2 start server/index.js --name snapdrop`. That works, but it means
// there's no single source of truth for how the process should be (re)started —
// which is how we ended up running a 4-day-stale build after several rounds of
// server/index.js edits (public device directory, friend invites, etc. were
// silently not loaded because nothing told PM2 to restart).
//
// `watch: false` is deliberate, not an oversight: fs-watch-triggered restarts
// would restart mid-edit / mid multi-file-save and are noisy for a signaling
// server holding live WebSocket connections. Instead, restarts are driven
// explicitly by the `post-merge` git hook (see .git/hooks/post-merge), which
// fires once, after a `git pull` actually lands new code — restart-on-deploy,
// not restart-on-save.
module.exports = {
  apps: [
    {
      name: 'snapdrop',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        PORT: 3032,
      },
      watch: false,
      autorestart: true,
    },
  ],
};
