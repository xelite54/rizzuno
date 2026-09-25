# U.S. state launch matrix

This is an empty operator review record, not a legal approval list. The repository does not mark any state approved. Complete one row per intended launch region and retain the review evidence outside source control where it contains confidential advice.

| Region | Approved | Reviewer/date | Review reference | Conditions/next review |
| --- | --- | --- | --- | --- |
| AL, AK, AZ, AR, CA, CO, CT, DE, DC | unset |  |  |  |
| FL, GA, HI, ID, IL, IN, IA, KS, KY | unset |  |  |  |
| LA, ME, MD, MA, MI, MN, MS, MO, MT | unset |  |  |  |
| NE, NV, NH, NJ, NM, NY, NC, ND, OH | unset |  |  |  |
| OK, OR, PA, RI, SC, SD, TN, TX, UT | unset |  |  |  |
| VT, VA, WA, WV, WI, WY | unset |  |  |  |

For every state intended for `SUPPORTED_US_REGIONS`, review the actual service and data practices, adult-access approach, privacy rights and appeals, consumer-protection disclosures, breach-response contacts and timelines, child-safety workflow, moderation/complaints, retention, and any state-specific age-assurance or platform requirements. Record a decision and any conditions. Grouped rows are only compact formatting; each code requires its own recorded decision.

`SUPPORTED_US_REGIONS` is required and non-empty for a production U.S. launch. It accepts uppercase two-letter codes for the 50 states and District of Columbia, and every listed code must have its own review record. The application trusts only Vercel's `x-vercel-ip-country-region` on a Vercel deployment. A missing, invalid or unlisted region fails closed with HTTP 451 at the web edge and ticket endpoint. Browser location, GPS and client payloads are ignored. IP geolocation can be inaccurate and is not residency proof; review that limitation before setting `US_STATE_LAUNCH_REVIEW_APPROVED=true`.

Do not set `US_STATE_LAUNCH_REVIEW_APPROVED=true` merely because this file exists. It records that the operator reviewed the exact limited allowlist. Changes to that list require a new review record and deployment verification.
