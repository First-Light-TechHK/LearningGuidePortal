# Study Group UML

Diagrams for PRD v0.10, the locked decisions, and branch `cursor/study-group-backend-7481` at `18a1046ec71853f77d1b73eda545526c58964826`. Layer names match the architecture note.

Session Title is required and is at most 20 characters. That limit is the Figma counter `7/20`. It is not drawn below, because none of these sequences edit the title string.

## Class diagram

`EncryptedIssuanceLog` is one ciphertext line per successful issuance. It is not a token table. `LiveKitRoom` is the cloud room. Chat bytes stay there.

```mermaid
classDiagram
  class StudyGroup {
    id
    title
    courseId
    about
    hostUserId
    status
    createdAt
    updatedAt
  }
  class Membership {
    id
    groupId
    userId
    role
    joinedAt
    leftAt
  }
  class LiveSession {
    id
    groupId
    title
    relatedLessonId
    startsAt
    durationSeconds
    maxParticipants
    focus
    aiTutorEnabled
    status
    startedAt
    completedAt
  }
  class AttendanceIntent {
    id
    sessionId
    userId
    plannedAt
    cancelledAt
  }
  class Presence {
    id
    sessionId
    userId
    requestedAt
    enteredAt
    leftAt
    phase
  }
  class Meeting {
    id
    sessionId
    startedAt
    endedAt
  }
  class EncryptedIssuanceLog {
    userId
    role
    sessionId
    state
    at
  }
  class TutorQueueItem {
    userId
    sessionId
    text
    receivedAt
  }
  class LiveKitRoom {
    roomName
    media
    dataMessages
  }
  StudyGroup "1" --> "*" Membership
  StudyGroup "1" --> "*" LiveSession
  LiveSession "1" --> "*" AttendanceIntent
  LiveSession "1" --> "*" Presence
  LiveSession "1" --> "0..1" Meeting
  LiveSession "1" --> "*" TutorQueueItem : session-scoped queue
  LiveSession ..> LiveKitRoom : room name is the session id
  EncryptedIssuanceLog ..> LiveSession : one line after a successful sign
```

`AttendanceIntent` does not hold a seat. `Presence` holds a seat while `enteredAt` is set and `leftAt` is empty. `Meeting` exists only after Host Start, one row for that Live Session.

`durationSeconds` is one of 1800, 2700, 3600, or 5400. Those are the choices 30, 45, 60, and 90 minutes. The Figma session card shows `45 mins`. Branch `18a1046` still names the field `durationMinutes` and accepts any integer of at least 1.

`TutorQueueItem` is one undrained queue item. `receivedAt` is the server receipt time. The queue is not Chat, and it is not a seat or a token. Branch `18a1046` does not have this queue.

## Create Study Group

The page collects Title, Related Course, and About. The service checks Course access. The repository inserts the Group and the Host membership together.

```mermaid
sequenceDiagram
  actor User
  participant UI
  participant Route
  participant Service
  participant Repo
  User->>UI: Title, Related Course, About
  UI->>Route: POST /api/study-groups
  Route->>Route: read session
  Route->>Service: createGroup
  Service->>Service: require signed-in user and Course access
  Service->>Repo: insert Study Group and Host membership
  Repo-->>Service: Group
  Service-->>Route: Host view
  Route-->>UI: ok
  UI-->>User: Host is on the new Group
```

Cancel on the form writes nothing.

## Join the Live Session, six-person race

The cap is the Session maximum, from 2 to 6, and the person count includes the Host. Admission is first come, first served by the time the server receives the enter request. This diagram uses a Session whose maximum is 6. Seven enter requests arrive. The first six include the Host. The seventh does not get a seat.

Plan to Attend is not an enter request and is not in this race. A person who is already seated is not granted a second seat.

```mermaid
sequenceDiagram
  actor Host
  actor Members
  participant UI
  participant Route
  participant Service
  participant Repo
  Host->>UI: Join now at request time T1
  Members->>UI: six Join now calls at T2 through T7
  UI->>Route: POST enter, one call per person
  Route->>Service: enterSession with server receipt time
  Service->>Service: order by receipt time
  loop First six, T1 through T6, including Host
    Service->>Service: Course access, membership, Starting Soon or Live
    Service->>Repo: grant one seat if occupancy is below 6
    Repo-->>Service: occupancy
  end
  Service->>Service: T7 finds occupancy 6
  Service-->>Route: Session Full
  Route-->>UI: no seat for T7
  Note over Repo: T7 has no Presence row
```

The seat grant is the repository write. Token signing is a later step and is not part of this loop.

## Token issuance

The service signs the token only after a seat exists. The token grants join, publish, subscribe, and data. It has no Host label. On a signing failure the seat from this operation is removed before the error returns. No log line is written. On success the repository appends one encrypted line, then the token goes to the browser. LiveKit sees the token only after that.

```mermaid
sequenceDiagram
  actor User
  participant UI
  participant Route
  participant Service
  participant Repo
  participant LiveKit
  User->>UI: open the Live Session
  UI->>Route: POST /api/study-groups/sessions/:id/token
  Route->>Service: issueToken
  Service->>Repo: read seat, membership, session
  alt No seat, or Session completed, or LiveKit secret missing
    Service-->>UI: error, no token, no log line
  else Seat exists and signing fails
    Service->>Repo: release that seat
    Repo-->>Service: occupancy without this user
    Service-->>UI: error, no token, no log line
  else Signing succeeds
    Service->>Service: reject the line if it contains the token or the API secret
    Service->>Repo: append one encrypted line
    Service-->>UI: token, expiry, LiveKit URL
    UI->>LiveKit: connect with the token
    LiveKit-->>UI: room media and data
  end
```

Chat and Raise Hand after connect are LiveKit data messages. They do not call the repository. They do not append a tutor-queue item.

## AI Tutor queue

The queue belongs to one Live Session. The service appends an item. Nothing drains it. The append does not read occupancy and does not sign a token. Chat remains a LiveKit data message and does not become this item.

```mermaid
sequenceDiagram
  participant Service
  participant Repo
  participant LiveKit
  Service->>Repo: append item userId, sessionId, text, server receipt time
  Repo-->>Service: item stored
  Note over Repo: no reader and no delete
  Note over Service: no model, no Course Knowledge, no screen parse
  Note over Service: occupancy and token issuance stay as they were
  Note over LiveKit: Chat stays in the room
```

## Live Session state

Cancel before start removes the record from the lists. There is no Cancelled card. The clock reaching the scheduled time does not enter Live. The planned duration ending does not enter Completed. Completed is the last participant leaving after Host Start.

```mermaid
stateDiagram-v2
  [*] --> Scheduled: Host schedules
  Scheduled --> StartingSoon: T-10
  Scheduled --> Removed: Host cancels
  StartingSoon --> Live: Host Start
  StartingSoon --> Removed: Host cancels
  Live --> Completed: last participant leaves
  Completed --> [*]
  Removed --> [*]
```

Waiting for Host Start is the page a Joined Member sees after enter during Starting Soon. It is not a second Session state. Those people already count in occupancy. Host Start moves them to Live without a second enter, and the occupancy count stays.
