import { NextResponse } from 'next/server'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import http from 'http'
import { checkAuth } from '@/lib/admin-auth'

let serverProcess: ChildProcess | null = null


function ping(): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get('http://localhost:8765/health', res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

// GET — check server status
export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const running = await ping()
  return NextResponse.json({
    running,
    pid: serverProcess?.pid ?? null,
  })
}

// POST — start the server
export async function POST(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (await ping()) {
    return NextResponse.json({ started: false, message: 'Already running' })
  }

  const pythonExe    = path.join(process.cwd(), 'AI', 'OneTrainer', 'OneTrainer', 'venv', 'Scripts', 'python.exe')
  const serverScript = path.join(process.cwd(), 'AI', 'onetrainer-server.py')

  serverProcess = spawn(pythonExe, [serverScript], {
    stdio: 'pipe',
    cwd: process.cwd(),
  })

  serverProcess.on('exit', () => { serverProcess = null })
  serverProcess.stderr?.on('data', () => {})  // prevent pipe backpressure

  // Poll for ready — up to 8 seconds
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await ping()) {
      return NextResponse.json({ started: true, pid: serverProcess?.pid ?? null })
    }
  }

  return NextResponse.json({ started: false, message: 'Server did not respond in time' }, { status: 500 })
}

// DELETE — stop the server
export async function DELETE(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
    serverProcess = null
    return NextResponse.json({ stopped: true })
  }
  return NextResponse.json({ stopped: false, message: 'No managed process found' })
}
