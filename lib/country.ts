const codes = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK".split(" "))

export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.toUpperCase()
  return codes.has(code) ? code : null
}

export function countryLabel(value: unknown): { flag: string; name: string } | null {
  const code = normalizeCountry(value)
  if (!code) return null
  return {
    flag: String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))),
    name: new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code,
  }
}

export function requestCountry(request: Request): string | null {
  // Trust only the deployment platform's IP-derived header, never a
  // browser payload or arbitrary forwarded header on a standalone server.
  return process.env.VERCEL === "1" ? normalizeCountry(request.headers.get("x-vercel-ip-country")) : null
}

const usRegions = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "))

export function normalizeUsRegion(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.trim().toUpperCase()
  return usRegions.has(code) ? code : null
}

/** Vercel derives this ISO 3166-2 subdivision from the request IP. Browser
 * fields and forwarded location values are never accepted. A proxy placed in
 * front of Vercel must undergo a separate trust review before state gating. */
export function requestUsRegion(request: Request): string | null {
  if (process.env.VERCEL !== "1" || requestCountry(request) !== "US") return null
  return normalizeUsRegion(request.headers.get("x-vercel-ip-country-region"))
}
