// pm-stop.ts -- send shutdown command to the running process-manager
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';

const sockPath = path.join(os.homedir(), '.mentiko-pm', 'pm.sock');
const req = JSON.stringify({ id: '1', cmd: 'shutdown', data: {} }) + '\n';

const conn = net.createConnection(sockPath, () => {
  conn.write(req);
});

conn.on('data', (d) => {
  try {
    const res = JSON.parse(d.toString().trim());
    if (res.ok) { process.stdout.write('stopping mentiko...\n'); }
    else { process.stderr.write(`error: ${res.error}\n`); process.exit(1); }
  } catch {}
  conn.destroy();
});

conn.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
    process.stderr.write('mentiko is not running\n');
  } else {
    process.stderr.write(`error: ${e.message}\n`);
  }
  process.exit(1);
});

conn.on('close', () => process.exit(0));

setTimeout(() => {
  process.stderr.write('timeout waiting for response\n');
  process.exit(1);
}, 3000);
