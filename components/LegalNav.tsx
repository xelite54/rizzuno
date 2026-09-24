import Link from "next/link"

export function LegalNav({className=""}:{className?:string}){
  return <nav aria-label="Legal and safety" className={`flex flex-wrap gap-x-3 gap-y-2 text-sm text-muted ${className}`}>
    <Link href="/terms" className="underline">Terms</Link>
    <Link href="/privacy" className="underline">Privacy</Link>
    <Link href="/community-guidelines" className="underline">Community Guidelines</Link>
    <Link href="/safety" className="underline">Safety Center</Link>
    <Link href="/appeals" className="underline">Appeals</Link>
    <Link href="/copyright" className="underline">Copyright / DMCA</Link>
    <Link href="/reports/recent" className="underline">Report recent match</Link>
    <Link href="/privacy#rights" className="underline">Privacy requests</Link>
  </nav>
}
