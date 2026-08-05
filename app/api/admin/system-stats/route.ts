import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import os from 'os'
import { checkAuth } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Live PC stats for the Local-mode monitor in the custom flux panel.
// Only meaningful when the Next.js server runs on the user's own machine
// (local dev) — on Vercel there is no GPU and the numbers are the container's.

// CPU usage is a delta between polls: os.cpus() counters are cumulative since
// boot, so the first request after server start returns cpu: null.
let _lastCpu: { idle: number; total: number } | null = null

function cpuPercent(): number | null {
  const cpus = os.cpus()
  let idle = 0, total = 0
  for (const c of cpus) {
    idle  += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
  }
  const prev = _lastCpu
  _lastCpu = { idle, total }
  if (!prev || total <= prev.total) return null
  const dTotal = total - prev.total
  const dIdle  = idle - prev.idle
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)))
}

function queryGpu(): Promise<{ util: number; vramUsed: number; vramTotal: number; temp: number; power: number | null } | null> {
  return new Promise(resolve => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null)
        const [util, used, total, temp, power] = stdout.trim().split('\n')[0].split(',').map(s => parseFloat(s.trim()))
        if ([util, used, total, temp].some(isNaN)) return resolve(null)
        resolve({ util, vramUsed: used, vramTotal: total, temp, power: isNaN(power) ? null : power })
      },
    )
  })
}

export async function GET(req: Request) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gpu = await queryGpu()
  return NextResponse.json({
    cpu: cpuPercent(),
    ram: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
    gpu, // null when nvidia-smi is unavailable (e.g. running on Vercel)
  })
}
