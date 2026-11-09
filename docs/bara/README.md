# Bara workspace

Bara continues the existing Nima fork of T3 Code. Its web client and shared Electron
renderer keep the original event log, authenticated RPC, provider adapters, streaming,
attachments, file/browser panels, settlement, and scheduled-task services. The T3 Code
license and attribution remain intact. Studio uses a native web interface in this fork,
connected to the original Bara Rust engine as a separate local executable.

## Use the workspace

Run `vp run dev --home-dir /workspace/scratch/bara-preview-data --no-seed` and use the printed
pairing URL. Keep this isolated development state separate from a live T3 installation.
Keep the data directory outside a Git checkout so T3 can prepare independent scratch conversations.
The assistant opens directly to its conversation without a project selector. New
conversations use the existing scratch workspace. The assistant name, emoji/initial
avatar, timezone, and reasoning preference are under Settings → General → Personal agent.
These preferences and the assistant's conversation are owned by your primary Bara server
and shared across paired browsers. Existing browser preferences and the previous assistant
conversation are adopted on first opening. New assistants prefer GPT-6.1 Sol on an available
Codex connection, with Extra High reasoning where supported. Later model selections are kept.

The assistant initially shows today in its configured timezone. **View previous day** unfolds
one older day above the current messages, preserving your reading position. Date dividers
separate the days; scroll up to reveal another. Search still reaches the saved history. This changes the
view, not the provider session or saved memories. Type `@` to mention a registered project,
including its machine. A mention supplies project identity; existing tools and permissions
control access to its contents.

Personal agent settings also let you add, correct, and forget saved facts. Personal facts
belong to the everyday assistant; project facts are shared only within their project,
and thread facts stay in that conversation. Source conversation links stay attached to
facts. Competing edits show the current server version before you choose a correction.
Forgetting removes the saved text and sources, keeping only a key and revision marker
to reject old writes. It does not erase existing chats, provider history, or backups.

Ordinary turns recall a small relevant selection of authorized facts, including after a
model or provider switch. Native compaction and `/goal` commands keep their original
syntax; recall resumes on the next ordinary turn. Scheduled jobs need an explicit personal-memory
grant in Personal agent settings, even when they run in the assistant conversation.
Other working threads and delegated callers do not inherit personal-memory access.
Agents can read facts with `t3_memory_read`; remembering, correcting or forgetting through
`t3_memory_write` requires full access. You can always manage facts directly in settings
with the connection's settings permission. This foundation uses T3's existing execution
and scheduling services; it does not introduce another agent runtime.

Work → **Projects** lists registered projects across connected machines. **Add project** opens
the existing name, folder, or repository flow; choose the machine when more than one is connected.
Git must be installed on the selected machine to create or clone repositories. Creating or
adding a project opens its Work view; it does not create a conversation.
Open a project to see its sessions and start new work in that project. Projects are also available
from the profile menu, without switching the sidebar. Plain T3 servers still expose their saved
conversations; Bara coordinators and Inbox review require a Bara server on that machine.

Work opens actual conversations. The sidebar lists up to four active sessions; the Work destination
opens the full list. New sessions collect a title and objective, offer an existing Bot as coordinator, and open the
real composer. Personal Work needs no project; Project & environment lets you choose an existing
workspace when needed. Sending starts execution. Session details changes or clears the coordinator
when the session and its background tasks are idle. Each session keeps its own history and scoped
facts; a coordinator does not import other chats. Model and access choices remain in the composer.
A Bot's View work link opens its active sessions. Retiring a session keeps its history and Bot. Completed sessions and individual bot runs arrive in Inbox
with their actual result previews. Open the conversation to reply, settle a reviewed result,
or reopen a Focus session to return it to Work. New output makes that session unreviewed
again. Inbox review state and Focus names are saved on the server and shared across devices;
existing browser metadata is imported once.

Ask your assistant to start focused work or delegate a task. Its Work card follows the
real conversation's status and opens that session without interrupting other work.
Local direct delegations appear under Work; their completed results arrive in Inbox.
Nested agents stay inside their Focus session. Pending child results and follow-up work
keep a session active until its result is ready. Approval requests use T3's existing
controls above the assistant composer, or open the child conversation to answer them.
Automatic Focus Session completions stay compact in assistant chat; the detailed result
stays in its own conversation. Inbox shows a short overview with a link to the full result.
Linked-host cards keep the actual destination and the existing T3 review controls.

