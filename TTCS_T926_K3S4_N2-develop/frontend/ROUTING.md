# Vanilla frontend routing

`index.html` contains the authenticated shell, toast root and empty fragment slots.
`js/app.js` mounts the fragments, loads the scripts once and starts the History API router.
`routes.json` is the shared URL/permission/module manifest used by the browser and Node server.
`js/router.js` resolves URLs, guards authentication/access and handles browser history.

Page markup is in `pages/`; page behavior is in `js/pages/`. Reusable dialogs are in
`components/` and `js/components/`. `js/services/session.js` owns the existing session
flow; `js/api.js` preserves the REST client. Shared state/helpers are in `js/shared/`.

Pages use retained DOM: every fragment is mounted once, then its module binds once.
Changing route activates the existing page and reloads its data; it never rebinds
listeners. This preserves unsaved form/filter state and cross-page dialog workflows.
`js/shared/route-lifecycle.js` closes dialogs and cancels page timers/object URLs when
leaving. Session heartbeat remains application-wide. Scripts currently share the
original lexical bindings to preserve existing behavior; they are classic browser
scripts, not a framework or a build pipeline.

To add an actual page: create its HTML and JS files, add its fragment slot in the
shell and its route/script entry to the manifest. Use the backend navigation menu
for permission-controlled pages. Backend REST authorization remains authoritative.
Do not introduce API calls during module initialization; load data on activation.

Browser document GETs use `Accept: text/html`, including refresh/deep links. Several
paths are also historical REST aliases; JSON requests to those paths retain their
existing API behavior. `/api/*`, unknown paths and missing assets never fall back
to HTML. Asset URLs in the shell are absolute.

Existing modals (user CRUD/import/roles/lock/handover, requisition CRUD/draft,
candidate/interview/offer actions, profile/avatar/password, audit detail) remain
components. Forgot password/OTP and reset password use their existing dialogs at
`/forgot-password` and `/reset-password`; email/token rules remain in the backend.

Run `npm run test:routing` in an isolated source/dependency TEMP copy, without
`.git`, `.env` or runtime databases, as required by the existing Sprint 2 tests.
The regression fixture loader reads the actual extracted files; assertions and
case counts in the existing suites are unchanged.
