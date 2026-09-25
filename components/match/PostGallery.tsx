"use client"

import { useState } from "react"
import { PostViewer, type ViewerPost } from "./PostViewer"

/** Only receives posts the profile endpoint has already authorized. */
export function PostGallery({ posts, owner }: { posts: ViewerPost[]; owner: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIndex = posts.findIndex((post) => post.id === selectedId)

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {posts.map((post, index) => (
          <button key={post.id} type="button" onClick={() => setSelectedId(post.id)} aria-label={`Enlarge photo ${index + 1} by ${owner}`} className="group aspect-square cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface-2 transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- authorized profile-post data URL */}
            <img src={post.dataUrl} alt={`Photo ${index + 1} by ${owner}`} className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.035]" />
          </button>
        ))}
      </div>
      {selectedIndex >= 0 && <PostViewer posts={posts} index={selectedIndex} owner={owner} onIndexChange={(index) => setSelectedId(posts[index].id)} onClose={() => setSelectedId(null)} />}
    </>
  )
}
