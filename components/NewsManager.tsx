"use client"

// Shared news & notifications manager — used by /admin/news (full page) and the
// portal-v2 News dropdown's admin modal (embedded). Handles article CRUD with the
// block-based content editor, plus hosts NotificationManager for notifications.
// All mutating requests send the x-admin-password header (the APIs require it).

import { useState, useEffect, useRef, useCallback } from "react"
import {
  ArrowLeft, FileText, Plus, Trash2, ChevronUp, ChevronDown,
  Save, Eye, EyeOff, Image as ImageIcon, Type, Minus, AlignLeft,
  Sparkles, Upload, Loader2,
  GripVertical, Hash, Quote, LayoutGrid, ExternalLink, Bell, Video
} from "lucide-react"
import { NotificationManager } from "@/components/NotificationManager"

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockType = 'heading' | 'text' | 'image' | 'video' | 'callout' | 'divider' | 'spacer'

export interface HeadingBlock  { id: string; type: 'heading';  level: 1 | 2 | 3; text: string }
export interface TextBlock     { id: string; type: 'text';     content: string; align?: 'left' | 'center' | 'right' }
export interface ImageBlock    { id: string; type: 'image';    url: string; alt?: string; caption?: string; size?: 'full' | 'half' | 'small' }
export interface VideoBlock    { id: string; type: 'video';    url: string; caption?: string; size?: 'full' | 'half' | 'small' }
export interface CalloutBlock  { id: string; type: 'callout';  content: string; style?: 'info' | 'warning' | 'success' | 'update' }
export interface DividerBlock  { id: string; type: 'divider' }
export interface SpacerBlock   { id: string; type: 'spacer';   size?: 'sm' | 'md' | 'lg' }

export type ContentBlock = HeadingBlock | TextBlock | ImageBlock | VideoBlock | CalloutBlock | DividerBlock | SpacerBlock

