// PM2 process list for the VPS. The frontend is a static build served by
// nginx (see deploy/nginx.conf) — only the API is a long-running process.
// Secrets stay out of this file: server.js loads them from backend/.env
// (dotenv), same as `npm run dev` already does.
//
//   pm2 start ecosystem.config.cjs --env production
//   pm2 save && pm2 startup        # survive a reboot — pm2 startup prints a command, run it once
//   pm2 reload flowxp-api          # zero-downtime: server.js finishes in-flight requests on SIGTERM
//   pm2 logs flowxp-api
module.exports = {
  apps: [
    {
      name: 'flowxp-api',
      script: 'server.js',
      cwd: 'backend',
      exec_mode: 'fork',
      instances: 1,               // the background worker (jobs.js) runs in this process; before
                                   // scaling to more instances, set WORKER_ENABLED=false on all but one
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      kill_timeout: 10000,        // give server.js's own SIGTERM handler time to finish in-flight requests
      time: true
    }
  ]
};
