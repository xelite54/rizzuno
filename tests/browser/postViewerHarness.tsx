// Renders the real other-user post grids (PostGallery for friend profiles,
// PublicProfilePosts for search/request/peer profiles) so the shared
// PostViewer can be driven by real Chrome input events.
import { createRoot } from "react-dom/client"
import { PostGallery } from "../../components/match/PostGallery"
import { PublicProfilePosts } from "../../components/match/PublicProfilePosts"

const colors = ["#d33", "#3a3", "#33d", "#dd3", "#d3d"]
export const fixturePosts = colors.map((color, index) => ({
  id: `post-${index + 1}`,
  dataUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`)}`,
}))

function Harness() {
  return <div>
    <section id="friend"><PostGallery posts={fixturePosts} owner="friendly" /></section>
    <section id="public"><PublicProfilePosts username="publicuser" /></section>
  </div>
}

function snapshot() {
  const dialog = document.querySelector("dialog[open]")
  if (!dialog) return { open: false }
  const img = dialog.querySelector("img")
  const prev = dialog.querySelector<HTMLButtonElement>('button[aria-label="Previous post"]')
  const next = dialog.querySelector<HTMLButtonElement>('button[aria-label="Next post"]')
  const rect = img?.getBoundingClientRect()
  return {
    open: true,
    label: dialog.getAttribute("aria-label"),
    alt: img?.getAttribute("alt"),
    src: img?.getAttribute("src"),
    prevHidden: !prev || prev.disabled || getComputedStyle(prev).visibility === "hidden",
    nextHidden: !next || next.disabled || getComputedStyle(next).visibility === "hidden",
    imageInViewport: !!rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    imageCentered: !!rect && Math.abs((rect.left + rect.right) / 2 - innerWidth / 2) < 40,
    focusInDialog: dialog.contains(document.activeElement),
  }
}

function center(selector: string) {
  const el = document.querySelector(selector)
  if (!el) return null
  el.scrollIntoView({ block: "center", inline: "center" })
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

Object.assign(window, { harness: { snapshot, center, posts: fixturePosts } })
createRoot(document.getElementById("root")!).render(<Harness />)