Settling an Inbox item does not stop a bot schedule or background execution. Retire uses
T3’s existing conversation settlement and remains disabled while a provider is active.
Requests needing approval or a reply appear separately in Inbox and open the existing
conversation controls. Its count includes results awaiting review and requests needing input.

Bots contains persistent teammates for personal or work tasks. Write a responsibility or choose
a starter, edit the name if needed, then create it. A project is optional. Click its row to chat, or open its settings to change
its avatar, instructions, timezone, or preferred model for a new conversation. Current model
and execution access stay in the conversation composer. Each Bot has a separate conversation;
returning to it resumes the saved history. Your everyday assistant has its own sidebar entry;
manage its preferences, memory and routines through Personal agent settings. Archiving a teammate keeps its
history and does not cancel active work; use Archived bots to restore it.

Bot settings → Advanced settings → Bara tool access lets you keep the existing permissions,
allow read-only Bara tools, or block Bara tools. It applies to that Bot's chat, Work and routines;
delegated workers inherit the stricter coordinator policy. Changes apply on subsequent tool calls.
Read-only also prevents starting/messaging workers, changing routines and executing supplied HTML.
Provider terminal/files and separately configured integrations still use the provider's execution
permissions. This is not a filesystem sandbox or a control for automatic memory preparation.

Ask the everyday assistant to create a teammate, for example “Create a Chef Bot for quick
vegetarian meals.” New chat-created Bots start with read-only Bara tools. Settings remains
the place to authorize stronger access. Advanced settings can restrict tool groups and project
resources, or ask for Inbox approval before changes. Review the exact arguments there; approval
allows one retry from the Bot conversation. You can decline, revoke or reopen a review.

Each teammate has editable saved memory in Bot settings. Its general knowledge follows it
between its own sessions without importing other project conversations. Reusable skills are
ordinary Library documents selected in Advanced settings; editing that document updates the
procedure for every assigned Bot. Archive or unassign it to stop supplying it. Optional
relationship recall retrieves relevant snippets, not entire chat histories.

Execution safeguards select ordered fallback models when the chosen provider is unavailable
before a run. Optional preparation retries handle transient connection failures without
repeating submitted work. Elapsed time and reported token/USD thresholds can request a stop;
provider usage is delayed, sometimes absent, and may include earlier conversation usage.
Keep actual spending controls with the provider.

Work → Project teams assigns existing Bots to any saved project and records an optional
responsibility in that project. A Bot can belong to several teams while keeping one identity.
Personal Bots and sessions still need no project. Team edits are saved with revision checks;
when another device changes the team, load the saved team before editing again.

Ask your assistant to assign an existing Bot to focused work. It discovers teammates through
the shared Bot directory, then uses T3 delegation for this checkout or launches a Work session
in the specified project. The Bot’s current instructions and matching project responsibility
apply in that session. Its relationship chat and other projects’ histories stay separate.
Bot work has server limits on worker concurrency, task count, nesting and launch retries.
Review a reported limit or failure before starting more work. Local Bot teams are supported;
Bot-managed work on another environment is not supported yet.

Open a Bot’s Routines link to give it a recurring responsibility. This includes the home
assistant through Personal agent settings. Create through conversation or set up manually.
Write its instructions, then open the schedule summary to change when it runs. The name is
optional and defaults to the first line of instructions; edit it directly to override it. Each run opens its own Work conversation, applies
the Bot’s current instructions, and delivers the actual outcome to Inbox. Review run history,
run manually, edit, pause/resume or delete the routine from the same view. Deleting a schedule revokes its personal-memory grant and
keeps its conversations and running work. A new owned routine defaults to Supervised execution;
Workspace & execution contains the real provider-supported access controls. A routine’s saved
model, access level and timezone remain explicit choices.

Routines persist on the Bara server, including while your browser or desktop is closed. The
backend host must remain online; a powered-off machine cannot execute jobs. Timed owned routines
wait or defer while their earlier work is unfinished. Archiving a Bot blocks new starts while
keeping its routines and authorized work. Existing unowned jobs remain available under Existing
routines and Settings, including Goal check-ins, manual runs, pause/resume and webhooks. Older
hosts must be updated before saving Bot ownership. Use a direct connection to the Bot’s host;
Bot-owned routine management through linked hosts is not supported yet. Conversation-based
creation of new persistent Bot identities remains planned.

