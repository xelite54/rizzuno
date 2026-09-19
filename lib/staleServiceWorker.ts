/** Rizzuno has no current service worker. Remove only the obsolete same-origin
 * /sw.js registration, without touching caches or unrelated worker scopes. */
export async function removeStaleServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  for (const registration of await navigator.serviceWorker.getRegistrations()) {
    const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean)
    if (workers.some(worker => {
      const url = new URL(worker!.scriptURL)
      return url.origin === location.origin && url.pathname === "/sw.js"
    })) await registration.unregister()
  }
}
