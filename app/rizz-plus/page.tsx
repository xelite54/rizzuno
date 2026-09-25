"use client"

import Link from "next/link"
import { LegalNav } from "@/components/LegalNav"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useRizzPlus } from "@/components/RizzPlusProvider"
import styles from "./page.module.css"
import { safeUpgradeReturn } from "@/lib/upgradeNavigation"

const benefits = [
  { name: "No ads", note: "Rizzuno has no ads for anyone right now." },
  { name: "Change gender", note: "Update the gender shown on your profile." },
  { name: "Send friend requests", note: "Keep in touch with people you meet." },
  { name: "Post photos", note: "Share photos on your profile." },
  { name: "Change profile photo", note: "Swap your photo whenever you like." },
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

  return (
    <main className={`${styles.page} h-dvh`}>
      <div className={styles.scroll}>
        <nav className={styles.nav}>
          <Link href={returnTo} className={styles.back} aria-label="Go back"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Back</span></Link>
          <Link href="/" className={styles.wordmark}>Rizzuno</Link>
        </nav>

        <div className={styles.column}>
          <header className={styles.header}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>Rizz+</h1>
              {!loading && <span className={`${styles.status} ${active ? styles.statusActive : ""}`}>{active ? "Active" : "Test access"}</span>}
            </div>
            <p className={styles.lede}>A few extra ways to use Rizzuno. Free while we test it.</p>
          </header>

          <section className={styles.section} aria-labelledby="membership-heading">
            <h2 id="membership-heading" className={styles.label}>Membership</h2>
            <div className={styles.plan}>
              <div>
                <p className={styles.planName}>Rizz+</p>
                <p className={styles.planPrice}>Free during test access</p>
                <p className={styles.planMeta}>No card required · No automatic charges</p>
              </div>
              {active && <span className={styles.activeDot}><span aria-hidden="true" />Active</span>}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="included-heading">
            <h2 id="included-heading" className={styles.label}>Included</h2>
            <ul className={styles.features}>
              {benefits.map((benefit) => (
                <li key={benefit.name}>
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <div><p className={styles.featureName}>{benefit.name}</p><p className={styles.featureNote}>{benefit.note}</p></div>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="manage-heading">
            <h2 id="manage-heading" className={styles.label}>{active ? "Manage" : "Get started"}</h2>
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
              {active && !canManage && !confirmCancel && <button disabled={busy} onClick={() => setConfirmCancel(true)} className={styles.secondary}>Cancel test membership</button>}
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
          </section>

          <footer className={styles.footer}>
            <p>Rizz+ is in temporary test access. Activating it requires no card and creates no automatic charge. Membership does not bypass content moderation.</p>
            <LegalNav className="mt-4 gap-x-4 text-[12px] text-white/45 [&_a]:underline-offset-[3px] [&_a:hover]:text-white/80" />
          </footer>
        </div>
      </div>
    </main>
  )
}
