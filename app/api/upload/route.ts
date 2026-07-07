import { NextResponse } from 'next/server';
import { uploadToR2, deleteFromR2 } from '@/lib/r2';
import { cookies } from 'next/headers';
import { getUserFromSession } from '@/lib/auth';

async function requireSession() {
  const token = (await cookies()).get('session')?.value;
  return token ? await getUserFromSession(token) : null;
}

export async function POST(request: Request) {
  try {
    if (!(await requireSession())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    console.log('Upload request received:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Only images allowed.' }, { status: 400 });
    }

    // Validate file size (max 50MB - increased from 10MB)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ 
        error: `File too large. Max ${MAX_SIZE / (1024 * 1024)}MB.`,
        details: `Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`
      }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `galleries/${timestamp}-${safeName}`;

    const imageUrl = await uploadToR2(key, buffer, file.type);
    console.log('R2 upload successful:', imageUrl);

    return NextResponse.json({
      success: true,
      imageUrl,
      filename: file.name,
      storage: 'r2'
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ 
      error: 'Upload failed', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// DELETE endpoint to remove uploaded images
export async function DELETE(request: Request) {
  try {
    // Previously anonymous — anyone could delete ANY R2 object by URL. Require a session.
    if (!(await requireSession())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('imageUrl');
    
    if (!imageUrl) {
      return NextResponse.json({ error: 'No imageUrl provided' }, { status: 400 });
    }

    console.log('Delete request for:', imageUrl);
    await deleteFromR2(imageUrl);
    console.log('R2 delete successful');
    return NextResponse.json({ success: true, storage: 'r2' });

  } catch (error: any) {
    console.error('Delete error:', error);
    return NextResponse.json({ 
      error: 'Delete failed', 
      details: error.message 
    }, { status: 500 });
  }
}

