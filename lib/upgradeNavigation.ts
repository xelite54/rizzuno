/** Only internal homepage panels are valid return destinations. */
export function safeUpgradeReturn(value: string | null): string {
  if (!value || !/^\/\?(?:panel=)/.test(value) || /[\\\r\n]/.test(value)) return "/"
  const query = new URLSearchParams(value.slice(2))
  if (!["profile", "friends"].includes(query.get("panel") ?? "")) return "/"
  return `/?${query.toString()}`
}

export function subscriptionHref(feature: string): string {
  const panel = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-upgrade-return]")
  const returnTo = safeUpgradeReturn(panel?.dataset.upgradeReturn ?? null)
  return `/rizz-plus?feature=${encodeURIComponent(feature)}&returnTo=${encodeURIComponent(returnTo)}`
}
