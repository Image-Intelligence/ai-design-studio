import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';


// GET: Fetch all active products
export async function GET() {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(products);
  } catch (error) {
    console.error("GET products error:", error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

// POST: Create a new product (admin only)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newProduct = await prisma.product.create({
      data: {
        name: body.name,
        description: body.description,
        price: parseFloat(body.price),
        imageUrl: body.imageUrl,
        category: body.category || "digital",
        stock: parseInt(body.stock) || 0,
        isActive: body.isActive ?? true,
        productType: body.productType || "regular",
        slotPosition: body.slotPosition ? parseInt(body.slotPosition) : null,
        isSlotActive: body.isSlotActive ?? false,
      },
    });
    return NextResponse.json(newProduct);
  } catch (error) {
    console.error("POST product error:", error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}

// PUT: Update a product (admin only)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updatedProduct = await prisma.product.update({
      where: { id: body.id },
      data: {
        name: body.name,
        description: body.description,
        price: parseFloat(body.price),
        imageUrl: body.imageUrl,
        category: body.category,
        stock: parseInt(body.stock),
        isActive: body.isActive,
        productType: body.productType,
        slotPosition: body.slotPosition ? parseInt(body.slotPosition) : null,
        isSlotActive: body.isSlotActive,
      },
    });
    return NextResponse.json(updatedProduct);
  } catch (error) {
    console.error("PUT product error:", error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

// DELETE: Delete a product (admin only)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Product ID required' }, { status: 400 });
    }

    await prisma.product.delete({
      where: { id: parseInt(id) },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE product error:", error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}
