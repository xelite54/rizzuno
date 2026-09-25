"use client"

import { useEffect, useState } from "react"
import { usePublicProfile } from "@/hooks/usePublicProfile"
import { createPortal } from "react-dom"

export function PublicProfilePosts({ username }: { username?: string | null }) {
  const { profile, error, loading, retry } = usePublicProfile(username)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null) }
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [selected])
  if (!username) return <p className="py-6 text-xs text-muted">Profile unavailable.</p>
  if (loading) return <p role="status" className="py-6 text-xs text-muted">Loading posts…</p>
  if (error) return <div className="py-6 text-xs text-muted"><p role="alert">{error}</p><button className="mt-3 underline" onClick={retry}>Try again</button></div>
  return <div className="w-full">
    {profile?.bio && <p className="mb-5 whitespace-pre-wrap break-words text-sm text-muted">{profile.bio}</p>}
    {profile?.posts.length ? <div className="grid grid-cols-3 gap-2">
      {profile.posts.map((post) => <button key={post.id} onClick={() => setSelected(post.dataUrl)} aria-label="Enlarge photo" className="aspect-square overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-accent">
        {/* eslint-disable-next-line @next/next/no-img-element -- moderated user upload */}
        <img src={post.dataUrl} alt="Profile post" className="h-full w-full object-cover" />
      </button>)}
    </div> : <p className="py-6 text-xs text-muted">No posts yet</p>}
    {selected && createPortal(<div role="dialog" aria-modal="true" aria-label="Expanded photo" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#09070df5] p-6" onClick={() => setSelected(null)}>
      <button autoFocus onClick={() => setSelected(null)} aria-label="Close photo" className="absolute right-5 top-5 h-11 w-11 rounded-full border border-white/20 text-2xl text-white">×</button>
      {/* eslint-disable-next-line @next/next/no-img-element -- moderated user upload */}
      <img src={selected} alt="Expanded profile post" className="max-h-[85dvh] max-w-full rounded-lg object-contain" onClick={(event) => event.stopPropagation()} />
    </div>, document.body)}
  </div>
}
