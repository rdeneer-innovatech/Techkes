// Prompt: create a working Electron app.
// Reason: IDE terminals can inherit ELECTRON_RUN_AS_NODE, which prevents
// Electron from starting as a desktop application.
const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.resolve(__dirname, '..')], {
  // Prompt: make the Electron front end appear when F5 starts the wrapper.
  // Reason: do not suppress a GUI process while VS Code owns the debug terminal.
  stdio: 'inherit', env
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
// Prompt: use the DeepSeek tool to fix issues for this chat session.
// Reason: stopping Electron with a signal is intentional and must not make F5
// report the browser launch as a failure.
child.on('exit', (code, signal) => { process.exitCode = signal ? 0 : (code ?? 1); });
