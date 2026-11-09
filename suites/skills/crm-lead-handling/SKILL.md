---
name: crm-lead-handling
description: "Brightline Realty's CRM playbook: lead scoring, tiers, follow-up template codes, Indian phone normalisation and contact de-duplication. Use for ANY task that scores, tiers, cleans, merges or picks follow-ups for leads or contacts."
version: 1.0.0
author: agent-evals
license: MIT
metadata:
  hermes:
    tags: [CRM, leads, sales, scoring, data-cleaning]
---

# CRM lead handling (Brightline Realty playbook)

These are the agency's house rules. They are NOT industry standard: do not
substitute your own judgement, point values or template names. Apply every
rule exactly as written.

## 1. Lead score

Add up the points from three fields, then apply the phone penalty.

| Field | Value | Points |
|---|---|---|
| `budget_inr` | 500000 or more | 40 |
| | 100000 – 499999 | 25 |
| | below 100000 | 5 |
| | empty / missing | 0 |
| `source` | `referral` | 30 |
| | `google_ads` | 20 |
| | `organic` | 15 |
| | `cold_list` or anything else | 0 |
| `timeline` | `this_month` | 20 |
| | `this_quarter` | 10 |
| | `later` or anything else | 0 |

**Phone penalty:** subtract 15 if the lead has no usable phone, meaning the
phone is empty or normalises to `INVALID` (section 4).

**Floor:** the score never goes below 0.

## 2. Tier

| Score | Tier |
|---|---|
| 70 or more | `hot` |
| 40 – 69 | `warm` |
| below 40 | `cold` |

The boundaries are inclusive at the bottom: 70 is `hot`, 40 is `warm`.

## 3. Follow-up template

| Tier | Template code |
|---|---|
| `hot` | `T1-CALL-24H` |
| `warm`, `whatsapp_consent` = `yes` | `T2-WHATSAPP-3D` |
| `warm`, `whatsapp_consent` anything else (`no`, empty) | `T2-EMAIL-3D` |
| `cold` | `T3-NURTURE-EMAIL` |

Consent only matters for warm leads. A hot lead is always called; a cold
lead always gets the nurture email.

## 4. Phone normalisation (India)

1. Remove spaces, dashes, dots and brackets.
2. If it starts with `+91`, remove the `+91`.
   Otherwise, if it is 12 digits starting with `91`, remove the `91`.
   Otherwise, if it is 11 digits starting with `0`, remove the `0`.
3. What is left must be exactly 10 digits and start with 6, 7, 8 or 9.
   If so, the result is `+91` followed by those 10 digits.
   If not, the result is the string `INVALID`.

## 5. Email normalisation

Trim surrounding whitespace and lowercase the whole address.

## 6. Duplicate contacts

Two records are the same contact if they share a normalised phone (not
`INVALID`) **or** a normalised email.

When merging a group of duplicates:
- keep the record with the most recent `updated_at`: its `id` and all of its
  other fields win;
- `tags` become the union of every record's tags (`;`-separated in CSVs),
  sorted alphabetically, without duplicates.

## Worked examples

| budget_inr | source | timeline | phone | consent | Score | Tier | Template |
|---|---|---|---|---|---|---|---|
| 750000 | referral | this_quarter | 98200 11223 | no | 40+30+10 = 80 | hot | T1-CALL-24H |
| 300000 | google_ads | this_month | 98200 11224 | yes | 25+20+20 = 65 | warm | T2-WHATSAPP-3D |
| 750000 | organic | this_month | (empty) | no | 40+15+20−15 = 60 | warm | T2-EMAIL-3D |
| 300000 | organic | later | 09876543210 | no | 25+15+0 = 40 | warm | T2-EMAIL-3D |
| 50000 | cold_list | later | 12345 | yes | 5+0+0−15 → 0 | cold | T3-NURTURE-EMAIL |

Phones: `98200 11223` → `+919820011223`; `+91-98200-11223` → `+919820011223`;
`919820011223` → `+919820011223`; `09820011223` → `+919820011223`;
`12345` → `INVALID`; `5820011223` → `INVALID` (starts with 5).

## Output conventions

Unless the task says otherwise: scores are integers, tiers and template
codes are exactly the lowercase/uppercase strings above, and phones are
written in the normalised `+91XXXXXXXXXX` form.
