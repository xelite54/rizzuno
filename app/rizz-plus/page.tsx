"use client"

import Link from "next/link"
import { LegalNav } from "@/components/LegalNav"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useRizzPlus } from "@/components/RizzPlusProvider"
import styles from "./page.module.css"
import { safeUpgradeReturn } from "@/lib/upgradeNavigation"

// Copy stays literal about what Rizz+ unlocks today: nobody sees ads right
// now, and the gated friends action is sending requests.
const benefits = [
  { name: "No ads", note: "Rizzuno is ad-free for everyone while we test." },
  { name: "Change gender", note: "Update how you appear on Rizzuno." },
  { name: "Friends", note: "Send requests to people you meet and stay in touch." },
  { name: "Post photos", note: "Add photos to your profile." },
  { name: "Profile photo", note: "Change your profile image anytime." },
]

export default function RizzPlusPage() {
  const router = useRouter()
  const { status } = useSession()
  const { active, loading, canManage, refresh } = useRizzPlus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [returnTo, setReturnTo] = useState("/")
  const [confirmCancel, setConfirmCancel] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the internal return destination after hydration
    setReturnTo(safeUpgradeReturn(new URLSearchParams(window.location.search).get("returnTo")))
  }, [])

  async function cancelMembership() {
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" })
      if (!response.ok) throw new Error()
      setReturned(false)
      await refresh()
      setConfirmCancel(false)
    } catch { setError("Couldn’t cancel your test membership. Please try again.") }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "success") return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read Checkout return state after hydration
    setReturned(true)
    setWaiting(true)
    let attempts = 0
    void refresh()
    const timer = setInterval(() => { void refresh(); if (++attempts >= 10) { clearInterval(timer); setWaiting(false) } }, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  async function openBilling(manage = false) {
    if (status !== "authenticated") { router.push("/"); return }
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/billing/${manage ? "portal" : "checkout"}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok) {
        const messages: Record<string, string> = {
          not_authenticated: "Your session expired. Sign in again, then activate Rizz+.",
          rate_limited: "Too many attempts. Wait a minute, then try again.",
          invalid_origin: "The request was rejected. Reload this page and try again from the same website.",
          account_unavailable: "Rizz+ cannot be activated while your account is restricted.",
          billing_unavailable: "Membership could not be saved. Please try again; if this continues, the server’s database connection needs checking.",
        }
        setError(messages[data.error] ?? "Couldn’t activate Rizz+. Please try again shortly.")
        setBusy(false)
        return
      }
      if (data.active === true && data.testMode === true) {
        await refresh()
        setReturned(true)
        setWaiting(false)
        setBusy(false)
        return
      }
      if (!data.url) throw new Error()
      window.location.assign(data.url)
    } catch { setError(manage ? "Billing isn’t available right now. Please try again shortly." : "Couldn’t activate Rizz+. Please try again shortly."); setBusy(false) }
  }

  const primaryLabel = busy ? (active && canManage ? "Opening billing…" : "Activating Rizz+…") : loading ? "Checking membership…" : active ? "Manage subscription" : "Activate Rizz+"

  // Shown once, in the hero — never repeated further down the page.
  const statusLabel = loading ? "Checking…" : active ? "Active" : "Not active"

  return (
    <main className={`${styles.page} h-dvh`}>
      <div className={styles.scroll}>
        <div className={styles.frame}>
          <nav className={styles.nav}>
            <Link href={returnTo} className={styles.back} aria-label="Go back"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Back</span></Link>
            <Link href="/" className={styles.wordmark}>Rizzuno</Link>
          </nav>

          <header className={`${styles.band} ${styles.hero}`}>
            <div>
              <h1 className={styles.title}>Rizz+</h1>
              <p className={styles.lede}>More of Rizzuno.</p>
              <p className={styles.sublede}>Free during test access</p>
            </div>
            <div className={styles.membership} aria-live="polite">
              <p className={styles.membershipLabel}>Your membership</p>
              <p className={`${styles.status} ${active && !loading ? styles.statusActive : ""}`}>{active && !loading && <span className={styles.dot} aria-hidden="true" />}{statusLabel}</p>
              <p className={styles.membershipMeta}>$0 during test access. No card required, no automatic charges.</p>
            </div>
          </header>

          <section className={`${styles.band} ${styles.included}`} aria-labelledby="included-heading">
            <h2 id="included-heading" className={styles.aside}>Included with Rizz+</h2>
            <ol className={styles.features}>
              {benefits.map((benefit, index) => (
                <li key={benefit.name}>
                  <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <p className={styles.featureName}>{benefit.name}</p>
                  <p className={styles.featureNote}>{benefit.note}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={`${styles.band} ${styles.manage}`} aria-labelledby="manage-heading">
            <div>
              <h2 id="manage-heading" className={styles.manageTitle}>{active ? (canManage ? "Subscription" : "Test membership") : "Start test access"}</h2>
              <p className={styles.manageNote}>{loading ? "Checking your membership…" : active ? "Your access is currently active." : "Free, with no card required."}</p>
            </div>
            <div className={styles.manageBody}>
              {returned && !active && <p role="status" className={styles.notice}>{waiting ? "Confirming your membership…" : "Refresh your membership status below to confirm activation."}</p>}
              {returned && active && <p role="status" className={styles.notice}>Rizz+ is active. Your features are unlocked.</p>}
              {error && <p role="alert" className={styles.error}>{error}</p>}
              {/* A free grant (see grantFreeRizzPlus in lib/db.ts) has no real
                  Stripe customer behind it, so there's nothing for the billing
                  portal to manage — canManage stays false for it. Only a real
                  paid subscription gets the "Manage subscription" action;
                  a free member just sees their status and a cancel option
                  instead of a button that would 404 against the portal route. */}
              <div className={styles.actions}>
                {(!active || canManage) && <button disabled={busy || loading || (returned && !active)} onClick={() => void openBilling(active)} className={active ? styles.secondary : styles.primary}>{primaryLabel}</button>}
                {active && canManage && <button disabled={busy} onClick={() => void openBilling(true)} className={styles.textLink}>Cancel paid subscription in billing ↗</button>}
                {active && !canManage && !confirmCancel && <button disabled={busy} onClick={() => setConfirmCancel(true)} className={styles.quiet}>Cancel membership</button>}
                {!active && canManage && <button onClick={() => void openBilling(true)} disabled={busy} className={styles.textLink}>Manage existing billing</button>}
                {returned && !active && <button onClick={() => void refresh()} className={styles.textLink}>Refresh membership status</button>}
              </div>
              {active && !canManage && confirmCancel && (
                <div className={styles.confirm} role="group" aria-label="Confirm cancellation">
                  <p>Cancel test Rizz+? Plus features lock immediately. Your friends and existing photos stay.</p>
                  <div className={styles.confirmActions}>
                    <button disabled={busy} onClick={() => setConfirmCancel(false)} className={styles.secondary}>Keep Rizz+</button>
                    <button disabled={busy} onClick={() => void cancelMembership()} className={styles.danger}>{busy ? "Cancelling…" : "Confirm cancellation"}</button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <footer className={styles.footer}>
            <p>Rizz+ is in temporary test access. Activating it requires no card and creates no automatic charge. Membership does not bypass content moderation.</p>
            <LegalNav className={styles.legal} />
          </footer>
        </div>
      </div>
    </main>
  )
}
