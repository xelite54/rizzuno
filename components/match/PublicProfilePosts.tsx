"use client"

import { useState } from "react"
import { usePublicProfile } from "@/hooks/usePublicProfile"
import { PostViewer } from "./PostViewer"

export function PublicProfilePosts({ username }: { username?: string | null }) {
  const { profile, error, loading, retry } = usePublicProfile(username)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = profile?.posts.findIndex((post) => post.id === selectedId) ?? -1
  if (!username) return <p className="py-6 text-xs text-muted">Profile unavailable.</p>
  if (loading) return <p role="status" className="py-6 text-xs text-muted">Loading posts…</p>
  if (error) return <div className="py-6 text-xs text-muted"><p role="alert">{error}</p><button className="mt-3 underline" onClick={retry}>Try again</button></div>
  return <div className="w-full">
    {profile?.bio && <p className="mb-5 whitespace-pre-wrap break-words text-sm text-muted">{profile.bio}</p>}
    {profile?.posts.length ? <div className="grid grid-cols-3 gap-2">
      {profile.posts.map((post) => <button key={post.id} onClick={() => setSelectedId(post.id)} aria-label="Enlarge photo" className="aspect-square overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-accent">
        {/* eslint-disable-next-line @next/next/no-img-element -- moderated user upload */}
        <img src={post.dataUrl} alt="Profile post" className="h-full w-full object-cover" />
      </button>)}
    </div> : <p className="py-6 text-xs text-muted">No posts yet</p>}
    {profile && selectedIndex >= 0 && <PostViewer posts={profile.posts} index={selectedIndex} owner={profile.username ?? username} onIndexChange={(index) => setSelectedId(profile.posts[index].id)} onClose={() => setSelectedId(null)} />}
  </div>
}
