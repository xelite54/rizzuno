import Link from "next/link"
import { auth } from "@/auth"
import { listAppealableEnforcements, listUserAppeals } from "@/lib/db"
import { submitAppealAction } from "./actions"
import { LegalNav } from "@/components/LegalNav"
import { RELATED_LEGAL_VERSIONS } from "@/lib/legalVersions"

export const dynamic="force-dynamic"

const actionLabel={restrict:"Temporary restriction",suspend:"Temporary suspension",ban:"Permanent ban"} as const

export default async function AppealsPage({searchParams}:{searchParams:Promise<{submitted?:string}>}){
  const session=await auth(); const query=await searchParams
  const [enforcements,appeals]=session?.user?.id?await Promise.all([listAppealableEnforcements(session.user.id),listUserAppeals(session.user.id)]):[[],[]]
  return <main className="h-dvh overflow-y-auto px-6 py-10"><div className="mx-auto max-w-2xl space-y-7">
    <div><Link href="/" className="text-sm text-muted underline">← Back to Rizzuno</Link><h1 className="mt-4 text-3xl font-bold">Moderation appeals</h1>
      <p className="mt-1 text-xs text-muted">Process version {RELATED_LEGAL_VERSIONS.appeals}</p><p className="mt-2 text-sm text-muted">Appeal an underage decision, temporary restriction or suspension, permanent ban, or another serious enforcement tied to your account. Appeals do not reveal reports, evidence, reporter identities, or internal moderator notes.</p></div>
    {!session?.user?.id?<p className="rounded-xl border border-border p-4">Sign in with the affected Google account from the Rizzuno home page before submitting an appeal.</p>:<>
      {query.submitted==="1"&&<p className="rounded-xl border border-border p-3">Appeal submitted for review.</p>}
      <section><h2 className="text-lg font-semibold">Eligible decisions</h2><div className="mt-3 space-y-4">
        {enforcements.length===0?<p className="text-sm text-muted">No appealable enforcement decisions are recorded for this account.</p>:enforcements.map(item=><div key={item.enforcementId} className="rounded-2xl border border-border p-4">
          <p className="font-medium">{actionLabel[item.action as keyof typeof actionLabel]??item.action}{item.category?` · ${item.category.replaceAll("_"," ")}`:""}</p>
          <p className="mt-1 text-xs text-muted">Applied {new Date(item.createdAt).toLocaleString()}{item.expiresAt?` · ends ${new Date(item.expiresAt).toLocaleString()}`:""}</p>
          {item.hasOpenAppeal?<p className="mt-3 text-sm text-muted">An appeal is already open for this decision.</p>:<form action={submitAppealAction} className="mt-4 grid gap-3">
            <input type="hidden" name="enforcementId" value={item.enforcementId}/>
            <label className="grid gap-1 text-sm">Why should this decision be reconsidered?<textarea name="reason" required maxLength={2000} className="min-h-28 rounded-lg border border-border bg-surface p-2"/></label>
            <label className="grid gap-1 text-sm">Optional evidence or case reference<input name="evidenceReference" maxLength={500} className="rounded-lg border border-border bg-surface p-2"/></label>
            <button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Submit appeal</button>
          </form>}
        </div>)}</div></section>
      <section><h2 className="text-lg font-semibold">Your appeals</h2><div className="mt-3 space-y-3">{appeals.length===0?<p className="text-sm text-muted">No appeals submitted.</p>:appeals.map(appeal=><article key={appeal.id} className="rounded-xl border border-border p-4 text-sm">
        <p className="font-medium">{actionLabel[appeal.action as keyof typeof actionLabel]??appeal.action} · {appeal.status.replaceAll("_"," ")}</p>
        <p className="mt-1 text-muted">Submitted {new Date(appeal.submittedAt).toLocaleString()}</p>
        <p className="mt-2">{appeal.reason}</p>{appeal.resolution&&<p className="mt-2 rounded-lg bg-surface-2 p-3">Resolution: {appeal.resolution}</p>}
      </article>)}</div></section>
    </>}
    <p className="text-sm text-muted">Appeals are reviewed by authorized personnel. Submitting an appeal does not automatically pause an enforcement. See the <Link href="/safety" className="underline">Safety Center</Link>.</p>
    <LegalNav className="border-t border-border pt-4"/>
  </div></main>
}
