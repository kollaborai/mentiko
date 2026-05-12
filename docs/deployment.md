# deployment guide

how to deploy and distribute mentiko.

---

publishing to npm

prerequisites:
  - npm account (npmjs.com)
  - npm token with automation/publish permissions
  - owner access to mentiko package

version bump:
  # edit package.json version
  npm version patch  # or minor/major

publish:
  npm publish --access public

  # prepublishOnly runs tests automatically
  # postinstall installs web/ dependencies for users

verify:
  npm view mentiko
  npm install -g mentiko@latest

---

github releases

creating a release:
  1. bump version in package.json
  2. commit: "v0.x.y"
  3. git tag -a v0.x.y -m "v0.x.y"
  4. git push origin v0.x.y
  5. github -> releases -> draft new release
  6. select tag, auto-generate release notes
  7. publish

changelog format:
  ## [0.x.y] - 2025-XX-XX
  added:   new features
  fixed:   bug fixes
  changed: breaking changes

---

web ui deployment

local:
  cd web && npm install && npm run dev
  # runs on http://localhost:3000

production build:
  cd web
  npm install
  npm run build    # creates .next/
  npm start        # serves built app

vercel (recommended):
  1. connect github repo in vercel dashboard
  2. root directory: web
  3. build command: npm install && npm run build
  4. start command: npm start
  5. add env vars (see environment section)
  6. deploy

  note: api routes work. agent cli requires custom server with pty-manager.

render/railway (full agent support):
  build:  cd web && npm install && npm run build
  start:  npm start
  env:    BETTER_AUTH_SECRET, BETTER_AUTH_URL, WEB_PORT, AGENT_CHAIN_CLI

docker:

  FROM node:18-bullseye
  RUN apt-get update && apt-get install -y jq
  WORKDIR /app
  COPY package*.json ./
  COPY web/package*.json web/
  RUN npm install && cd web && npm install
  COPY . .
  RUN cd web && npm run build
  EXPOSE 3000
  CMD ["npm", "start"]

---

cli installation

users install via npm:
  npm install -g mentiko

  # bin/mentiko is now in PATH
  mentiko list
  mentiko run <chain-name>

what gets installed:
  - bin/mentiko       (cli entry point)
  - lib/             (orchestration scripts)
  - examples/        (sample chains)
  - docs/            (documentation)
  - web/             (ui source, deps via postinstall)

---

environment variables

core:
  BETTER_AUTH_SECRET=generated-secret # required in production
  BETTER_AUTH_URL=https://mentiko.example.com
  DATABASE_URL=postgresql://user:pass@host:5432/mentiko
  WEB_PORT=3000              # web ui port
  NODE_ENV=production

agent behavior:
  MENTIKO_CLI=claude         # default ai gateway (claude, glm, aider)
  DEFAULT_MAX_ROUNDS=50      # agent iteration limit
  MAX_CONCURRENT_AGENTS=10   # concurrency cap

paths (optional, defaults shown):
  MENTIKO_ROOT=/opt/mentiko
  CHAIN_DIR=$MENTIKO_ROOT/chains
  STATE_DIR=$MENTIKO_ROOT/agents/state
  EVENTS_DIR=$MENTIKO_ROOT/agents/events

integrations (optional):
  GITHUB_TOKEN=<github-token>       # for github issues
  GITHUB_OWNER=your-org
  GITHUB_REPO=your-repo
  SLACK_WEBHOOK_URL=<slack-webhook-url>
  TEAMS_WEBHOOK_URL=https://your-org.webhook.office.com/...
  CHAIN_EMAIL_TO=alerts@example.com # email notifications
  CHAIN_EMAIL_FROM=mentiko@example.com
  CHAIN_EMAIL_SMTP=smtp.gmail.com:587

multi-namespace (optional):
  NAMESPACE_ID=production              # isolates chains per namespace

---

production checklist

security:
  [ ] set `BETTER_AUTH_SECRET`
  [ ] set `BETTER_AUTH_URL` to production domain
  [ ] use https (ssl/tls)
  [ ] rotate credentials regularly
  [ ] use secrets manager for tokens
  [ ] restrict firewall to necessary ports

performance:
  [ ] enable process manager (pm2/systemd)
  [ ] setup reverse proxy (nginx/caddy)
  [ ] configure log rotation
  [ ] monitor resource usage

monitoring:
  [ ] health check: /api/health
  [ ] audit logs: /api/audit
  [ ] error tracking (sentry)

systemd service example:

  [Unit]
  Description=Mentiko
  After=network.target

  [Service]
  Type=simple
  User=mentiko
  WorkingDirectory=/opt/mentiko
  Environment="NODE_ENV=production"
  Environment="BETTER_AUTH_SECRET=..."
  Environment="BETTER_AUTH_URL=https://mentiko.example.com"
  ExecStart=/usr/bin/npm start
  Restart=always
  RestartSec=10

  [Install]
  WantedBy=multi-user.target

  enable: sudo systemctl enable mentiko
  start:  sudo systemctl start mentiko
  status: sudo systemctl status mentiko

---

nginx reverse proxy

  upstream mentiko {
    server localhost:3000;
  }

  server {
    listen 80;
    server_name mentiko.example.com;

    location / {
      proxy_pass http://mentiko;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_cache_bypass $http_upgrade;
      proxy_read_timeout 300s;
    }

    # websocket support
    location /api/events/stream {
      proxy_pass http://mentiko;
      proxy_buffering off;
      proxy_cache off;
      proxy_set_header Connection '';
      proxy_http_version 1.1;
      chunked_transfer_encoding off;
    }
  }

  ssl with certbot:
    sudo apt install -y certbot python3-certbot-nginx
    sudo certbot --nginx -d mentiko.example.com

---

troubleshooting

port in use:
  lsof -i :3000
  kill -9 <pid>

agents not launching:
  - verify pty-manager running: bin/p list
  - check AGENT_CHAIN_CLI points to valid binary
  - test manually: ./bin/mentiko list

web ui issues:
  - check .next/ exists (ran npm run build)
  - verify node_modules/ installed
  - check port conflicts

orphaned pty sessions:
  bin/p list           # list active sessions
  bin/p destroy <name>  # kill specific session
  # kill all: ./bin/mentiko kill-all

logs:
  journalctl -u mentiko -f
  pm2 logs mentiko
