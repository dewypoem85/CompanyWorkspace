# Schedule task action writes

Task detail archive, restore, and comment deletion are checked writes. They use the common `workspace-form-v1` JSON transport and document form session rather than private API helpers.

## Captured intent and preflight

- Capture the actor identity, task or target-comment snapshot, attachment snapshot, state token, and exact JSON body before confirmation.
- Re-read both the task detail and the current company identity before opening the confirmation dialog. A changed actor, permission, task, comment, attachment set, version, or state token cancels the write.
- Archive and restore send `X-Workspace-State`; delete-comment sends `X-Workspace-Target-State`. Every request also sends the actor and CSRF headers.
- The exact JSON body is `{version}`. Confirmation cancellation, route changes, scope changes, unmount, and stale preflight must not send a request.

## Server boundary and acknowledgement

- Baseline reads, authorization and version checks, the mutation, audit log, and acknowledgement capture stay in one database transaction. Return the response only after commit.
- Archive and restore acknowledge the full task and all task-body attachments, plus the previous and new state tokens.
- Comment deletion acknowledges the full deleted comment, including its incremented version and edit timestamp, and confirms that its attachments were detached. Replies and audit records remain.
- Legacy clients keep the existing single task response for archive/restore and HTTP 204 for delete-comment. Enhanced callers receive the common saved envelope.

## Failure rules

- Invalid input and authorization failure happen before a write. Conflicts require an explicit fresh read.
- A sent request without a valid full acknowledgement is unknown and must not retry automatically. Reopening the detail drawer in the same document does not clear that lock.
- A valid acknowledgement followed by a failed list/detail GET is still a saved result. Retry only the read; it must not retry the write.
