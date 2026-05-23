import { NextResponse } from 'next/server'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import http from 'http'

const PORT = 8766
let serverProcess: ChildProcess | null = null

function checkAuth(req: Request) {
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return true
  return req.headers.get('x-admin-password') === pass
}

function ping(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/health`, res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const running = await ping()
  return NextResponse.json({ running, pid: serverProcess?.pid ?? null })
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await ping()) return NextResponse.json({ started: false, message: 'Already running' })

  const candidates = [
    path.join(process.cwd(), 'AI', 'Real-ESRGAN', 'venv', 'Scripts', 'python.exe'),
    path.join(process.cwd(), 'AI', 'upscaler-venv', 'Scripts', 'python.exe'),
    path.join(process.cwd(), 'AI', 'upscaler-venv', 'bin', 'python'),
    path.join(process.cwd(), 'AI', 'OneTrainer', 'OneTrainer', 'venv', 'Scripts', 'python.exe'),
    'C:\\Users\\Owner\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    'python',
    'python3',
  ]

  let pythonExe = 'python'
  for (const c of candidates) {
    if (c === 'python' || c === 'python3' || fs.existsSync(c)) {
      pythonExe = c
      break
    }
  }

  const serverScript = path.join(process.cwd(), 'AI', 'upscaler-server.py')

  serverProcess = spawn(pythonExe, [serverScript], {
    stdio: 'pipe',
    cwd: path.join(process.cwd(), 'AI'),
  })

  serverProcess.on('exit', () => { serverProcess = null })
  serverProcess.stderr?.on('data', () => {})

  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await ping()) return NextResponse.json({ started: true, pid: serverProcess?.pid ?? null })
  }

  return NextResponse.json({ started: false, message: 'Server did not respond in time' }, { status: 500 })
}

async function killByPort(): Promise<void> {
  const { execSync } = await import('child_process')
  try {
    const out = execSync(`netstat -ano | findstr ":${PORT}"`, { encoding: 'utf8' })
    const pids = [...new Set(
      out.split('\n')
        .map(line => line.trim().split(/\s+/).pop() ?? '')
        .filter(pid => /^\d+$/.test(pid) && pid !== '0')
    )]
    if (pids.length > 0) {
      execSync(`taskkill /F ${pids.map(p => `/PID ${p}`).join(' ')}`, { encoding: 'utf8' })
    }
  } catch {}
}

export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Graceful shutdown request (works on new server instances that have /shutdown)
  try {
    await fetch(`http://localhost:${PORT}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    })
  } catch {}

  // 2. Kill our tracked child process if we have the reference
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
    serverProcess = null
  }

  // 3. Give graceful exit a moment
  await new Promise(r => setTimeout(r, 600))

  // 4. Still up? Force-kill by port (catches old/unmanaged instances)
  if (await ping()) {
    await killByPort()
  }

  // 5. Wait for port to clear
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300))
    if (!(await ping())) return NextResponse.json({ stopped: true })
  }

  return NextResponse.json({ stopped: false, message: 'Process did not exit in time' })
}
