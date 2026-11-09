# Bara Bot identity boundaries

T3 already owns provider sessions, durable threads, turn preparation, MCP connections,
subagent lineage, approvals, scheduled-task dispatch and run history. Persistent Bot identity
is configuration above that runtime, not another runtime. The home assistant is the `primary`
Bot in the same store. Its existing PersonalAgent API remains the memory and compatibility
boundary; both settings surfaces edit one row under one revision counter.

A Bot has no project foreign key. Its relationship conversation is a normal T3 thread in the
internal scratch workspace. Failure to prepare scratch must fail opening rather than silently
select an unrelated repository. A Work coordinator association belongs on the existing thread metadata, with its own revision
and optional project scope. Creating Work reserves that metadata before T3 exposes the thread;
its first turn therefore cannot race ahead of its coordinator configuration. Personal Work uses
scratch storage; project Work uses that project's existing resources. Changing a coordinator
never moves a thread between repositories or imports the Bot's other conversation transcripts.
Project teams reference existing Bot IDs in a many-to-many membership table. The optional project responsibility is read at turn preparation only for that Work session’s matching project; it does not change the Bot’s general configuration or grant access.

Relationship conversations use the existing `assistant` review metadata kind so they stay out
of Work/Inbox while their direct delegated children retain the existing review path. This
metadata kind means an assistant relationship, not permission to read the home assistant's
memory. Only the canonical `primary` thread has personal-memory access; other Bots recall their own Bot-scoped facts and the current thread, not shared scratch
project facts. Only their canonical relationship can promote facts into the Bot scope; Work
may read that expertise but cannot promote project secrets into it. Optional relevant
relationship snippets exclude other Work and pause when forgotten facts exist. A scheduler-stamped turn can
add personal facts only through the existing explicit per-job grant. Provider-native history forks
from Bot relationship conversations are refused through the existing portable-context path.
Work recalls its thread facts, the coordinator’s general Bot facts and its authorized project
facts. Personal sessions exclude project facts. A coordinator supplies current configuration, including when archived,
so archiving a reusable Bot cannot silently change or stop existing Work. Clearing a coordinator
replaces its earlier context snapshot on the next turn. Work configuration revisions are separate
from Inbox result versions. Coordinator changes require an idle session and compare the expected
revision inside the database transaction. The activity gate includes app-owned children, native
background work and pending completion delivery; Inbox waits for that work to finish.

Bot instructions are prepared afresh at the common turn boundary for every supported provider,
including scheduled turns. Existing runtime modes and MCP authorization remain authoritative.
Bot tool access is an additional ceiling at the shared MCP registration boundary, including
custom image tools and calls forwarded to another environment. Production registers all tools
with the guard; low-level toolkit fixtures can omit it. Read-only admits only reviewed observation
tools with a read-only hint: hints alone are not authorization, and HTML rendering executes supplied
code. New tools require review before admission. Allowed never bypasses existing authorization.

Policies are read from SQLite on each invocation, independently of provider credentials. Relationship
threads use their Bot; Work and routine runs use their current coordinator. Bara delegation and native
subagent lineage inherit the strictest ancestor policy, even when a child uses another Bot. Cycles,
overlong ancestry and storage failures refuse access. Policy changes govern subsequent calls, not
already-authorized work. This is a Bara MCP boundary, not a sandbox for provider-native shell/files,
directly configured external MCP, or automatically prepared authorized memory. Restrict those through
the existing runtime/provider permissions. Read-only cannot create/update jobs or start/message workers;
this avoids transferring work outside the policy lineage. Existing routines use their current owner.

Migration 091 adds an access column with the compatible `allowed` default. Old client writes that omit
the optional field preserve its saved value; home compatibility writes never touch it. Bot revisions
protect policy edits against stale writes. The host capability gates the UI on older servers.

Migration 087 copies the original assistant row into `workspace_bots`, retains the old table as
`personal_agent_legacy`, and provides a read-only `personal_agent` compatibility view for the
existing review views. The migration preserves the canonical thread, revision, generation,
configuration, memory tables, jobs, and event history. It must rebuild dependent review views
around the rename because SQLite validates view references during ALTER TABLE. Older builds
that write the former singleton table cannot write this migrated database; use an offline
pre-upgrade backup if reverting to them.

Migration 088 adds coordinator, optional scope and configuration revision to the existing metadata
table, preserving its previous values. It wraps the existing Inbox result view with the Work
activity gate. The legacy Inbox `botId` still identifies a scheduled job, not a persistent Bot;
coordinator references use the separate `coordinatorBotId` field.

