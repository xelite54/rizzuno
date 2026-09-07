"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRizzPlus } from "@/components/RizzPlusProvider"
import styles from "./page.module.css"

const benefits = [
  ["01", "Stay in the moment", "An ad-free experience."],
  ["02", "More of you", "Post photos to your profile."],
  ["03", "Your choice", "Change your gender selection anytime."],
  ["04", "A second chance", "Undo a skip during the undo window, while the other person is still connected."],
  ["05", "Make it personal", "Change your profile photo."],
]

export default function RizzPlusPage() {
  const { status } = useSession()
  const { active, loading, canManage, refresh } = useRizzPlus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState(false)
  const [waiting, setWaiting] = useState(false)
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
    if (status !== "authenticated") { await signIn("google", { redirectTo: "/rizz-plus" }); return }
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/billing/${manage ? "portal" : "checkout"}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok || !data.url) throw new Error()
      window.location.assign(data.url)
    } catch { setError("Billing isn’t available right now. Please try again shortly."); setBusy(false) }
  }

  return (
    <main className={`${styles.page} h-dvh overflow-hidden text-[#f5eff5]`}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-10">
        <Link href="/" className="text-[17px] font-semibold tracking-tight">Rizzuno<span className="text-white/40">.com</span></Link>
        <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-[13px] text-white/70 hover:bg-white/5">Back to home</Link>
      </nav>
      <div className={styles.layout}>
        <section className={styles.story}>
          <div className={styles.pass} aria-label="Rizz+ membership pass preview">
            <div className={styles.passTop}><span>Rizzuno.com</span><span>MEMBERSHIP</span></div>
            <div className={styles.passName}>Rizz<span>+</span></div>
            <div className={styles.passBottom}><span>{active ? "YOU’RE ONE OF US" : "A LITTLE MORE POSSIBILITY"}</span></div>
          </div>
        </section>
        <section className={styles.details} aria-labelledby="membership-heading">
          <div className={styles.planHeading}><h2 id="membership-heading">{active ? "Your membership" : "One plan. All yours."}</h2><span>{active ? "ACTIVE +" : "RIZZ+"}</span></div>
          <div className={styles.price}><span>$4.99</span><p>USD / month<br /><span>Cancel anytime</span></p></div>
          <p className={styles.included}>THE EXTRA, INCLUDED</p>
          <ul className={styles.benefits}>
            {benefits.map(([number, title, description]) => <li key={number}><span className={styles.benefitNumber}>{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}
          </ul>
          {returned && !active && <p role="status" className="mt-3 text-[13px] text-[#ddb8d2]">{waiting ? "Confirming your subscription…" : "Confirmation is taking longer than expected. Refresh your status below before trying another payment."}</p>}
          {error && <p role="alert" className="mt-3 text-[13px] text-[#f2a4b7]">{error}</p>}
          {/* A free grant (see grantFreeRizzPlus in lib/db.ts) has no real
              Stripe customer behind it, so there's nothing for the billing
              portal to manage — canManage stays false for it. Only a real
              paid subscription gets the "Manage subscription" action;
              a free member just sees their status here instead of a button
              that would otherwise 404 against the portal route. */}
          <button disabled={busy || loading || (returned && !active) || (active && !canManage)} onClick={() => void openBilling(active)} className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-[#e8cedf] px-5 text-[14px] font-semibold text-[#261b28] transition hover:bg-[#f2deeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"><span>{busy ? "Opening Stripe…" : loading ? "Checking membership…" : active ? (canManage ? "Manage subscription" : "You’re a Rizz+ member") : "Get Rizz+"}</span></button>
          {!active && canManage && <button onClick={() => void openBilling(true)} disabled={busy} className="mt-2 w-full text-[12px] text-white/60 underline underline-offset-4">Manage existing billing</button>}
          {returned && !active && <button onClick={() => void refresh()} className="mt-2 w-full text-[12px] text-white/60 underline underline-offset-4">Refresh membership status</button>}
          <p className="mt-3 text-[11px] leading-relaxed text-white/40">Renews automatically at US$4.99/month until canceled. Cancel through Manage subscription; access continues until the paid period ends. Taxes, if applicable, are shown at checkout. Secure payment through Stripe.</p>
          <p className="mt-2 text-[11px] text-white/30">Rizzuno currently has no ads for any users. Membership does not bypass content moderation.</p>
          <div className="mt-3 flex gap-4 text-[11px] text-white/45"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div>
        </section>
      </div>
    </main>
  )
}
