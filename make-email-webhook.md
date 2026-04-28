# Make scenario: Work-dispatch email webhook

Three Be Here planner pages (`laundry-run.html`, `checker.html`, `rota-planner.html`) let the planner preview a batch of day-sheet emails and POST them to a single **Make.com custom webhook**. This doc specifies the contract.

The webhook URL is stored client-side in `localStorage['beHere_sendWorkWebhook_v1']`. The planner pastes it once via the ⚙ button in the header.

## Request

**Method:** `POST`
**URL:** your Make custom-webhook URL
**Content-Type:** `application/json`

**Body:**
```json
{
  "kind": "laundry" | "laundry-linen" | "laundry-dirt" | "checker" | "cleaners",
  "title": "Day sheet — Mon 28 Apr",
  "sentAt": "2026-04-23T10:11:12.345Z",
  "sentBy": "https://be-here.example/guest-arrivals/rota-planner.html",
  "emails": [
    {
      "to":       "dave@example.com",
      "name":     "Dave",
      "subject":  "Your day — Mon 28 Apr",
      "bodyHtml": "<p>Hi Dave…</p>",
      "bodyText": "Hi Dave…"
    }
  ]
}
```

Field notes:

- `kind` is a free-form tag. Use it in Make for filtering or routing if you want different signatures per sheet type.
- `title` is the planner-facing title shown in the preview — useful as a subject-line prefix or as a log field.
- `emails[].to` is always a real email. Recipients without an address on file are filtered out client-side before POST.
- `emails[].bodyHtml` is safe HTML (planner-authored). `bodyText` is a plain-text fallback for clients that don't render HTML.

## Make scenario shape

```
Webhook (Custom)
   └─ Iterator — Array: {{1.emails}}
       └─ Email — Send an Email
             To:        {{7.to}}
             Subject:   {{7.subject}}
             Content:   {{7.bodyHtml}}
             Content type: HTML
             Plain-text alternative: {{7.bodyText}}
```

### 1. Webhook (Custom)
- Structure data: run once with a real POST from the planner (click "Determine data structure" then click Send in the preview).
- Response: leave default (Make will auto-ack `Accepted`).

### 2. Iterator
- **Array:** `{{1.emails}}` — the array from the webhook body.
- Downstream modules run once per recipient.

### 3. Email — Send an Email (Gmail / SMTP / Microsoft 365)
- **To:** `{{2.to}}`
- **Subject:** `{{2.subject}}`
- **Content type:** HTML
- **Content:** `{{2.bodyHtml}}`
- **Plain-text alternative:** `{{2.bodyText}}` (tick "Send plain text alongside HTML" in Gmail / set `AlternativeText` in SMTP)
- **From name:** e.g. `Be Here Stays`
- **From address:** a shared mailbox (e.g. `rota@be-here.travel`)

### Optional — Slack / SMS fallback
Add a Router after the Iterator to branch on `{{1.kind}}` or on driver name. Example: route `kind = "laundry"` to an SMS send, `kind = "checker"` to email, etc.

## Response contract

The planner checks `response.ok` — any 2xx is treated as success. Make's default "Accepted" response is fine. If you want to surface per-email send counts, return JSON like:

```json
{ "sent": 7, "failed": 0 }
```

The planner shows whatever you return in its status chip for 1.5 s before closing the modal.

## Testing

1. Paste the webhook URL into the ⚙ dialog on any of the three planner pages.
2. Hit "Send X" in the preview modal.
3. Check the scenario's execution log — you should see the full payload body under the Webhook module's output.
4. Verify that Make's Email module was invoked once per recipient and each landed in the recipient's inbox.

## Security notes

- The webhook URL is a shared secret — anyone with it can send work emails. Keep it out of screenshots and chat threads.
- To rotate, generate a new custom webhook in Make, paste it into the ⚙ dialog on each planner device, and delete the old one.
- The planner runs entirely in the browser — no auth header is added to the POST. If you need auth, change the scenario's webhook to require a query-string token and add the token to the URL saved in settings.
