// app/api/upload-audio/route.ts
// Upload audio files to Vercel Blob storage

import { uploadToR2 } from '@/lib/r2';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';
import { requireIdVerified } from '@/lib/id-verification'

export async function POST(req: NextRequest) {
  try {
    // Signed in (it took anonymous uploads before) and ID-verified (CCBill;
    // admins exempt - lib/id-verification)
    const token = (await cookies()).get('session')?.value;
    const user = token ? await getUserFromSession(token) : null;
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const idGate = await requireIdVerified(user);
    if (idGate) return idGate;

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type (WAV or MP3)
    if (!file.type.includes('audio/wav') && !file.type.includes('audio/mp3') && !file.type.includes('audio/mpeg')) {
      return NextResponse.json(
        { error: 'Invalid file type. Only WAV and MP3 files are allowed.' },
        { status: 400 }
      );
    }

    // Validate file size (max 15MB)
    const maxSize = 15 * 1024 * 1024; // 15MB in bytes
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 15MB.' },
        { status: 400 }
      );
    }

    // Upload to R2
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(`audio-${Date.now()}-${file.name}`, buffer, file.type);

    return NextResponse.json({
      success: true,
      url
    });
  } catch (error) {
    console.error('Failed to upload audio file:', error);
    return NextResponse.json(
      { error: 'Failed to upload audio file' },
      { status: 500 }
    );
  }
}
