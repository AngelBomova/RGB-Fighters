import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const viteCommand = isWindows ? 'node_modules\\.bin\\vite.cmd' : './node_modules/.bin/vite';
const children = [];
let shuttingDown = false;

function run(name, command, args) {
  const child = isWindows && command.endsWith('.cmd')
    ? spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], {
      stdio: 'inherit',
      shell: false,
      cwd: process.cwd(),
      env: process.env,
    })
    : spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    cwd: process.cwd(),
    env: process.env,
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    children.forEach((processChild) => {
      if (processChild !== child && !processChild.killed) processChild.kill();
    });
    if (code !== 0 && signal !== 'SIGINT') {
      console.error(`${name} stopped unexpectedly.`);
      process.exit(code ?? 1);
    }
    process.exit(0);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

run('server', 'node', ['server/index.js']);
run('client', viteCommand, []);
