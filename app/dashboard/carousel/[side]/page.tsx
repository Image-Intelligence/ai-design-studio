"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Upload, Trash2, GripVertical, Image as ImageIcon, X } from "lucide-react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { IdVerificationHost, gateFileInput } from "@/components/id-verification/IdVerificationGate"

interface CarouselImage {
  id: number
  imageUrl: string
  side: string
  position: number
}

export default function CarouselCustomizePage() {
  const router = useRouter()
  const params = useParams()
  const side = params.side as string

  const [loading, setLoading] = useState(true)
  const [images, setImages] = useState<CarouselImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // Validate side parameter
  useEffect(() => {
    if (side !== 'left' && side !== 'right') {
      router.push('/dashboard')
    }
  }, [side, router])

  useEffect(() => {
    checkAuthAndFetch()
  }, [])

  const checkAuthAndFetch = async () => {
    try {
      const res = await fetch('/api/auth/session')
      const data = await res.json()

      if (!data.authenticated) {
        router.push('/login')
        return
      }

      fetchImages()
    } catch (error) {
      console.error('Auth check failed:', error)
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const fetchImages = async () => {
    try {
      const res = await fetch('/api/user/carousel')
      const data = await res.json()

      if (data.success) {
        const sideImages = data.images
          .filter((img: CarouselImage) => img.side === side)
          .sort((a: CarouselImage, b: CarouselImage) => a.position - b.position)
        setImages(sideImages)
      }
    } catch (error) {
      console.error('Failed to fetch images:', error)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    if (images.length >= 5) {
      alert('Maximum 5 images allowed per carousel')
      return
    }

    setUploading(true)

    try {
      for (let i = 0; i < Math.min(files.length, 5 - images.length); i++) {
        const formData = new FormData()
        formData.append('image', files[i])
        formData.append('side', side)
        formData.append('position', String(images.length + i))

        const res = await fetch('/api/user/carousel', {
          method: 'POST',
          body: formData
        })

        if (!res.ok) {
          const data = await res.json()
          alert('Upload failed: ' + data.error)
          break
        }
      }

      fetchImages()
    } catch (error: any) {
      alert('Upload failed: ' + error.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this image from your carousel?')) return

    try {
      const res = await fetch(`/api/user/carousel?id=${id}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        fetchImages()
      } else {
        const data = await res.json()
        alert('Delete failed: ' + data.error)
      }
    } catch (error: any) {
      alert('Delete failed: ' + error.message)
    }
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newImages = [...images]
    const draggedImage = newImages[draggedIndex]
    newImages.splice(draggedIndex, 1)
    newImages.splice(index, 0, draggedImage)

    // Update positions
    newImages.forEach((img, i) => {
      img.position = i
    })

    setImages(newImages)
    setDraggedIndex(index)
  }

  const handleDragEnd = async () => {
    setDraggedIndex(null)

    // Save new positions to backend
    try {
      for (const img of images) {
        await fetch('/api/user/carousel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: img.id, position: img.position })
        })
      }
    } catch (error) {
      console.error('Failed to update positions:', error)
      fetchImages() // Refresh on error
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050810] flex items-center justify-center">
        <div className="text-cyan-400 text-xl font-mono">LOADING...</div>
      </div>
    )
  }

  const sideColor = side === 'left' ? 'cyan' : 'fuchsia'
  const gradientFrom = side === 'left' ? 'from-cyan-500' : 'from-fuchsia-500'
  const gradientTo = side === 'left' ? 'to-blue-500' : 'to-pink-500'

  return (
    <div className="min-h-screen bg-[#050810] text-white relative overflow-hidden">
      {/* Carousel pictures are uploads: ID-verified accounts only (CCBill) */}
      <IdVerificationHost />
      {/* Background effects */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="fixed top-20 left-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
      <div className="fixed bottom-20 right-20 w-96 h-96 bg-fuchsia-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard">
            <Button variant="ghost" className="text-slate-400 hover:text-white mb-4">
              <ArrowLeft className="mr-2" size={20} />
              Back to Dashboard
            </Button>
          </Link>

          <h1 className={`text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${gradientFrom} ${gradientTo}`}>
            {side.toUpperCase()} CAROUSEL
          </h1>
          <p className="text-slate-400 text-sm mt-2">
            Customize your {side} carousel with up to 5 high-quality images
          </p>
        </div>

        {/* Upload Section */}
        <div className={`mb-8 p-6 rounded-2xl border-2 border-dashed border-${sideColor}-500/30 bg-slate-900/50 hover:border-${sideColor}-400/50 transition-colors`}>
          <input
            type="file" onClick={gateFileInput}
            accept="image/*"
            multiple
            onChange={handleUpload}
            disabled={uploading || images.length >= 5}
            className="hidden"
            id="carousel-upload"
          />
          <label
            htmlFor="carousel-upload"
            className={`flex flex-col items-center justify-center cursor-pointer ${images.length >= 5 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className={`w-16 h-16 mb-4 rounded-full bg-${sideColor}-500/10 flex items-center justify-center`}>
              <Upload size={28} className={`text-${sideColor}-400`} />
            </div>
            <p className={`text-${sideColor}-400 font-bold mb-1`}>
              {uploading ? 'Uploading...' : images.length >= 5 ? 'Maximum images reached' : 'Click to upload images'}
            </p>
            <p className="text-slate-500 text-sm">
              {images.length}/5 images • Supports JPG, PNG, WebP
            </p>
          </label>
        </div>

        {/* Images Grid */}
        {images.length === 0 ? (
          <div className="text-center py-16 border border-slate-800 rounded-2xl bg-slate-900/30">
            <ImageIcon className="mx-auto text-slate-700 mb-4" size={64} />
            <p className="text-xl font-bold text-slate-400 mb-2">No images yet</p>
            <p className="text-sm text-slate-600">Upload images above to customize your carousel</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-4">
              Drag to reorder • Images display in this order
            </p>
            {images.map((img, index) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-4 p-4 rounded-xl border-2 ${
                  draggedIndex === index
                    ? `border-${sideColor}-400 bg-${sideColor}-500/10`
                    : 'border-slate-700 bg-slate-900/80'
                } hover:border-slate-600 transition-all cursor-grab active:cursor-grabbing`}
              >
                {/* Drag Handle */}
                <div className="text-slate-600 hover:text-slate-400">
                  <GripVertical size={20} />
                </div>

                {/* Position Badge */}
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${gradientFrom} ${gradientTo} flex items-center justify-center font-black text-black text-sm`}>
                  {index + 1}
                </div>

                {/* Image Preview */}
                <div className="w-24 h-24 rounded-lg overflow-hidden border border-slate-700 flex-shrink-0">
                  <img
                    src={img.imageUrl}
                    alt={`Carousel image ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Image Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    Image {index + 1}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    Position {index + 1} of {images.length}
                  </p>
                </div>

                {/* Delete Button */}
                <Button
                  onClick={() => handleDelete(img.id)}
                  variant="ghost"
                  className="text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={18} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Preview Section */}
        {images.length > 0 && (
          <div className="mt-8 p-6 rounded-2xl border border-slate-700 bg-slate-900/50">
            <h3 className={`text-lg font-bold text-${sideColor}-400 mb-4`}>Preview</h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {images.map((img, index) => (
                <div
                  key={img.id}
                  className="relative flex-shrink-0 w-32 h-48 rounded-lg overflow-hidden border-2 border-slate-700"
                >
                  <img
                    src={img.imageUrl}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className={`absolute top-2 left-2 w-6 h-6 rounded bg-gradient-to-r ${gradientFrom} ${gradientTo} flex items-center justify-center font-bold text-black text-xs`}>
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              This is how your images will cycle in the carousel
            </p>
          </div>
        )}

        {/* Info Box */}
        <div className={`mt-8 p-4 rounded-xl bg-${sideColor}-500/10 border border-${sideColor}-500/30`}>
          <p className={`text-sm text-${sideColor}-400`}>
            Your carousel images will display on the {side} side of your dashboard. Images rotate automatically every 6 seconds. For best results, use high-quality 4K images with a vertical aspect ratio.
          </p>
        </div>
      </div>
    </div>
  )
}
