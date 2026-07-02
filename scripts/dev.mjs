import { spawn } from 'node:child_process'

const processes = [
  spawn('python3', ['backend/run.py'], {
    stdio: 'inherit',
  }),
  spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], {
    stdio: 'inherit',
  }),
]

let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const childProcess of processes) {
    if (!childProcess.killed) {
      childProcess.kill('SIGINT')
    }
  }

  setTimeout(() => process.exit(code), 250)
}

for (const childProcess of processes) {
  childProcess.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown(code)
    }
  })
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