The companion panel uses compact Browser, Files, Notes, Studio and Live Stream tabs.
Open Studio in the panel to keep the conversation beside any creative workspace. From full Studio,
choose Chat alongside to dock the same editor. Drag the divider or use its arrow keys to resize any surface up to the workspace width;
expand the panel when you need more room. On a phone, Studio uses the available screen and closes
when you attach a selection to chat. Use in chat attaches a saved artifact reference to the current
message without sending it. From full Studio, Chat opens a Focus Session and docks the
artifact beside it. Authorized Studio edits stream into the open canvas; they do not switch your
selected panel. Story and transcript drafts survive closing or switching panels, and changing
documents asks before discarding unsaved edits. Recording continues across panel and workspace changes until explicitly stopped.

It starts collapsed on assistant home until explicitly opened. Its selected tool and
manual visibility preference persist. Notes is a shared Markdown notepad on the primary
Bara server. Notes renders Markdown in place as you write. Syntax is
editable on the current line and hidden when you move away. Headings, emphasis, lists,
checkboxes, tables and fenced code keep their plain Markdown source. Ctrl/Cmd+B and
Ctrl/Cmd+I format a selection; Ctrl/Cmd-click opens a link. Edits autosave to the server
and stream to other paired browsers. A local
recovery draft is kept immediately, including while disconnected. The editor remains
mounted when switching tools, closing or expanding the panel. Browser and Files use the
existing per-thread panels inside the same companion surface after a conversation is
saved; resource tabs and server browser sessions are retained. Expanding a surface keeps
the conversation mounted underneath. Both sidebars retain collapse controls; the right
panel also supports pointer and arrow-key resizing. Tool tabs support arrow keys and
Home/End, with accessible tooltips. Search uses the existing command palette and shortcuts.

Coding-specific project controls appear in Work threads rather than assistant home.
The model menu retains execution permissions, with the personal reasoning preference
accessible inside it. Account and Settings stay in the sidebar footer; workspace files
and agent controls remain available through the Account menu.

## Persistence and current limits

The original `nima:workspace:v1` storage key is intentionally retained. Existing daily
threads, drafts and focus labels survive the rebrand. The latest daily
conversation is offered for adoption by the server, and previous planner notes are
retained and copied into the notepad. Plan Day and Calendar are not exposed.

Notes is stored in the server database, shared by clients paired to that host. Existing
browser notes are imported if the server notepad is empty. A differing local draft is kept
for review instead of replacing server notes. Concurrent edits show the server version and
let you choose which version to keep; revision checks prevent silent overwrites. Writes
need the connection's file write permission; reads need file read permission.

Agents use `t3_notes_read` and `t3_notes_write` through the existing MCP connection. Writes
require full access and the revision returned by the read. Read-only, approval-required,
and plan-mode callers cannot modify this shared document. Tools return conflicts with the
current note so an agent can reconcile its edit. Notes supports up to 200,000 characters;
raw HTML is not executed in the Markdown preview.

Goals shows ongoing commitments under Tracking and longer-term outcomes under Goals,
with a short update beneath each one. Type a goal and press Enter to save it. Use Plan in
chat or Goal ideas to work it out with your everyday assistant instead. The assistant can
save an agreed goal and update its plan and progress.
A model must be connected for the conversation; if sending is unavailable, the request
stays in the normal composer. An existing unsent message is preserved.

Click a goal to inspect its saved plan, milestones and progress, or discuss it with your
assistant. Complete, pause, reopen, archive and restore goals without deleting their
history or stopping background work. Goals are shared on the primary Bara server.
Existing browser goals are imported once, with the original browser data retained.
Local recovery drafts and revision checks protect offline and concurrent edits.

Agents can list, read and update goals or append progress through the existing MCP
connection. Reads require file read access; writes require full access and file write
permission. Open a goal and choose Add check-in for a daily or weekly nudge. Pick the time and day;
the check-in uses your configured timezone and an available model. It is a real Bot,
so you can change its model or instructions, pause it, run it now or delete it in Bots.
You can also ask the assistant to create a check-in in chat. Existing guidance alone
does not activate a schedule.

Check-ins read the current goal and progress through permission-checked goal tools,
suggest one next step, and arrive in Inbox with a link back to the goal. The server
must be running at the scheduled time. Paused, completed or archived goals wait without
launching check-ins; reactivating a goal allows the next scheduled check-in. Existing
running work and other bots continue. Preferences do not grant tool permissions.

Library holds your documents. Create a document, write with live Markdown rendering, search
its full text, and archive or restore it. Pages are saved on the selected Bara server;
unsaved recovery drafts stay on the device and continue saving as you navigate. Concurrent
browser or agent edits preserve your draft and let you choose which version to keep.

