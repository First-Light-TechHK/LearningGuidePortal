# AI Tutor — availability, chat panel and failure lines

Compiled from existing tests. The chat panel tests run in Chromium.

## AIT-01 Availability from KnowledgeSystem

### Functional
- Title: KS decides
- Steps: Ask for a course's Tutor availability
- Expected: Only the `available` field from KS counts (`ks-tutor-client`)

### Negative
- Title: KS cannot be reached or refuses
- Steps: Make KS unreachable; make it refuse the key
- Expected: offline when unreachable; an authentication failure is told apart from not configured (`ks-tutor-client`)

### Edge
- Title: Answers split anywhere, and what diagnostics show
- Steps: Stream SSE frames cut at arbitrary points; read the diagnostics
- Expected: Frames join into plain text; diagnostics hold no address or key (`ks-tutor-client`)

## AIT-02 Failure lines

### Functional
- Title: Every failure has a fixed line
- Steps: Map each code and status
- Expected: One fixed line, by code first and then by status (`tutor-chat-error`)

### Negative
- Title: The API's own words never show
- Steps: Have the Tutor answer 503 with a JSON body
- Expected: The chat shows the localised line, not the JSON body (`tutor-chat-error`)

### Edge
- Title: Both languages
- Steps: Read every line in en-GB and zh-CN
- Expected: Each exists in both and carries no raw API text (`tutor-chat-error`)

## AIT-03 The chat panel

### Functional
- Title: Welcome, new chat and mode
- Steps: Open the panel, start a new chat, change mode
- Expected: The welcome comes from KS; New chat clears the screen and the stored conversation (`tutor-chat-mode-switch`, `ai-tutor-new-chat`)

### Negative
- Title: Switching mode during an answer
- Steps: Try to change mode while an answer streams
- Expected: Mode switching is disabled (`tutor-chat-mode-switch`)

### Edge
- Title: A stream from another lesson
- Steps: Move to another lesson while an answer streams
- Expected: It never writes into the new conversation (`tutor-chat-mode-switch`)

## AIT-04 Course and language of an answer

### Functional
- Title: The fallback answers in the page's language
- Steps: Ask with the provider off in en-GB and zh-CN
- Expected: English answers in en-GB, Chinese in zh-CN, in both modes (`product-tutor-fallback`)

### Negative
- Title: Another course's material
- Steps: Ask about a course that is not Epicureanism
- Expected: It does not fall back to the Epicureanism pack (`LEARN-03-tutor-pack-not-epicureanism`)

### Edge
- Title: A provider failure
- Steps: Have the provider fail mid-request
- Expected: The fallback still uses the requested locale (`product-tutor-fallback`)
