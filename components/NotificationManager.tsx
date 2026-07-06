"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Bell, Plus, Edit, Trash2, Power, PowerOff, Monitor, Layers, Scan, Lock, Unlock } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Notification {
  id: number
  message: string
  type: string
  target: string
  isActive: boolean
  locked: boolean
  createdAt: string
}

// The notifications API requires the admin password for all=true reads and all mutations
function adminHeaders(): Record<string, string> {
  const pass = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("admin-password") ?? "") : ""
  return pass ? { "x-admin-password": pass } : {}
}

const TYPE_COLORS = {
  info:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    text: 'text-cyan-400',    badge: 'bg-cyan-500' },
  warning: { bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30',  text: 'text-yellow-400',  badge: 'bg-yellow-500' },
  success: { bg: 'bg-green-500/10',   border: 'border-green-500/30',   text: 'text-green-400',   badge: 'bg-green-500' },
  update:  { bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30', text: 'text-fuchsia-400', badge: 'bg-fuchsia-500' }
}

const TARGET_LABELS: Record<string, { label: string; color: string }> = {
  main:   { label: 'Main Page',  color: 'bg-slate-600 text-slate-200' },
  portal: { label: 'Portal V2',  color: 'bg-violet-700 text-violet-200' },
  all:    { label: 'Both Pages', color: 'bg-orange-700 text-orange-200' },
}

// Parses [link text](url) syntax into clickable links (preview in admin list)
function parseMessage(message: string, textClass: string) {
  const parts = message.split(/(\[[^\]]+\]\([^)]+\))/g)
  return parts.map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (match) {
      return (
        <a key={i} href={match[2]} target="_blank" rel="noopener noreferrer"
          className={`underline font-bold hover:opacity-80 transition-opacity`}>
          {match[1]}
        </a>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function NotificationManager() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    message: '',
    type: 'info',
    target: 'main',
    isActive: true,
    locked: false,
  })

  useEffect(() => {
    fetchNotifications()
  }, [])

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications?all=true', { headers: adminHeaders() })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data)
      }
    } catch (error) {
      console.error('Error fetching notifications:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      if (editingId) {
        const res = await fetch('/api/notifications', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...adminHeaders() },
          body: JSON.stringify({ id: editingId, ...formData })
        })
        if (res.ok) { await fetchNotifications(); resetForm() }
      } else {
        const res = await fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...adminHeaders() },
          body: JSON.stringify(formData)
        })
        if (res.ok) { await fetchNotifications(); resetForm() }
      }
    } catch (error) {
      console.error('Error saving notification:', error)
    }
  }

  const handleEdit = (notification: Notification) => {
    setEditingId(notification.id)
    setFormData({
      message: notification.message,
      type: notification.type,
      target: notification.target || 'main',
      isActive: notification.isActive,
      locked: notification.locked ?? false,
    })
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this notification?')) return
    try {
      const res = await fetch(`/api/notifications?id=${id}`, { method: 'DELETE', headers: adminHeaders() })
      if (res.ok) await fetchNotifications()
    } catch (error) {
      console.error('Error deleting notification:', error)
    }
  }

  const handleToggleActive = async (notification: Notification) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ id: notification.id, isActive: !notification.isActive })
      })
      if (res.ok) await fetchNotifications()
    } catch (error) {
      console.error('Error toggling notification:', error)
    }
  }

  const handleToggleLocked = async (notification: Notification) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ id: notification.id, locked: !notification.locked })
      })
      if (res.ok) await fetchNotifications()
    } catch (error) {
      console.error('Error toggling lock:', error)
    }
  }

  const resetForm = () => {
    setFormData({ message: '', type: 'info', target: 'main', isActive: true, locked: false })
    setEditingId(null)
    setShowForm(false)
  }

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold flex items-center gap-2 text-cyan-400">
          <Bell size={20} /> NOTIFICATIONS
        </h2>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs h-8"
        >
          <Plus size={14} className="mr-1" /> NEW
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <Textarea
            value={formData.message}
            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
            placeholder="Notification message... Use [Click Here](https://url.com) to add clickable links."
            className="mb-2 bg-slate-950 border-slate-700 text-white"
            rows={3}
          />
          <p className="text-[11px] text-slate-500 mb-3">
            💡 Add links with <code className="bg-slate-800 px-1 rounded text-cyan-400">[Click Here](https://url.com)</code> — the text in brackets becomes the clickable label.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-3">
            {/* Type */}
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger className="w-44 bg-slate-950 border-slate-700 text-white">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info (Blue)</SelectItem>
                <SelectItem value="warning">Warning (Yellow)</SelectItem>
                <SelectItem value="success">Success (Green)</SelectItem>
                <SelectItem value="update">Update (Purple)</SelectItem>
              </SelectContent>
            </Select>

            {/* Target */}
            <Select
              value={formData.target}
              onValueChange={(value) => setFormData({ ...formData, target: value })}
            >
              <SelectTrigger className="w-44 bg-slate-950 border-slate-700 text-white">
                <SelectValue placeholder="Target page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">
                  <span className="flex items-center gap-2"><Monitor size={13} /> Main Page</span>
                </SelectItem>
                <SelectItem value="portal">
                  <span className="flex items-center gap-2"><Scan size={13} /> Portal V2 (News)</span>
                </SelectItem>
                <SelectItem value="all">
                  <span className="flex items-center gap-2"><Layers size={13} /> Both Pages</span>
                </SelectItem>
              </SelectContent>
            </Select>

            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={formData.locked}
                onChange={(e) => setFormData({ ...formData, locked: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="flex items-center gap-1.5">
                <Lock size={12} className="text-amber-400" />
                Locked
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="submit" className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs">
              {editingId ? 'UPDATE' : 'CREATE'}
            </Button>
            <Button
              type="button"
              onClick={resetForm}
              className="bg-slate-700 hover:bg-slate-600 text-white text-xs"
            >
              CANCEL
            </Button>
          </div>
        </form>
      )}

      {/* Notifications List */}
      <div className="space-y-3">
        {notifications.map((notification) => {
          const colors = TYPE_COLORS[notification.type as keyof typeof TYPE_COLORS] || TYPE_COLORS.info
          const targetInfo = TARGET_LABELS[notification.target || 'main'] || TARGET_LABELS.main

          return (
            <div
              key={notification.id}
              className={`p-4 rounded-xl border ${colors.border} ${colors.bg}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-2 flex-wrap flex-1">
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${colors.badge} text-black`}>
                    {notification.type}
                  </span>
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${targetInfo.color}`}>
                    {targetInfo.label}
                  </span>
                  {!notification.isActive && (
                    <span className="px-2 py-1 rounded text-[10px] font-bold bg-slate-700 text-slate-400">
                      INACTIVE
                    </span>
                  )}
                  {notification.locked && (
                    <span className="px-2 py-1 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 flex items-center gap-1">
                      <Lock size={9} /> LOCKED
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleLocked(notification)}
                    title={notification.locked ? "Unlock (users can dismiss)" : "Lock (users cannot dismiss)"}
                    className={`p-1 rounded hover:bg-slate-800 transition-colors ${notification.locked ? 'text-amber-400' : 'text-slate-600'}`}
                  >
                    {notification.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                  <button
                    onClick={() => handleToggleActive(notification)}
                    className={`p-1 rounded hover:bg-slate-800 transition-colors ${notification.isActive ? 'text-green-400' : 'text-slate-600'}`}
                  >
                    {notification.isActive ? <Power size={14} /> : <PowerOff size={14} />}
                  </button>
                  <button
                    onClick={() => handleEdit(notification)}
                    className="p-1 rounded hover:bg-slate-800 transition-colors text-cyan-400"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(notification.id)}
                    className="p-1 rounded hover:bg-slate-800 transition-colors text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className={`text-sm ${colors.text}`}>{parseMessage(notification.message, colors.text)}</p>
              <p className="text-[10px] text-slate-600 mt-2">
                {new Date(notification.createdAt).toLocaleString()}
              </p>
            </div>
          )
        })}

        {notifications.length === 0 && (
          <div className="text-center py-8 text-slate-600">
            No notifications yet. Create one to show on the main page or Portal V2!
          </div>
        )}
      </div>
    </div>
  )
}
