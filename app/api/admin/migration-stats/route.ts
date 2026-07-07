import { NextResponse } from "next/server"
import prisma from '@/lib/prisma'
import * as fs from "fs"
import * as path from "path"


export async function GET() {
  try {
    const [
      generatedTotal,
      generatedBlob,
      trainingTotal,
      trainingBlob,
      carouselTotal,
      carouselBlob,
    ] = await Promise.all([
      prisma.generatedImage.count({ where: { isDeleted: false } }),
      prisma.generatedImage.count({ where: { isDeleted: false, imageUrl: { contains: "vercel-storage" } } }),
      prisma.generationTrainingData.count(),
      prisma.generationTrainingData.count({ where: { imageUrl: { contains: "vercel-storage" } } }),
      prisma.carouselImage.count(),
      prisma.carouselImage.count({ where: { imageUrl: { contains: "vercel-storage" } } }),
    ])

    const errorLogPath = path.join(process.cwd(), "scripts", "migrate-errors.log")
    let errorCount = 0
    try {
      const log = fs.readFileSync(errorLogPath, "utf8")
      errorCount = log.split("\n").filter(l => l.trim().length > 0).length
    } catch {
      // no log file yet
    }

    return NextResponse.json({
      generatedImage:  { total: generatedTotal,  blob: generatedBlob,  r2: generatedTotal - generatedBlob },
      trainingData:    { total: trainingTotal,    blob: trainingBlob,   r2: trainingTotal - trainingBlob },
      carouselImage:   { total: carouselTotal,    blob: carouselBlob,   r2: carouselTotal - carouselBlob },
      overall: {
        total: generatedTotal + trainingTotal + carouselTotal,
        blob:  generatedBlob  + trainingBlob  + carouselBlob,
        r2:    (generatedTotal - generatedBlob) + (trainingTotal - trainingBlob) + (carouselTotal - carouselBlob),
      },
      errorCount,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