export interface NewsArticleFull {
  id: number
  title: string
  slug: string
  type: string
  summary: string
  previewImage: string | null
  content: ContentBlock[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  info:     { label: 'Info',     color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30'    },
  warning:  { label: 'Warning',  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  success:  { label: 'Update',   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  update:   { label: 'Patch',    color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30' },
  tutorial: { label: 'Tutorial', color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30'  },
} as const

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// The news APIs require the admin password for all=true reads and all mutations
function adminHeaders(): Record<string, string> {
  const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
  return pass ? { "x-admin-password": pass } : {}
}

// ─── Block Editor Components ──────────────────────────────────────────────────

function BlockWrapper({
  block, index, total,
  onMoveUp, onMoveDown, onDelete,
  children,
}: {
  block: ContentBlock
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  children: React.ReactNode
}) {
  const label = block.type.charAt(0).toUpperCase() + block.type.slice(1)
  return (
    <div className="group relative rounded-xl border border-white/8 bg-white/[0.02] hover:border-white/15 transition-colors">
      {/* Block controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <GripVertical size={12} className="text-slate-700" />
          <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/8 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 hover:bg-white/8 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={onDelete}
            className="w-6 h-6 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-red-500/8 transition-all"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function HeadingEditor({ block, onChange }: { block: HeadingBlock; onChange: (b: HeadingBlock) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {([1, 2, 3] as const).map(l => (
          <button
            key={l}
            onClick={() => onChange({ ...block, level: l })}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              block.level === l
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                : 'bg-white/5 border border-white/8 text-slate-500 hover:text-white'
            }`}
          >
            H{l}
          </button>
        ))}
      </div>
      <input
        value={block.text}
        onChange={e => onChange({ ...block, text: e.target.value })}
        placeholder={`Heading ${block.level} text…`}
        className={`w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 ${
          block.level === 1 ? 'text-xl font-bold' : block.level === 2 ? 'text-lg font-semibold' : 'text-base font-medium'
        }`}
      />
    </div>
  )
}

function TextEditor({ block, onChange }: { block: TextBlock; onChange: (b: TextBlock) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {(['left', 'center', 'right'] as const).map(a => (
          <button
            key={a}
            onClick={() => onChange({ ...block, align: a })}
            className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
              (block.align ?? 'left') === a
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                : 'bg-white/5 border border-white/8 text-slate-500 hover:text-white'
            }`}
          >
            {a.charAt(0).toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      <textarea
        value={block.content}
        onChange={e => onChange({ ...block, content: e.target.value })}
        placeholder="Paragraph text… Supports [link](url) syntax."
        rows={4}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 resize-y"
      />
    </div>
  )
}

function ImageEditor({
  block, onChange, onUpload, uploading,
}: {
  block: ImageBlock
  onChange: (b: ImageBlock) => void
  onUpload: (file: File, cb: (url: string) => void) => void
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={block.url}
          onChange={e => onChange({ ...block, url: e.target.value })}
          placeholder="Image URL or upload below…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/8 text-xs transition-all disabled:opacity-50"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onUpload(f, url => onChange({ ...block, url }))
            e.target.value = ''
          }}
        />
      </div>
      {block.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={block.url} alt={block.alt || ''} className="max-h-40 rounded-lg object-cover border border-white/10" />
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          value={block.alt || ''}
          onChange={e => onChange({ ...block, alt: e.target.value })}
          placeholder="Alt text"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
        />
        <input
          value={block.caption || ''}
          onChange={e => onChange({ ...block, caption: e.target.value })}
          placeholder="Caption (optional)"
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
        />
      </div>
      <div className="flex gap-2">
        {(['full', 'half', 'small'] as const).map(s => (
          <button
            key={s}
            onClick={() => onChange({ ...block, size: s })}
            className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
              (block.size ?? 'full') === s
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                : 'bg-white/5 border border-white/8 text-slate-500 hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="text-[10px] text-slate-600 self-center ml-1">size</span>
      </div>
    </div>
  )
}

function VideoEditor({
  block, onChange, onUpload, uploading,
}: {
  block: VideoBlock
  onChange: (b: VideoBlock) => void
  onUpload: (file: File, cb: (url: string) => void) => void
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={block.url}
          onChange={e => onChange({ ...block, url: e.target.value })}
          placeholder="Video URL or upload below…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/8 text-xs transition-all disabled:opacity-50"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onUpload(f, url => onChange({ ...block, url }))
            e.target.value = ''
          }}
        />
      </div>
      {block.url && (
        <video
          src={block.url}
          controls
          className="max-h-40 rounded-lg border border-white/10 w-full"
        />
      )}
      <input
        value={block.caption || ''}
        onChange={e => onChange({ ...block, caption: e.target.value })}
        placeholder="Caption (optional)"
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
      />
      <div className="flex gap-2">
        {(['full', 'half', 'small'] as const).map(s => (
          <button
            key={s}
            onClick={() => onChange({ ...block, size: s })}
            className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
              (block.size ?? 'full') === s
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                : 'bg-white/5 border border-white/8 text-slate-500 hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="text-[10px] text-slate-600 self-center ml-1">size</span>
      </div>
    </div>
  )
}

function CalloutEditor({ block, onChange }: { block: CalloutBlock; onChange: (b: CalloutBlock) => void }) {
  const styles = ['info', 'warning', 'success', 'update'] as const
  const STYLE_COLORS = {
    info:    'bg-cyan-500/20 border-cyan-500/40 text-cyan-300',
    warning: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    success: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    update:  'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300',
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {styles.map(s => (
          <button
            key={s}
            onClick={() => onChange({ ...block, style: s })}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
              (block.style ?? 'info') === s
                ? STYLE_COLORS[s]
                : 'bg-white/5 border-white/8 text-slate-500 hover:text-white'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <textarea
        value={block.content}
        onChange={e => onChange({ ...block, content: e.target.value })}
        placeholder="Callout text…"
        rows={3}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 resize-y"
      />
    </div>
  )
}

function SpacerEditor({ block, onChange }: { block: SpacerBlock; onChange: (b: SpacerBlock) => void }) {
  return (
    <div className="flex gap-2 items-center">
      <span className="text-xs text-slate-500">Size:</span>
      {(['sm', 'md', 'lg'] as const).map(s => (
        <button
          key={s}
          onClick={() => onChange({ ...block, size: s })}
          className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
            (block.size ?? 'md') === s
              ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
              : 'bg-white/5 border border-white/8 text-slate-500 hover:text-white'
          }`}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

// ─── Block Renderer (preview inline) ─────────────────────────────────────────

export function renderBlock(block: ContentBlock, key: string | number) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3'
      const cls = block.level === 1 ? 'text-2xl font-bold' : block.level === 2 ? 'text-xl font-semibold' : 'text-lg font-medium'
      return <Tag key={key} className={`text-white ${cls} leading-snug`}>{block.text || <span className="opacity-30 italic">Empty heading</span>}</Tag>
    }
    case 'text':
      return (
        <p key={key} className={`text-slate-300 text-sm leading-relaxed text-${block.align ?? 'left'}`}>
          {block.content || <span className="opacity-30 italic">Empty paragraph</span>}
        </p>
      )
    case 'image':
      return (
        <div key={key} className={`${block.size === 'half' ? 'max-w-xs' : block.size === 'small' ? 'max-w-[200px]' : 'w-full'}`}>
          {block.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={block.url} alt={block.alt || ''} className="rounded-xl w-full border border-white/10" />
            : <div className="h-24 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-slate-600 text-sm">No image</div>
          }
          {block.caption && <p className="text-xs text-slate-500 mt-1.5 text-center">{block.caption}</p>}
        </div>
      )
    case 'video':
      return (
        <div key={key} className={`${block.size === 'half' ? 'max-w-xs' : block.size === 'small' ? 'max-w-[200px]' : 'w-full'}`}>
          {block.url
            ? <video src={block.url} controls className="rounded-xl w-full border border-white/10" />
            : <div className="h-24 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-slate-600 text-sm gap-2"><Video size={16} />No video</div>
          }
          {block.caption && <p className="text-xs text-slate-500 mt-1.5 text-center">{block.caption}</p>}
        </div>
      )
    case 'callout': {
      const CALLOUT_STYLES = {
        info:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    text: 'text-cyan-300'    },
        warning: { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300'   },
        success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300' },
        update:  { bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30', text: 'text-fuchsia-300' },
      }
      const s = CALLOUT_STYLES[block.style ?? 'info']
      return (
        <div key={key} className={`rounded-xl border px-4 py-3 text-sm ${s.bg} ${s.border} ${s.text}`}>
          {block.content || <span className="opacity-50 italic">Empty callout</span>}
        </div>
      )
    }
    case 'divider':
      return <hr key={key} className="border-white/10" />
    case 'spacer':
      return <div key={key} className={block.size === 'sm' ? 'h-4' : block.size === 'lg' ? 'h-12' : 'h-8'} />
    default:
      return null
  }
}

// ─── News Manager (shared) ────────────────────────────────────────────────────

export function NewsManager({
  initialSection = 'articles',
  initialArticleId,
  embedded = false,
}: {
  initialSection?: 'articles' | 'notifications'
  initialArticleId?: number
  embedded?: boolean
}) {
  const [section, setSection] = useState<'articles' | 'notifications'>(initialSection)
  const [articles, setArticles] = useState<NewsArticleFull[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState<'info' | 'content' | 'preview'>('info')

  // Editor state
  const [editing, setEditing] = useState<NewsArticleFull | null>(null)
  const [isNew, setIsNew] = useState(false)

  // Editable fields
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [type, setType] = useState<string>("update")
  const [summary, setSummary] = useState("")
  const [previewImage, setPreviewImage] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const previewFileRef = useRef<HTMLInputElement>(null)
  const appliedInitialRef = useRef(false)

  // ── Fetch articles ────────────────────────────────────────────────────────

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/news?all=true', { headers: adminHeaders() })
      if (res.ok) setArticles(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchArticles() }, [fetchArticles])

  // Deep-link: open a specific article once the list has loaded
  useEffect(() => {
    if (appliedInitialRef.current || !initialArticleId || articles.length === 0) return
    const a = articles.find(x => x.id === initialArticleId)
    if (a) { loadArticle(a); appliedInitialRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, initialArticleId])

  // ── Editor helpers ────────────────────────────────────────────────────────

  function loadArticle(article: NewsArticleFull) {
    setEditing(article)
    setIsNew(false)
    setTitle(article.title)
    setSlug(article.slug)
    setSlugEdited(true)
    setType(article.type)
    setSummary(article.summary)
    setPreviewImage(article.previewImage || "")
    setIsActive(article.isActive)
    setBlocks(Array.isArray(article.content) ? article.content : [])
    setSaveError("")
    setTab('info')
  }

  function startNew() {
    setEditing(null)
    setIsNew(true)
    setTitle("")
    setSlug("")
    setSlugEdited(false)
    setType("update")
    setSummary("")
    setPreviewImage("")
    setIsActive(false)
    setBlocks([])
    setSaveError("")
    setTab('info')
  }

  function cancelEdit() {
    setEditing(null)
    setIsNew(false)
    setSaveError("")
  }

  function handleTitleChange(val: string) {
    setTitle(val)
    if (!slugEdited) setSlug(slugify(val))
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  function addBlock(type: BlockType) {
    let block: ContentBlock
    switch (type) {
      case 'heading':  block = { id: uid(), type: 'heading', level: 2, text: '' }; break
      case 'text':     block = { id: uid(), type: 'text', content: '', align: 'left' }; break
      case 'image':    block = { id: uid(), type: 'image', url: '', alt: '', caption: '', size: 'full' }; break
      case 'video':    block = { id: uid(), type: 'video', url: '', caption: '', size: 'full' }; break
      case 'callout':  block = { id: uid(), type: 'callout', content: '', style: 'info' }; break
      case 'divider':  block = { id: uid(), type: 'divider' }; break
      case 'spacer':   block = { id: uid(), type: 'spacer', size: 'md' }; break
    }
    setBlocks(prev => [...prev, block])
  }

  function updateBlock(idx: number, updated: ContentBlock) {
    setBlocks(prev => prev.map((b, i) => (i === idx ? updated : b)))
  }

  function deleteBlock(idx: number) {
    setBlocks(prev => prev.filter((_, i) => i !== idx))
  }

  function moveBlock(idx: number, dir: -1 | 1) {
    const next = [...blocks]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setBlocks(next)
  }

  // ── Image upload ──────────────────────────────────────────────────────────

  async function uploadImage(file: File, cb: (url: string) => void) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/news/upload', { method: 'POST', headers: adminHeaders(), body: fd })
      if (res.ok) {
        const { url } = await res.json()
        cb(url)
      } else {
        const { error } = await res.json()
        setSaveError(error || 'Upload failed')
      }
    } catch {
      setSaveError('Upload failed')
    }
    setUploading(false)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title.trim()) { setSaveError('Title is required'); return }
    if (!slug.trim())  { setSaveError('Slug is required'); return }
    setSaving(true)
    setSaveError("")
    try {
      const payload = { title, slug, type, summary, previewImage: previewImage || null, content: blocks, isActive }
      let res: Response
      if (isNew) {
        res = await fetch('/api/news', { method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(payload) })
      } else {
        res = await fetch('/api/news', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify({ id: editing!.id, ...payload }) })
      }
      // Read the body first before triggering any other state updates
      const data = await res.json()
      if (res.ok) {
        setIsNew(false)
        setEditing(data)
        setSlugEdited(true)
        await fetchArticles()
      } else {
        setSaveError(data?.error || 'Save failed')
      }
    } catch (err) {
      console.error('Save error:', err)
      setSaveError('Save failed — check console for details')
    }
    setSaving(false)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: number) {
    if (!confirm('Delete this article? This cannot be undone.')) return
    try {
      await fetch(`/api/news?id=${id}`, { method: 'DELETE', headers: adminHeaders() })
      if (editing?.id === id) cancelEdit()
      await fetchArticles()
    } catch {}
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  async function toggleActive(article: NewsArticleFull) {
    try {
      await fetch('/api/news', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ id: article.id, isActive: !article.isActive }),
      })
      await fetchArticles()
      if (editing?.id === article.id) setIsActive(!article.isActive)
    } catch {}
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const isEditing = isNew || editing !== null

  return (
    <div className={embedded ? "h-full bg-[#09090f]" : "min-h-screen bg-[#09090f]"}>
      {!embedded && (
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-fuchsia-500/[0.04] rounded-full blur-3xl pointer-events-none" />
      )}

      <div className={`relative z-10 flex ${embedded ? "h-full" : "h-screen"} overflow-hidden`}>

        {/* ── LEFT PANEL ───────────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-white/[0.07] flex flex-col">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2 mb-3">
              {!embedded && (
                <button
                  onClick={() => window.location.href = '/admin'}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-600 hover:text-white hover:bg-white/8 transition-all"
                >
                  <ArrowLeft size={14} />
                </button>
              )}
              <h1 className="text-sm font-bold text-white">News & Notifications</h1>
            </div>
            {/* Section toggle */}
            <div className="flex gap-1 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
              <button
                onClick={() => setSection('articles')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  section === 'articles' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <FileText size={11} />
                Articles
              </button>
              <button
                onClick={() => setSection('notifications')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  section === 'notifications' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Bell size={11} />
                Notifications
              </button>
            </div>
          </div>

          {/* Article list (only shown in articles section) */}
          {section === 'articles' && (
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <button
              onClick={startNew}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/25 text-fuchsia-300 text-xs hover:bg-fuchsia-500/25 transition-all"
            >
              <Plus size={12} />
              New Article
            </button>
          </div>
          )}

          <div className="flex-1 overflow-y-auto py-2">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="text-slate-600 animate-spin" />
              </div>
            )}
            {!loading && articles.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-600">
                <FileText size={20} strokeWidth={1.5} />
                <p className="text-xs">No articles yet</p>
              </div>
            )}
            {!loading && articles.map(a => {
              const cfg = TYPE_CONFIG[a.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.update
              const isSelected = editing?.id === a.id
              return (
                <div
                  key={a.id}
                  className={`mx-2 mb-1 rounded-xl px-3 py-2.5 cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-white/[0.07] border-white/15'
                      : 'border-transparent hover:bg-white/[0.04] hover:border-white/8'
                  }`}
                  onClick={() => loadArticle(a)}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate leading-snug">{a.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-slate-700">·</span>
                        <span className={`text-[10px] ${a.isActive ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {a.isActive ? 'Live' : 'Draft'}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); toggleActive(a) }}
                        className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all ${
                          a.isActive
                            ? 'text-emerald-400 hover:bg-emerald-500/10'
                            : 'text-slate-600 hover:text-slate-400 hover:bg-white/8'
                        }`}
                        title={a.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {a.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(a.id) }}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/8 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Notifications section */}
          {section === 'notifications' && (
            <div className="p-6 max-w-4xl">
              <NotificationManager />
            </div>
          )}

          {/* Articles section */}
          {section === 'articles' && (!isEditing ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-600">
              <FileText size={32} strokeWidth={1.5} />
              <div className="text-center">
                <p className="text-sm font-medium text-slate-400">Select an article to edit</p>
                <p className="text-xs mt-1">or create a new one</p>
              </div>
              <button
                onClick={startNew}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/25 text-fuchsia-300 text-sm hover:bg-fuchsia-500/25 transition-all"
              >
                <Plus size={14} />
                New Article
              </button>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">

              {/* Editor header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white">{isNew ? 'New Article' : 'Edit Article'}</h2>
                  {editing?.isActive && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-emerald-400">Live at /news/{editing.slug}</span>
                      <a href={`/news/${editing.slug}`} target="_blank" rel="noopener noreferrer"
                        className="text-slate-600 hover:text-slate-400 transition-colors">
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-white/8 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-500/30 transition-all disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              </div>

              {saveError && (
                <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                  {saveError}
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 mb-6 bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
                {(['info', 'content', 'preview'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      tab === t
                        ? 'bg-white/10 text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* ── INFO TAB ────────────────────────────────────────────── */}
              {tab === 'info' && (
                <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Title</label>
                    <input
                      value={title}
                      onChange={e => handleTitleChange(e.target.value)}
                      placeholder="Article title…"
                      className="w-full h-10 bg-white/[0.04] border border-white/10 rounded-xl px-4 text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-sm"
                    />
                  </div>

                  {/* Slug */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Slug</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-600 shrink-0">/news/</span>
                      <input
                        value={slug}
                        onChange={e => { setSlug(e.target.value); setSlugEdited(true) }}
                        placeholder="article-slug"
                        className="flex-1 h-10 bg-white/[0.04] border border-white/10 rounded-xl px-4 text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 text-sm font-mono"
                      />
                    </div>
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Type</label>
                    <div className="flex gap-2">
                      {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => (
                        <button
                          key={key}
                          onClick={() => setType(key)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                            type === key
                              ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                              : 'bg-white/[0.03] border-white/8 text-slate-500 hover:text-white'
                          }`}
                        >
                          {cfg.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                      Summary <span className="normal-case text-slate-600 font-normal">(shown in portal news dropdown)</span>
                    </label>
                    <textarea
                      value={summary}
                      onChange={e => setSummary(e.target.value)}
                      placeholder="Brief summary shown in the news dropdown preview…"
                      rows={3}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40 resize-none"
                    />
                  </div>

                  {/* Preview Image */}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                      Preview Image <span className="normal-case text-slate-600 font-normal">(optional, for dropdown card)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={previewImage}
                        onChange={e => setPreviewImage(e.target.value)}
                        placeholder="https://… or upload"
                        className="flex-1 h-10 bg-white/[0.04] border border-white/10 rounded-xl px-4 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
                      />
                      <button
                        onClick={() => previewFileRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-1.5 px-3 h-10 rounded-xl bg-white/[0.04] border border-white/10 text-slate-400 hover:text-white hover:bg-white/8 text-xs transition-all disabled:opacity-50"
                      >
                        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                        Upload
                      </button>
                      <input
                        ref={previewFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) uploadImage(f, url => setPreviewImage(url))
                          e.target.value = ''
                        }}
                      />
                    </div>
                    {previewImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewImage} alt="" className="mt-2 h-20 w-full object-cover rounded-xl border border-white/10" />
                    )}
                  </div>

                  {/* Active toggle */}
                  <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/[0.03] border border-white/8">
                    <div>
                      <p className="text-sm font-medium text-white">Publish article</p>
                      <p className="text-xs text-slate-500 mt-0.5">Make visible to users in the portal news dropdown</p>
                    </div>
                    <button
                      onClick={() => setIsActive(v => !v)}
                      className={`relative w-10 h-5.5 rounded-full border transition-all ${
                        isActive
                          ? 'bg-emerald-500/30 border-emerald-500/50'
                          : 'bg-white/5 border-white/15'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                        isActive ? 'left-5 bg-emerald-400' : 'left-0.5 bg-slate-600'
                      }`} />
                    </button>
                  </div>
                </div>
              )}

              {/* ── CONTENT TAB ─────────────────────────────────────────── */}
              {tab === 'content' && (
                <div className="space-y-3">
                  {blocks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-600 border border-dashed border-white/10 rounded-2xl">
                      <LayoutGrid size={24} strokeWidth={1.5} />
                      <p className="text-xs">No blocks yet — add one below</p>
                    </div>
                  )}

                  {blocks.map((block, idx) => (
                    <BlockWrapper
                      key={block.id}
                      block={block}
                      index={idx}
                      total={blocks.length}
                      onMoveUp={() => moveBlock(idx, -1)}
                      onMoveDown={() => moveBlock(idx, 1)}
                      onDelete={() => deleteBlock(idx)}
                    >
                      {block.type === 'heading' && (
                        <HeadingEditor block={block} onChange={b => updateBlock(idx, b)} />
                      )}
                      {block.type === 'text' && (
                        <TextEditor block={block} onChange={b => updateBlock(idx, b)} />
                      )}
                      {block.type === 'image' && (
                        <ImageEditor
                          block={block}
                          onChange={b => updateBlock(idx, b)}
                          onUpload={uploadImage}
                          uploading={uploading}
                        />
                      )}
                      {block.type === 'video' && (
                        <VideoEditor
                          block={block}
                          onChange={b => updateBlock(idx, b)}
                          onUpload={uploadImage}
                          uploading={uploading}
                        />
                      )}
                      {block.type === 'callout' && (
                        <CalloutEditor block={block} onChange={b => updateBlock(idx, b)} />
                      )}
                      {block.type === 'divider' && (
                        <p className="text-xs text-slate-600 italic">Horizontal rule</p>
                      )}
                      {block.type === 'spacer' && (
                        <SpacerEditor block={block} onChange={b => updateBlock(idx, b)} />
                      )}
                    </BlockWrapper>
                  ))}

                  {/* Add block buttons */}
                  <div className="pt-2 border-t border-white/[0.06]">
                    <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-3">Add Block</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { type: 'heading' as BlockType,  icon: Hash,      label: 'Heading'  },
                        { type: 'text'    as BlockType,  icon: AlignLeft, label: 'Text'     },
                        { type: 'image'   as BlockType,  icon: ImageIcon, label: 'Image'    },
                        { type: 'video'   as BlockType,  icon: Video,     label: 'Video'    },
                        { type: 'callout' as BlockType,  icon: Quote,     label: 'Callout'  },
                        { type: 'divider' as BlockType,  icon: Minus,     label: 'Divider'  },
                        { type: 'spacer'  as BlockType,  icon: Type,      label: 'Spacer'   },
                      ].map(({ type: bType, icon: Icon, label }) => (
                        <button
                          key={bType}
                          onClick={() => addBlock(bType)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/8 text-slate-400 hover:text-white hover:bg-white/8 hover:border-white/15 text-xs transition-all"
                        >
                          <Icon size={12} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── PREVIEW TAB ─────────────────────────────────────────── */}
              {tab === 'preview' && (
                <div>
                  {/* Article preview header */}
                  <div className="mb-8">
                    {previewImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewImage} alt="" className="w-full h-48 object-cover rounded-2xl border border-white/10 mb-6" />
                    )}
                    {(() => {
                      const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.update
                      return (
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.border} border ${cfg.color} mb-3`}>
                          {cfg.label}
                        </span>
                      )
                    })()}
                    <h1 className="text-2xl font-bold text-white leading-snug">{title || <span className="opacity-30 italic">No title</span>}</h1>
                    {summary && <p className="text-slate-400 text-sm mt-2 leading-relaxed">{summary}</p>}
                  </div>
                  <div className="space-y-5 border-t border-white/[0.06] pt-6">
                    {blocks.length === 0
                      ? <p className="text-slate-600 text-sm italic text-center py-8">No content blocks yet</p>
                      : blocks.map((b, i) => renderBlock(b, i))
                    }
                  </div>

                  {/* Dropdown preview */}
                  <div className="mt-10 pt-6 border-t border-white/[0.06]">
                    <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-widest mb-3">Portal Dropdown Preview</p>
                    <div className="w-72 rounded-xl border border-white/10 bg-slate-900/80 overflow-hidden">
                      {(() => {
                        const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.update
                        return (
                          <div className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer">
                            <div className="flex items-start gap-3">
                              {previewImage
                                ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={previewImage} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10" />
                                )
                                : (
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} border ${cfg.border}`}>
                                    <Sparkles size={16} className={cfg.color} />
                                  </div>
                                )
                              }
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[10px] font-semibold ${cfg.color}`}>{cfg.label}</span>
                                </div>
                                <p className="text-[12px] text-slate-200 font-medium leading-snug truncate">{title || 'Article title'}</p>
                                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{summary || 'Article summary'}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
