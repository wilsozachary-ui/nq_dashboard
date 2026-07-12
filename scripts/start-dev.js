'use strict';

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const root = path.resolve(__dirname, '..');
const children = new Set();
let shuttingDown = false;

function launch(label, args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.on('exit', code => {
    children.delete(child);
    if (shuttingDown) return;
    if (code !== 0) console.error(`[cockpit] ${label} exited with code ${code}`);
    shutdown(code || 0);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach(child => child.kill());
  setTimeout(() => process.exit(code), 100);
}

function portAvailable(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

async function main() {
  if (await portAvailable(5000)) {
    launch('backend', ['server.js'], path.join(root, 'backend'), process.env);
  }
  else console.log('[cockpit] Backend already available on port 5000; reusing it.');

  if (await portAvailable(3000)) launch('frontend', [path.join(root, 'node_modules', 'react-scripts', 'bin', 'react-scripts.js'), 'start'], root);
  else console.log('[cockpit] Frontend already available on port 3000; reusing it.');
}

main().catch(error => { console.error('[cockpit] Startup failed:', error); shutdown(1); });

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
