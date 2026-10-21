import { spawn } from 'node:child_process';

const production = process.argv.includes('--production');
const processes = [
  spawn('node_modules/.bin/wrangler', ['dev', '--assets', './public', '--ip', '127.0.0.1', '--port', '8787'], { stdio: 'inherit' }),
  spawn('node_modules/.bin/next', [production ? 'start' : 'dev', '--hostname', '127.0.0.1'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  processes.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
processes.forEach((child) => {
  child.on('error', (error) => { console.error(error); stop(1); });
  child.on('exit', (code) => stop(code ?? 1));
});
