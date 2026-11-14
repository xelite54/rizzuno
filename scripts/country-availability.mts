import { countryPolicyForLocation } from "../lib/countryPolicy"
import { COUNTRIES_ELIGIBLE_FOR_REVIEW, EXCLUDED_COUNTRIES, supportedCountries, supportedSubdivisions } from "../lib/geographicAccess"

// Reports the current process environment only. Never loads production
// credentials, approves a country, writes configuration, or contacts a service.
const countries = [...new Set([...EXCLUDED_COUNTRIES, ...COUNTRIES_ELIGIBLE_FOR_REVIEW, ...supportedCountries()])].sort()
const subdivisions = supportedSubdivisions()
const policies = countries.flatMap(country => [
  countryPolicyForLocation(country, null),
  ...(subdivisions[country] ?? []).map(region => countryPolicyForLocation(country, region)),
])
console.log(JSON.stringify({
  source: "current process environment; not a production configuration discovery",
  defaultExclusions: EXCLUDED_COUNTRIES,
  eligibleForReview: COUNTRIES_ELIGIBLE_FOR_REVIEW,
  approvedLocations: policies.filter(policy => policy.status === "approved").map(policy => policy.jurisdiction),
  pendingCountries: countries.filter(country => !EXCLUDED_COUNTRIES.some(code => code === country) && !policies.some(policy => policy.countryCode === country && policy.status === "approved")),
  policies,
}, null, 2))