Migration 090 adds nullable Bot ownership to the existing scheduler rows. Legacy jobs remain
unowned and keep their binding behavior. Owned routines require a fresh conversation per run;
T3’s existing dispatch, durable timing, webhook deduplication, restart recovery and run history
remain the execution path. The scheduler reserves Work metadata before launch so the first turn
uses the owner’s current identity and only the run’s authorized scope. Scratch is a personal
scope, never a fallback repository. The main assistant and Bot relationship histories stay separate.

A routine keeps its configured model and runtime access; changing a Bot’s preferred model does
not silently change an existing job. New fixed-time owned routines default to the Bot’s timezone
and persist it. Existing saved timezones stay fixed on edits. New owned routines in the Bara UI
default to Supervised access; the advanced selector uses actual provider and managed-policy modes.
Personal-memory grants remain explicit per job; owning a routine does not grant personal facts. Deleting a job revokes its grant in the deletion transaction, including thread-owned job cleanup, without deleting saved facts or conversations.

Timed owned routines do not overlap unfinished work, including held turns and pending child
delivery. A busy one-time occurrence stays due for a later retry; interval/fixed-time jobs defer
to the next occurrence. Webhook routines retain the existing distinct-event queue and deduplication
semantics. Archiving an owner prevents new starts and defers timed occurrences without deleting
the routine or canceling authorized work. Ownership changes affect future runs; an older save
cannot restore a former owner or bind an owned job to a relationship chat. Bot-owned management
over peer links is refused; direct authenticated connections to the owning host are supported.
Persistence alone does not run jobs while the backend is off: desktop-independent routines need
an online Bara host/service using that same scheduler and provider credentials.
Bot-managed MCP launches and local delegated tasks reserve their Work configuration before T3
can execute the first turn. Migration 089 stores project teams and idempotent delegation
reservations. Admission is transactional: concurrent reservations count as workers, and the
existing Work activity view holds capacity through pending child delivery. Acquire/use/release
reconciles failed or interrupted launches; startup recovers interrupted reservations without
restarting work. An accepted retry keeps its original thread and cannot change its objective,
project or assigned identity. No automatic retries or alternate runtime are introduced.

The server environment variables `BARA_BOT_MAX_DEPTH` (3), `BARA_BOT_MAX_CONCURRENT` (4),
`BARA_BOT_MAX_TASKS` (20) and `BARA_BOT_MAX_ATTEMPTS` (2) bound app-created Bot work.
Concurrency is shared across Bot work on the host. Task totals apply to the objective’s Work
root; relationship conversations start a fresh objective budget per initiating turn. These are
creation/admission limits, not token-spend accounting or controls over provider-native internal
workers. Bot-managed remote delegation is refused until that boundary can preserve these limits;
ordinary T3 remote delegation is unchanged. Team membership is organizational: existing T3 MCP
access, runtime ceilings, approvals and linked-caller fences remain authoritative. Additional group/resource ceilings and soft execution safeguards reuse this same boundary. Mavo/Osef should enter through permissioned shared connectors, not embedded runtimes.

Migration 092 adds compatible Bot capabilities and exact-action review records. Tool-group
rules and optional project allowlists intersect all coordinating ancestors. Approval grants
one attempt of the exact arguments on the original thread, under current Bot revisions and
Work/project configuration. Changes invalidate the grant; it expires after 24 hours. Existing
provider and MCP permissions still apply, including after approval. The user initiates the
retry rather than a new worker resuming arbitrary failed side effects automatically.

Migration 093 preserves facts/revisions/tombstones while adding Bot scope to SQLite memory.
Library pages are the shared skill store: selected current titles, revisions and bounded
excerpts enter turn context, with full text available through existing authorized page reads.
No duplicated skill copies, embeddings service or second agent runtime are needed. Primary
chat can create conservative read-only Bot identities and edit permitted identity fields;
it cannot grant tool/execution privileges through those management operations.

Fallback selection happens before a fresh run is committed. Only configured available,
authenticated and project-enabled providers are candidates; steering and receipt replays retain
the original selection. Transient thread preparation may retry at most twice. Prompt submission
and tool actions are never automatically repeated. The backend checks persisted active Bot runs
against configured elapsed time and provider-reported conversation tokens/USD. Reports may be
missing or delayed, and include earlier conversation usage; these are soft stop thresholds,
not hard billing budgets. One failed stop does not prevent checking other runs.
