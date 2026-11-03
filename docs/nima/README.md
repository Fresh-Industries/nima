# Nima foundation

Nima, by Fresh Industries, is a personal workspace built around a daily conversation,
focused work, and a quiet inbox. This branch starts from T3 Code commit
`61c3794c32b0eeebfac09add43e403618c65d2d7`, which matched upstream HEAD when inspected.

## Use the foundation

Start with `vp run dev --home-dir /workspace/nima/.t3-nima --no-seed` and open the
pairing URL printed by the runner. This directory is isolated development state.
Do not point development at a live T3 installation or import user data.

Add a project through **Projects & agent controls**. In Today, begin the day's
conversation and choose a provider in the existing composer. **Personalize** sets
the Chief of Staff display name independently from Nima and accepts an IANA timezone.
The day rolls over using that timezone, including after the browser resumes.

**Plan Day** stores daily notes and priorities. Tasks support editing, completion,
deletion, and accessible up/down reordering. Pick a date or a previously saved plan
to revisit it. Plans save after each edit; a storage write failure shows an error.

**Work** lists active conversations. New focus sessions collect a title, objective,
and project, and show related active titles before creation. The objective is placed
in the existing draft composer; sending it starts the agent. An unsent session remains
a draft in the project explorer. Review moves work to Inbox; Retire settles it on the
server. Neither action deletes the conversation. Active provider runs cannot be retired.

**Inbox** includes sessions marked for review, settled conversations, requests for input or approval, proposed plans, and previous
saved daily conversations. Search matches loaded thread titles, objectives, project
names, and latest message excerpts. Open a conversation to read or reply, settle it,
or reopen a focus session. Daily conversations remain in history when revisited.
The archive link opens the existing archived-thread browser and restoration workflow.

## Architecture and ownership

The web client, also used by Electron, keeps T3's resizable and collapsible left
sidebar and adds Today / Work / Inbox navigation. The existing project explorer,
settings, command palette, and agent controls remain accessible. The center renders
the original `ThreadRouteView` / `ChatView`; draft promotion and streaming keep their
original routing. The collapsible right utility panel can be resized with a pointer
or arrow keys. Files and Browser open the existing thread panels rather than a new
filesystem or browser implementation. Dialogs use Base UI focus management.

T3's event log, SQLite projections, authenticated environment RPC, orchestration,
provider adapters, checkpointing, and settlement commands remain unchanged. Projects
still refer to directories on their owning environment. They are organizational
containers, not privacy boundaries. Existing server permissions remain authoritative.
No new unrestricted tool access is granted.

`apps/web/src/nima/store.ts` adds daily plans, daily thread references, focus labels,
review intent, and display preferences. It uses a versioned browser storage key.
Daily thread references include the environment and thread ID plus the draft ID;
promotion resolves through T3's existing draft infrastructure. Focus metadata uses
scoped thread keys. Execution status is read separately from the thread runtime. Named Nima sessions opt out
of empty-draft reuse so an unsent daily conversation cannot be reused for a focus session.

## Delivery and limits

- Shell: implemented for web and the shared desktop renderer. Native mobile navigation,
  desktop packaging, installers, and OS icons retain upstream behavior and branding.
- Plan Day: functioning local persistence. This is browser storage, not a server model,
  backup system, cross-device sync, or an agent-accessible tool. Clearing browser data
  removes plans, daily mappings, focus labels, and review intent, but not server threads.
- Work / Inbox: real threads and server settlement. Review labels are client-local.
  Lists and search currently cover loaded, visible thread shells; comprehensive history
  pagination and full-text search require backend integration. Archived history uses the
  upstream restoration screen. Completed turns do not automatically retire focus sessions.
- Focus sessions: manual creation, opening, review, retirement, and reopening. Dedicated
  coordinators, execution-agent assignment, durable handoff summaries, semantic duplicate
  detection, and Chief-of-Staff orchestration have not been implemented. Similar-title
  suggestions are a first guard against duplicating active work, not semantic matching.
- Shared knowledge and a unified tool registry are future work. Tools links to existing
  provider and integration settings. The Chief of Staff name currently changes display only.
- Daily uniqueness and lifecycle labels are local to this browser. Multi-tab conflict
  handling, server-owned day identity, and cross-client lifecycle synchronization remain.

The next milestone should move planner records, day identity, and focus lifecycle into
an authenticated server service and contracts, with migrations and an explicit agent
read/write API. Keep lifecycle separate from runtime execution and implement permissions
at that service boundary before adding autonomous coordination.

## Validation

Focused tests cover timezone midnight/DST boundaries, immutable task reordering, and
storage restoration of notes, task edits/completion, and preferences. Run
`vp test run apps/web/src/nima/store.test.ts` and `vp run check:changed`.
`vp run --filter @t3tools/web build` checks the production bundle.

The repository requires its built-in Browser panel for integrated visual verification.
Those tools are absent in this environment, so visual layout, interactive navigation,
refresh/restart in a browser, and desktop behavior still need that verification pass.
A successful build and HTTP response do not establish visual or end-to-end UI correctness.
