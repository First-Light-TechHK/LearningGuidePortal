# Study Group architecture

Design for Oliver Zhang. Sources are PRD v0.10, the locked decisions below, and branch `cursor/study-group-backend-7481` at `18a1046ec71853f77d1b73eda545526c58964826` ([PR 37](https://github.com/LibertychaserUS/LearningGuidePortal/pull/37)). Diagrams are in `study-group-uml.md`. Technology choices are in `study-group-tech-selection.md`. The later AI Tutor phase is in `study-group-ai-tutor-plan.md`. Later closed choices are in `decisions.md`.

## Closed decisions

- Chat stays in LiveKit. No chat row.
- One meeting record per meeting. No token audit table. One encrypted log line per issuance. The line has no raw token and no API secret.
- A Live Session holds at most 6 people including the Host. The Host sets the Session maximum from 2 to 6. Admission is first come, first served by the time the server receives the enter request.
- AI Tutor is the shared Related Course tutor in a Live Session. The queue is per Live Session only: an item is the user id, session id, original text and server receipt time. One question is delivered at a time, in server receipt order; later questions do not cancel or merge earlier ones. There is no private per-user tutor or course-wide tutor identity. The service performs lexical retrieval over existing published lesson text and existing Course Knowledge files; it does not create a new knowledge base or parse participant screens. When context is sufficient, it makes one direct OpenRouter-compatible chat-completion call with a server-side grounding prompt. The answer re-enters the room as one shared reliable LiveKit data message with no destination list. No agent framework is used. Tutor request ownership, retry and terminal-failure state are durable so two application instances cannot make duplicate model calls or leave later questions blocked. The API key pool switches away from authentication, rate-limit and quota failures; raw keys never enter the repository, logs or browser.
- The Host manages the Group only outside the room. In the room the Host has the same permissions as a participant. The LiveKit token has no Host label.
- Session Title is required and is at most 20 characters. That is the Figma counter `7/20` on frame `599:1806`. The longer sample title on that frame is not the limit. PRD v0.10 does not state another length. The branch still rejects a Session Title over 80 characters in `scheduleSession` and `editSession`, and the schedule input has no `maxLength`.
- Planned duration is required. The Host chooses 30, 45, 60, or 90 minutes. Those choices are stored as 1800, 2700, 3600, and 5400 seconds. There is no other duration. The Figma session card shows `45 mins`. Branch `18a1046` still stores `durationMinutes` and accepts any integer of at least 1.

## Layers

| Layer | Owns |
|---|---|
| UI | Study Groups pages, forms, Session Full, Waiting for Host Start, and the room. Sends HTTP. Connects to LiveKit with the returned token. Sends Chat and Raise Hand as LiveKit data. Does not decide Course access, capacity, or the token grants. |
| Route Handler | Parses the body, reads the session, calls the application service, returns `{ ok, code, message, data }`. |
| Application service | Course access, Host and Member rules, Session state, the 2–6 cap, request-time order, meeting creation, token signing, the encrypted line, seat release when signing fails, and appending one tutor-queue item. It does not call a model. |
| Repository | Study Group, membership, Live Session, attendance intent, presence, the one meeting row, reminders, the issuance log line, and the session-scoped tutor queue. Nothing in this phase reads that queue. |
| LiveKit | The room, audio, video, screen share, presence on the wire, and data messages, including Chat. It does not store Group rows, it does not count seats, and it does not drain the tutor queue. |

Course access is read from Entitlement. Group Study does not write Entitlement. Notifications for cancel-group and the T-10 reminder go through the existing notification and mail services. The service decides who is in the audience.

## Request path

A signed-in learner opens `/[locale]/portal/study-groups`. The page calls `GET /api/study-groups?view=mine|discover|courses` and `GET /api/study-groups/:groupId`.

Create, edit, cancel, join, and leave the Group are HTTP calls into `modules/group-study`. Schedule, plan, cancel attendance, enter, start, leave, and token are the same. The room page is `/[locale]/portal/study-groups/sessions/:sessionId`. It polls the Session, and once the Session is Live it asks for a token and connects.

Enter and token are separate requests. Enter is the seat grant. Token is the credential. The browser never sees the LiveKit API secret.

## What is stored

| Record | Kept | Not kept |
|---|---|---|
| Study Group | Id, title, one Course id, about, Host user id, `active` or `cancelled`, timestamps. Course id does not change. | Group-level date, duration, lesson, or a six-person cap. |
| Membership | Group, user, `host` or `member`, joined and left times. Many members. | A seat in a Live Session. |
| Live Session | Title (at most 20 characters), optional Related Lesson, start, planned duration as 1800, 2700, 3600, or 5400 seconds (30, 45, 60, or 90 minutes), maximum 2–6, optional focus, AI Tutor flag, `scheduled`, `live`, `completed`, or `removed`. | A Cancelled card. `removed` drops it from lists. Any other duration. |
| Attendance intent | Plan to Attend time, or cancelled time. | A reserved seat. |
| Presence | Request time, entered time, left time, `waiting` or `live`. This is the seat and the actual-attendance record. | Plan to Attend by itself. |
| Meeting | One row when the Host starts that Session. `startedAt`, and `endedAt` when the last participant leaves after start. A second Start does not insert another row. | A row at schedule time. A token. |
| Reminder | One sent mark per Session and user, for the Host and for members who still Plan to Attend. | A reminder to every Group member. |
| Issuance log | One encrypted line per successful issuance: user id, role, session id, `token_issued`, time. | The raw token, the API secret, a token table. |
| Tutor queue | Session-scoped user id, session id, text, receipt time, idempotency key, delivery state, lease, bounded attempts and a safe shared-message identifier. | A raw API key, token, screen bytes, seat change, or browser-visible grounding prompt. The service drains the queue through a durable claim/settle protocol. |
| LiveKit room | Media and Chat while people are connected. | A database copy of Chat, a recording, or screen pixels for AI Tutor. |

The selected production store is RDS PostgreSQL. The branch's local JSON repository is only a temporary test/dev adapter; production does not use `study-group.json`, `token-issuance.log`, container-local state, or in-memory queue ownership.

## State

Group membership, for one user: Discoverable, then Joined, or Hosting from create. Leave returns a member to Discoverable while the Group stays active. The Host does not leave. Cancel Group is terminal for the pages. Completed Session rows stay in the store. The cancelled Group is not listed.

Live Session: Scheduled, then Starting Soon at T-10, then Live only when the Host starts, then Completed when the last participant leaves after start. Cancel before start removes the record. The scheduled clock and the planned duration do not start or complete the Session. Waiting for Host Start is the member's page during Starting Soon, not a second Session state. People on that page count toward occupancy. Host Start moves them into the room without another enter, and the count stays.

A Group card Live badge means some child Session is Live. It is not a Group state.

## Atomic steps

Each user operation that changes a seat, a meeting, a token, or the log is split below. The service orders the steps. The repository commits the row change. LiveKit is not in the seat or meeting write.

**Enter.** The service checks the session, membership, Course access, and Starting Soon or Live. It orders concurrent enters by server receipt time. The repository grants one presence if occupancy is still under the Session maximum. A duplicate enter for someone already seated does not add a row. The seventh person when the maximum is 6 gets Session Full and no row.

**Host Start.** The service checks the Host and Starting Soon. The repository sets the Session to Live, moves waiting presences to the live phase, and inserts one meeting row if that Session does not have one. Occupancy is unchanged. This step does not sign a token.

**Token.** The service reads the seat. It signs a participant token with no Host label. If signing fails, the repository releases that seat, and no log line is written. If signing succeeds, the repository appends one encrypted line that contains neither the token nor the API secret, and the Route returns the token. The UI then connects to LiveKit.

**Leave.** The repository sets `leftAt`. If the Session is Live and occupancy is then zero, the Session becomes Completed and the meeting row gets `endedAt`.

**Tutor queue append.** The service records one item for that Session: user id, session id, text, client idempotency key and the time the server received it. A worker atomically leases the next eligible item, retrieves only existing course text, and publishes a grounded answer as a shared LiveKit data message. Retryable failures use a bounded retry policy; terminal failure settles the item and advances the next item. This append/delivery is not part of enter, Host Start, token issuance, or leave. Occupancy and the token are unchanged.

The system prompt for a later call is server-side only. The browser does not receive it. A later call may pass course context beside the item text. That context's shape is open. The prompt allows a course fact only when it is in the context passed with that call. Participant text cannot override that. The screen is not parsed.

The call is direct. No agent framework is added. The call layer is a lightweight distributed service. It keeps a pool of API keys, switches to another key on auth failure, rate limit or quota, records request count, errors and latency per key, and sends traffic only to healthy keys. Raw keys are never logged, never put in the repo and never sent to the browser. The model is OpenRouter-compatible and replies re-enter the assigned LiveKit room through the LiveKit gateway.

The queue is per Live Session only. One question is in flight at a time, in server receipt order. A later question does not cancel or merge with an earlier one. The answer is tied to the asker and the original text. This design does not add a per-user tutor identity or a course-wide tutor identity. Whether the tutor is one per user or one shared by a Course is not decided. How the knowledge base is built, the structure of the base, and the structure of a piece of knowledge are not decided.

On branch `18a1046`, `enterSession` writes the presence and returns. `issueToken` does not clear that presence when signing fails. The atomic step above is the design. The branch has not combined them. The branch stores the AI Tutor flag and has no tutor queue.

## Emergency behavior the PRD already states

- Missing required fields on create are blocked at the field.
- Invalid Course access blocks Join and Join Now, and the page offers the Course access path.
- A full Session blocks another enter and shows Session Full. Plan to Attend does not override that.
- A member who planned to attend and finds the Session full stays blocked.
- A network drop may be restored by LiveKit reconnect. The Session stays Live while anyone remains. Host disconnect has no grace and does not end the Session.
- After Host Start, the last participant leaving sets Completed.
- Host cancel of an unstarted Session removes it from the lists.
- Host cancel of the Group makes it inaccessible, cancels upcoming Sessions, removes it from My and Discover, notifies members, and keeps completed Session rows in the store.
- Enter during Starting Soon shows Waiting for Host Start and counts toward capacity. The scheduled time does not start the Session. People already waiting stay on that page until Host Start or cancel.
- The LiveKit API secret stays on the server. The browser receives only the short-lived token for that user and that Session.

## PRD coverage

Verdicts are against PRD v0.10 on branch `18a1046`. `meets` means the branch does what that sentence says. `misses` means the sentence is not done. `contradicts` means the branch does the opposite.

### Success criteria

| ID | Specified | Branch | Evidence |
|---|---|---|---|
| SC-001 | A signed-in learner with Course access creates a Group and becomes Host. | meets | `createGroup` checks access and writes role `host`. |
| SC-002 | The Group is discoverable to people who have not joined, including people without Course access. | meets | Discover allows a null user and does not check Entitlement. |
| SC-003 | Valid Course access joins immediately, with no Host approval. | meets | `joinGroup` inserts membership. |
| SC-004 | No Course access cannot join and is sent to get access. | meets | Join returns `course_access_required`. The page links to the Course. |
| SC-005 | Membership is larger than six. The six-person limit is per Live Session. | meets | Join has no cap. Enter uses `maxParticipants`. |
| SC-006 | Host can schedule, edit, cancel, and start an eligible Live Session. | misses | Schedule, cancel, and start exist. Edit is an API that changes title only, and the page has no Edit Session control. |
| SC-007 | Plan to Attend and Cancel Attendance do not reserve a place. | meets | Intent rows are separate from presence. |
| SC-008 | A Live Session supports 2–6 concurrent participants including the Host. | meets | Schedule accepts 2–6. Occupancy counts entered people, including a Host who has entered. |
| SC-009 | Live participants share the same in-room controls for their own media, screen share, Chat, Raise Hand, and Leave. | misses | The control list does not vary by role. Mic, camera, and share only call the enable path, and the room does not render a media element. |
| SC-010 | When AI Tutor is enabled, any live participant can invoke it in shared Chat. | misses | The flag is stored. The room has no tutor invoke. The design seam is an undrained queue. The branch does not have that queue. |
| SC-011 | AI Tutor follows Course AI Tutor and Course Knowledge, and does not parse the shared screen. | misses | No tutor call exists, so the screen is not parsed. The grounding behavior is not implemented. |
| SC-012 | The Session becomes Completed after the final participant leaves. | meets | After start, occupancy zero sets `completed`. |
| SC-013 | From T-10, joined members may enter and wait, and they count toward occupancy before Host Start. | meets | `effectiveSessionState` and `enterSession`. |

### Business rules

| ID | Specified | Branch | Evidence |
|---|---|---|---|
| BR-001 | A Group links to exactly one Course. | meets | `courseId` is one field. |
| BR-002 | The Course is immutable after create. | meets | Edit rejects a different `courseId`. |
| BR-003 | Create lists only Courses the user can access. | meets | `listCreatableCourses` filters with Entitlement. |
| BR-004 | A new Group is publicly discoverable. | meets | Active groups are listed in discover. |
| BR-005 | Discover excludes Groups the user has joined or hosts. | meets | `listDiscover` skips active memberships. |
| BR-006 | A Group Live badge means a child Session is Live. | meets | `groupIsLive` uses child state `live` only. |
| BR-007 | Only valid Course access may join. No Host approval. | meets | `joinGroup`. |
| BR-008 | Membership is not limited by the six-person cap. | meets | No cap on join. |
| BR-009 | The member list is scrollable and can hold many members. | meets | All active members render. The page can scroll. The member column has no inner scroller. |
| BR-010 | Host may edit title and about. Course cannot be edited. | meets | Edit form and `editGroup`. |
| BR-011 | Cancel Group makes it unavailable, removes it from lists, cancels upcoming Sessions, notifies members, and keeps completed history in the store. | meets | Status `cancelled`, scheduled Sessions `removed`, in-site notify, completed rows kept. |
| BR-012 | Each Live Session supports 2–6 including the Host. | meets | Validation and occupancy. |
| BR-013 | Related Lesson is optional metadata and need not show on P0 cards. | misses | Cards omit it. The schedule control does not submit `relatedLessonId`, so a lesson cannot be saved. A blank lesson still schedules. |
| BR-014 | AI Tutor defaults on and can be turned off before start. | meets | `aiTutorEnabled !== false`, checkbox default checked. |
| BR-015 | Starting Soon begins at T-10. Entry waits for the Host. The clock does not start the Session. | meets | `STARTING_SOON_MS` and `startSession`. |
| BR-016 | Edit and Cancel are available only before the Session starts. | misses | Cancel is offered through Starting Soon and refused after Live. Edit is not offered on the page. |
| BR-017 | Cancel removes the record. No Cancelled card. | meets | Status `removed`, filtered out of views. |
| BR-018 | Plan to Attend never reserves a live place. | meets | Intent is not occupancy. |
| BR-019 | Host and Plan-to-Attend members get a reminder at T-10 by in-site notification and email. Cancelling attendance removes the member reminder. | misses | Audience and both channels exist inside `dispatchDueReminders`. That function runs when My Study Groups is loaded, not from a clock. |
| BR-020 | A joined member may enter from T-10 without Plan to Attend, if capacity and Course access allow, and sees Waiting for Host Start. | meets | Enter ignores intent. The page shows the waiting dialog. |
| BR-021 | At capacity, further entry is blocked and the UI shows Session Full. | meets | `session_full` and a disabled Session full control. |
| BR-022 | Participant and Host can view Completed history. | meets | Completed rows stay in the member Session list and are read-only apart from view attendees. |
| BR-023 | Leaving cancels future Plan to Attend and reminders. The Group can be discovered again. | meets | `leaveGroup` cancels scheduled intents. Discover lists the user again. |
| BR-024 | In the room, Host and participants have equal controls. The Host label is identity only. | meets | Live controls ignore role. The badge comes from membership, not from the token. |
| BR-025 | Raise Hand needs no approval and does not change speaking permission. | meets | A LiveKit data message. No grant change. |
| BR-026 | Leave Session exits only that user. The Session stays Live while someone remains. | meets | `leaveSession`. |
| BR-027 | The final participant leaving completes the Session. | meets | Only after the Session is Live. |
| BR-028 | No Host-disconnect grace or Host-leave auto-end. | meets | Those paths are absent. |
| BR-029 | Any current participant may invoke the tutor in shared Chat when it is enabled. | misses | No invoke path. |
| BR-030 | Answers and questions follow Course AI Tutor and Course Knowledge. | misses | No tutor call. |
| BR-031 | The tutor does not parse the shared screen. | meets | Nothing sends screen content to a tutor. |
| BR-032 | Course access is revalidated before Join Study Group and Join Live Session. | meets | `joinGroup` and `enterSession` call `hasCourseAccess`. |
| BR-033 | A waiting entrant counts toward occupancy. Plan to Attend alone does not. | meets | Occupancy is open presences. |
| BR-034 | Host Start moves waiting people into Live without another join, and the count stays. | meets | Phase update plus the waiting poll navigating to the room. |

### Pages and fields

| Specified | Branch | Evidence |
|---|---|---|
| GS-HOME-001 No selection shows My, Discover, and a prompt to select or create. | meets | Empty pane copy and both lists. |
| GS-HOME-002 My contains Joined and Hosted Groups, visually distinct. | meets | Badges Hosted and Joined. |
| GS-HOME-003 Discover contains Groups the user has neither joined nor hosted. No duplicate across the two lists. | meets | `listDiscover` and `listMine`. |
| GS-HOME-004 Discover filters by Course and keyword. | meets | `courseId` and `q`. |
| GS-HOME-005 A Live badge on a Group card when a child Session is Live. | misses | My cards show it. Discover cards do not. |
| Create requires Title, Related Course, and About. Course choices are those with access. Create assigns the Host and makes the Group discoverable. Cancel writes nothing. | meets | Create form and `createGroup`. |
| GS-CREATE-006 Success shows a confirmation with title and Course. | misses | Copy keys exist. Create opens the Group directly. |
| GS-CREATE-007 The creator is already Host. No second save. | meets | Membership is written in create. |
| GS-CREATE-008 Go to Study Group opens the Host view. | misses | There is no confirmation action. The Host view opens immediately from create. |
| Host detail shows Hosting, read-only Course, about, members, and no-session copy. Schedule, Edit Group, and Cancel Group are Host actions. Cancel asks for confirmation. | meets | Host column and `window.confirm`. |
| Schedule requires title, date, start time, duration, and maximum 2–6. Related Lesson and focus are optional. AI Tutor defaults on. Scheduling does not remind every member. | meets | The form requires a duration and `scheduleSession` requires an integer of at least 1. The branch stores that integer as `durationMinutes` and does not limit it to 30, 45, 60, or 90 minutes, or to 1800, 2700, 3600, and 5400 seconds. The lesson dropdown has no options and is not submitted. |
| Host list shows Starting Soon, occupancy for entered people, edit and cancel before start, plan count, view attendees, completed history, and another schedule action. | misses | Those states and actions exist except Edit Session, which is not on the page. |
| GS-JOIN-001 through GS-JOIN-005 Overview and members before join, Sessions hidden, Join enabled with Course access, immediate join, Group moves to My. | meets | `sessions` is null until membership. Join banner is shown. |
| GS-ACCESS-001 through GS-ACCESS-005 Discover without Course access, overview and members visible, Sessions hidden, Join unavailable, Get Course access, then the normal not-joined state after access. | meets | `canJoin` false links to the Course page. |
| Joined detail shows Starting Soon, Live occupancy, Session Full, Plan to Attend, Cancel Attendance, completed history, and Leave Study Group. | meets | Session cards and leave. |
| Waiting page after enter during Starting Soon. The user counts toward capacity. Host Start moves them without another join. | meets | Waiting dialog, presence row, poll, then the room. The branch uses a dialog on the Group page rather than a separate route. |
| Room shows a Host badge with no moderation, own mic and camera, screen share, participants, shared Chat, Raise Hand, and Leave. No mute-others, remove, Invite to Speak, End Session, or Host grace. | misses | Badge, Chat, Raise Hand, and Leave match. Media controls do not toggle off and do not show the shared screen as the main area. The forbidden Host controls are absent. |

### State model

| Specified | Branch | Evidence |
|---|---|---|
| Not joined can view overview and members, then Join. | meets | `getGroup`. |
| Joined can view Sessions, plan, enter, and leave. | meets | Member actions. |
| Hosting adds edit, cancel, schedule, and start, and still has member actions. | meets | Role checks. The Host plan button is not on the page. The Host still receives the reminder without planning. |
| Cancelled Group has no member access. | meets | Active-only reads. |
| Scheduled allows Host edit and cancel, and member plan. Entry is closed. | meets | `session_not_open` before T-10. |
| Starting Soon allows enter and wait, and Host start, edit, and cancel, until Start. No auto-start. | misses | Enter, start, and cancel match. Edit is missing on the page. |
| Live allows enter while capacity remains, with equal room controls. | meets | Enter in `live`. Room controls do not add Host moderation. |
| Completed is read-only history after the last leave, with actual attendees. | meets | `showActual` uses presences. No start, edit, or cancel. |
| Plan to Attend creates intent and reminder eligibility and does not reserve capacity. Cancel Attendance removes them. | meets | Intent rows and reminder audience. |
| Join Now from T-10 is independent of Plan to Attend. | meets | Enter does not read intent. |

### Data and integration

| Specified | Branch | Evidence |
|---|---|---|
| Study Group fields: id, title, Course, about, Host, status, timestamps. | meets | `StudyGroupRow`. |
| Membership fields: group, user, role, joined and left. | meets | `MembershipRow`. |
| Live Session fields: id, group, title, optional lesson, start, duration, max, focus, AI Tutor flag, state. | meets | `LiveSessionRow`. The branch field is `durationMinutes`. The closed duration values are 1800, 2700, 3600, and 5400 seconds. |
| Attendance intent fields. | meets | `AttendanceIntentRow`. |
| Actual attendance joined and left times. | meets | `PresenceRow`. |
| Course access checked on create, join, and enter. The module does not own Entitlements. | meets | `checkEntitlement` through `hasCourseAccess`. |
| Invalid Course access blocks the restricted action and points the user to restore access. | meets | `course_access_required` and the Course link. |
| Learning Guide owns records, access, metadata, intent, reminders, and the AI Tutor flag. LiveKit owns the room and media. | meets | Split in `service.ts` and `StudySessionRoom`. |
| The API secret is not sent to the browser. The client token is short-lived and scoped to the user and Session. | meets | Token route returns the token and URL. The branch TTL is 600 seconds. |
| AI Tutor uses the Related Course configuration and current Course Knowledge, not a Group-chosen Knowledge Release. The screen is not sent. | misses | No tutor runtime. The screen is not sent. |

### Notifications

| Specified | Branch | Evidence |
|---|---|---|
| Plan to Attend puts that member on the T-10 reminder, in-site and email. | misses | The audience rule matches. Delivery runs from the My list load. |
| Cancel Attendance drops that member's future reminder. | meets | Cancelled intent is excluded. |
| Leave Study Group drops that member's future Plan to Attend reminders. | meets | Intents cancelled and membership inactive. |
| Cancel Study Group notifies current members. | meets | In-site notification. The PRD does not name email for this one. |
| The Host receives the T-10 reminder without Plan to Attend. Other members who did not plan do not. | misses | The audience matches. The clock trigger does not. |
| Session-cancel notification is not expanded. | meets | Cancel Session does not notify. |

### Exceptions

| Specified | Branch | Evidence |
|---|---|---|
| Create without required fields is blocked. | meets | Validation error. |
| Invalid Course access at Join is blocked, with Get Course access. | meets | Join gate. |
| Invalid Course access at live entry is blocked. | meets | `enterSession`. |
| Capacity blocks entry and shows Session Full. | meets | UI and `session_full`. |
| A planned member is still blocked when the Session is full. | meets | Enter does not look at intent. |
| Participant disconnect may reconnect. The Session stays Live while someone remains. | meets | No custom end-on-disconnect. The room has a Reconnect control. |
| Host disconnect or leave has no grace and no auto-end. | meets | Leave is the same path for every user. |
| Last leave after start sets Completed. | meets | `leaveSession`. |
| Host cancels an unstarted Session and the record leaves the list. | meets | `removed`. |
| Host cancels the Group. | meets | `cancelGroup`. |
| Enter during Starting Soon shows Waiting for Host Start and counts. | meets | Dialog and presence. |
| The scheduled time does not auto-start. Waiting people stay until Start or cancel. | meets | No time-based start. |
| A full waiting room blocks entry with the same maximum. Plan does not change occupancy. | meets | Same occupancy check. |

### Security and non-functional

| Specified | Branch | Evidence |
|---|---|---|
| Only an authenticated user may create, join, or enter. Discovery may follow the site session policy. | meets | Mutations require a session. Discover does not. |
| The server checks role, Course access, state, and capacity before restricted actions. | meets | Service checks. |
| The LiveKit API secret stays on the server. | meets | Used only in `signParticipantToken`. |
| The participant token is short-lived and scoped. | meets | JWT `exp`, room, and publish, subscribe, data. |
| No recording or playback. | meets | No recording path. |
| AI Tutor messages are shared Session content. No private AI channel. | misses | There is no tutor message path yet. |
| The shared screen is not analysed by AI Tutor. | meets | No screen upload. |
| The page stays usable with a long member list. | meets | Members are rendered as a list. |
| Each Live Session enforces its 2–6 maximum including the Host. | meets | Enter check. |
| Modern desktop browsers with the LiveKit WebRTC stack. | meets | `livekit-client` in the browser. The branch has no browser matrix. |

### Test cases

| ID | Specified result | Branch | Evidence |
|---|---|---|---|
| TC-001 | No-selection message, My and Discover visible. | meets | Empty state. |
| TC-002 | Hosted Group is in My and not in Discover. | meets | Service test. |
| TC-003 | Joined Group is in My and not in Discover. | meets | Service test. |
| TC-004 | Live child shows the Group Live badge. | misses | My cards only. |
| TC-005 | Create Course list is current access only. | meets | `accessibleCourses`. |
| TC-006 | Missing required field blocks create. | meets | Validation. |
| TC-007 | Create makes the user Host and the Group discoverable. | meets | Service test. The confirmation screen is still absent. |
| TC-008 | Title and about editable. Course read-only. | meets | Edit form. |
| TC-009 | Cancel Group removes lists, cancels upcoming, notifies, keeps completed rows. | meets | Service test. |
| TC-010 | Many members scroll and the count shows. | meets | Count badge and a full list. |
| TC-011 | Maximum participants 2–6 including Host. | meets | Schedule select and service check. |
| TC-012 | Blank Related Lesson still schedules. | meets | Null lesson is allowed. |
| TC-013 | AI Tutor defaults on and can be unchecked. | meets | Checkbox. |
| TC-014 | Starting Soon at T-10. | meets | `effectiveSessionState`. |
| TC-015 | Host can edit before start. | misses | No page control. API title-only. |
| TC-016 | Host can cancel before start. The record disappears. | meets | `cancelSession`. |
| TC-017 | Edit and cancel unavailable after Live start. | meets | Service refuses when status is not `scheduled`. |
| TC-018 | Final leave sets Completed. | meets | Service test. |
| TC-019 | Host sees finished history and actual attendees. | meets | Completed card and attendee list. The card does not print the word Completed. |
| TC-020 | Discover with access shows overview and members, Join on, Sessions hidden. | meets | `getGroup`. |
| TC-021 | Join is immediate and moves the Group to My. | meets | Join then reload. |
| TC-022 | No access shows overview, Join off, Get Course access. | meets | Join gate. |
| TC-023 | Get Course access opens the Course path. | meets | Link to `/portal/courses/:slug`. |
| TC-024 | Plan records intent and reminder eligibility, no seat. | meets | Service test. |
| TC-025 | Cancel Attendance removes intent and reminder. | meets | `cancelAttendance`. |
| TC-026 | Join Live without a plan if access and capacity allow. | meets | Enter ignores intent. |
| TC-027 | Capacity shows Session Full. | meets | Button label and error code. |
| TC-028 | Completed history is read-only for a participant. | meets | No live actions on that state. |
| TC-029 | Leave removes membership, future plans, and returns Discover. | meets | Service test. |
| TC-030 | Host badge in the room, no extra moderation. | meets | Badge from membership. Token test asserts no host claim. |
| TC-031 | User can toggle own mic and camera. | misses | The buttons only enable. |
| TC-032 | Any participant can start and stop screen sharing. | misses | The button only enables. The shared view is not the main area. |
| TC-033 | Raise Hand is visible without approval. | meets | Data message. |
| TC-034 | Leave Session exits only the current user. | meets | `leaveSession`. |
| TC-035 | Host leave does not end the Session or start a grace countdown. | meets | Session stays Live while others remain. |
| TC-036 | AI Tutor disabled means invoke is unavailable. | meets | No invoke control. |
| TC-037 | AI Tutor enabled means any participant can invoke it. | misses | Flag only. |
| TC-038 | Prompt and response visible to current participants. | misses | No tutor messages. |
| TC-039 | A learning answer follows Course grounding. | misses | No tutor call. |
| TC-040 | An understanding-check question stays inside Course Knowledge. | misses | No tutor call. |
| TC-041 | The tutor does not infer the shared screen. | meets | No screen payload. |
| TC-042 | A typed topic can be answered inside Course grounding. | misses | No tutor call. |
| TC-043 | Expired Course access blocks Join Now. | meets | `enterSession` rechecks access. |
| TC-044 | Join Now before Host Start shows Waiting for Host Start. | meets | Waiting dialog. |
| TC-045 | A waiting member counts in occupancy. | meets | Presence before start. |
| TC-046 | Plan to Attend does not change occupancy. | meets | Intent only. |
| TC-047 | Host Start with waiters goes Live, without a second join, and keeps the count. | meets | `startSession` and the waiting poll. |
| TC-048 | The scheduled time does not start the Session. | meets | Start is a Host action. |
| TC-049 | At T-10 the Host and planners get in-site and email reminders. Others do not. | misses | Audience matches. Trigger is the My list request. |

### Out of scope

The branch does not add persistent Discussion, Host approval, recurring Sessions, a waitlist, recording, in-room mute or remove, Host-disconnect grace, co-host, private Chat, or screen parsing. Those absences meet the PRD exclusions.
