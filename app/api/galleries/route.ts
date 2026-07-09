import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkAuth } from '@/lib/admin-auth'


// GET: Fetch galleries
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const featured = searchParams.get('featured');

    if (id) {
      // Get single gallery with images
      const gallery = await prisma.gallery.findUnique({
        where: { id: parseInt(id) },
        include: {
          images: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      if (!gallery) {
        return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
      }

      return NextResponse.json(gallery);
    }

    // Get all galleries or featured only
    const where = featured === 'true' 
      ? { isActive: true, isFeatured: true }
      : { isActive: true };

    const galleries = await prisma.gallery.findMany({
      where,
      include: {
        images: {
          orderBy: { sortOrder: 'asc' },
          take: 1 // Just get first image for thumbnail
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(galleries);

  } catch (error) {
    console.error('GET galleries error:', error);
    return NextResponse.json({ error: 'Failed to fetch galleries' }, { status: 500 });
  }
}

// POST: Create new gallery
export async function POST(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json();

    const { title, description, coverImageUrl, price, isFeatured, loreIntro, loreOutro, accessType, images } = body;

    if (!title || !description || !coverImageUrl || price === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const gallery = await prisma.gallery.create({
      data: {
        title,
        description,
        coverImageUrl,
        price: parseFloat(price.toString()),
        isFeatured: isFeatured || false,
        loreIntro: loreIntro || null,
        loreOutro: loreOutro || null,
        accessType: accessType || 'purchase',
        images: {
          create: (images || []).map((img: any, index: number) => ({
            imageUrl: img.imageUrl,
            caption: img.caption || null,
            sortOrder: img.sortOrder !== undefined ? img.sortOrder : index
          }))
        }
      },
      include: {
        images: true
      }
    });

    return NextResponse.json(gallery);

  } catch (error) {
    console.error('POST gallery error:', error);
    return NextResponse.json({ error: 'Failed to create gallery' }, { status: 500 });
  }
}

// PUT: Update gallery
export async function PUT(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json();
    const { id, title, description, coverImageUrl, price, isActive, isFeatured, loreIntro, loreOutro, accessType, images } = body;

    if (!id) {
      return NextResponse.json({ error: 'Gallery ID required' }, { status: 400 });
    }

    // If images are provided, delete existing ones and create new ones
    const updateData: any = {
      title,
      description,
      coverImageUrl,
      price: price !== undefined ? parseFloat(price.toString()) : undefined,
      isActive,
      isFeatured,
      loreIntro,
      loreOutro,
      accessType
    };

    if (images) {
      // Delete existing images first
      await prisma.galleryImage.deleteMany({
        where: { galleryId: id }
      });

      // Create new images
      updateData.images = {
        create: images.map((img: any, index: number) => ({
          imageUrl: img.imageUrl,
          caption: img.caption || null,
          sortOrder: img.sortOrder !== undefined ? img.sortOrder : index
        }))
      };
    }

    const gallery = await prisma.gallery.update({
      where: { id },
      data: updateData,
      include: {
        images: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    return NextResponse.json(gallery);

  } catch (error) {
    console.error('PUT gallery error:', error);
    return NextResponse.json({ error: 'Failed to update gallery' }, { status: 500 });
  }
}

// DELETE: Delete gallery
export async function DELETE(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Gallery ID required' }, { status: 400 });
    }

    // Images will be cascade deleted due to schema
    await prisma.gallery.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('DELETE gallery error:', error);
    return NextResponse.json({ error: 'Failed to delete gallery' }, { status: 500 });
  }
}
