import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'

const backendUrl = 'http://127.0.0.1:5001/api/health'
const frontendPort = 5173
const processes = []

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

function trackProcess(childProcess) {
  processes.push(childProcess)

  childProcess.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code || 1)
    }
  })
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, 'localhost')
  })
}

function waitForBackend(childProcess) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timeoutMs = 15000
    let finished = false

    const finish = (callback, value) => {
      if (finished) return
      finished = true
      childProcess.off('exit', onExit)
      callback(value)
    }

    const onExit = (code) => {
      finish(reject, new Error(`Backend exited before it was ready (code ${code ?? 0})`))
    }

    const check = () => {
      if (finished) return

      const request = http.get(backendUrl, (response) => {
        response.resume()

        if (response.statusCode === 200) {
          finish(resolve)
          return
        }

        retry()
      })

      request.on('error', retry)
      request.setTimeout(1000, () => {
        request.destroy()
        retry()
      })
    }

    const retry = () => {
      if (finished) return

      if (Date.now() - startedAt > timeoutMs) {
        finish(reject, new Error('Backend did not become ready in time'))
        return
      }

      setTimeout(check, 200)
    }

    childProcess.once('exit', onExit)
    setTimeout(check, 200)
  })
}

if (!(await checkPortAvailable(frontendPort))) {
  console.error(
    `Frontend port ${frontendPort} is already in use. Stop the old dev server and run npm run dev again.`,
  )
  process.exit(1)
}

const backend = spawn('python3', ['backend/run.py'], {
  env: {
    ...process.env,
    FLASK_ENV: process.env.FLASK_ENV ?? 'development',
    WORDBEE_ENABLE_DEV_FALLBACK: process.env.WORDBEE_ENABLE_DEV_FALLBACK ?? '1',
  },
  stdio: 'inherit',
})
trackProcess(backend)

try {
  await waitForBackend(backend)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend did not become ready')
  shutdown(1)
}

if (!shuttingDown) {
  const frontend = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], {
    stdio: 'inherit',
  })
  trackProcess(frontend)
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