Save to Library on a completed Work or Inbox result copies the full text and keeps a link
to its source conversation. Files, previews and tool activity remain in that conversation.
Agents can find, read and edit pages through the shared tools, with existing file read/write
permissions and revision checks. Saving a result also requires conversation read access.
The Notes surface remains a quick notepad.

Choose Work on this in a Library document to open a Focus Session with its current
Markdown attached, including unsaved edits. Describe what you want in the composer,
choose a model and send to start. Completed work appears in Inbox and can be saved
to Library. The attached snapshot includes a link back to the original document.

## Studio

Open Studio for Design, Photo, Story, Motion, Live and Recordings.
Choose a workspace from the menu in Studio's header. Chat alongside docks Studio next to
your conversation. Chat on a selection attaches its saved reference to your message without
sending it. From full Studio, Chat opens a separate Focus Session. Choose a model and send to begin.
The editor and media session stay open when you return to the conversation.
Ask for the change in chat after attaching the selection. Authorized tool calls show when
artwork is being read or edited; Updated from chat appears only after the saved canvas arrives.
Undo and Redo use the same history for your edits and agent edits. A selection reference does
not grant permissions or approve an action.

Design and Photo documents save
on the selected Bara server as you edit. Create a canvas, import a PNG or JPEG, draw
shapes or paths, and select layers for typography, layout, components, masks and image
adjustments. Select an object for quick controls. Double-click text or press Enter to edit it on
the canvas; Enter saves, Shift+Enter adds a line, and Escape cancels. If another window edits the
same text, your draft stays available while you choose the saved version or keep your changes.
For images, Crop lets you drag the area to keep. Properties holds precise crop, layout and
advanced settings. On a phone, it opens below the canvas and can be expanded or closed.
Undo and redo use the engine's saved history. Export a whole canvas from
the toolbar, or a selected layer from Properties. Archive and restore retain originals.

In Story, add scenes, write scripts and arrange timed shots. Add saved artwork to a
shot as a pinned copy: later edits to the original do not silently change the shot.
Save the story before refreshing shot previews or exporting the HTML/Markdown/PNG
bundle. Create motion turns a saved Story into an editable 24 fps sequence. Adjust shot
timing and camera movement, import WAV/MP3 audio, trim it, set fades and export MP4.

Live keeps scene names, sources, transforms and audio settings on the server. Screen,
camera and microphone feeds use this browser's explicit device permissions. Record saves
the composed program to your device. Navigation within Bara keeps active media running;
use the sidebar's activity link to return and stop it. Closing or reloading the browser
ends that media session. To broadcast, supply a streaming provider's HTTPS WHIP endpoint
and optional bearer token. The token stays in memory. RTMP destinations require a separate
relay and cannot be entered directly. Provider support, network reachability and CORS still
apply. Native sample-clip export contains saved generated/image/text sources; record in
the browser when using camera or screen feeds.

Paths have draggable curve handles and contour controls. Story characters can bind a saved
artwork rig; Motion can apply that character to matching artwork and edit joint poses and
keyframes. Instances preserve their own rigs when a character template changes.

Recordings imports videos for offline transcription. After the host's local speech model and
interpreter are configured, edit transcript text and the clip's start/end, then export MP4,
SRT and JSON. Save transcript/trim edits before using Preview clip to watch the saved MP4 in Bara.
Leaving with unsaved transcript edits asks before discarding them.

Originals stay on the host. Closing the client leaves transcription running;
Cancel explicitly stops it. A host restart preserves the source and offers retry. Current
video downloads stream through authenticated links; FFmpeg is required for video exports.
See Studio setup for local transcription prerequisites.

Agents can inspect Studio capabilities and edit native artwork, Story, Motion and saved
Live scenes through the existing MCP connection. File permissions and full-access checks
remain authoritative; agents cannot turn on browser devices or start a broadcast.
The editors use native engine operations from this fork’s web interface. No Rust interface is embedded. Engine setup and export
limits are in [Studio setup](../operations/bara-studio.md).

Provider and integration settings remain the source of truth for connections. The desktop
build uses Bara's own application identity, profile and icons. See [Desktop setup](desktop.md).
Native mobile navigation keeps upstream behavior.

## Validation

Run the affected packages' typechecks, scoped lint and focused Studio/permission tests. Build the web
client with `vp run --filter @t3tools/web build`. Use the free Replay (dev) provider for
execution verification. Visual inspection should include empty assistant, real Work and
Inbox threads, bots, goals, both themes, panel switching/resizing and a narrow window.
