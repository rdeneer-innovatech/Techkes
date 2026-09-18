const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [require('node:path').resolve(__dirname, 'inv-probe.js')],
  { stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 0; });
