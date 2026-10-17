# Runbook: Needs reconciliation

A delivery shows **Needs reconciliation** when the app cannot know whether the provider accepted a create/update/cancel (timeout, 5xx, lost response, worker crash mid-call, 404 on cancel).

**Never** resubmit to "fix" it. Steps:

1. Open Calendar › Agenda; note account, local/UTC time and caption.
2. In Blotato, check the schedule queue and post history for that account around that time with that text.
3. Decide in the app (evidence text is required and audited):
   - **Found it** → *Attach provider IDs* (submission ID; schedule ID if visible). Delivery returns to Scheduled.
   - **Confirmed not accepted** (you checked queue and history) → *Allow one new attempt*. If the time has passed, the delivery becomes Needs rescheduling instead.
   - **Published or failed remotely** → for published, attach IDs then use *Check status*; otherwise *Mark failed*.
4. For a cancel that hit 404: the post may already have gone out — check history, then attach or mark accordingly.

Absence from a provider list is not proof of non-acceptance; prefer waiting and re-checking over a new attempt.
