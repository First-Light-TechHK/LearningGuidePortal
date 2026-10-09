# Study Group

## SG-01 Create a Group

### Functional
- Title: Course access creates a Hosted Group
- Steps: Create a Group for a Course the learner can access
- Expected: The creator is Host and other users can discover the Group

### Negative
- Title: Missing fields or no Course access
- Steps: Submit an empty title, or create without Course access
- Expected: validation or course_access_required; no Group

### Edge
- Title: Title length and immutable Course
- Steps: Submit a title longer than 50 characters; edit the Related Course
- Expected: validation; conflict on a different Course id

## SG-02 Join and discover

### Functional
- Title: Join is immediate
- Steps: A learner with Course access joins a discoverable Group
- Expected: The Group moves to My Study Groups

### Negative
- Title: No Course access
- Steps: Join without Course access
- Expected: course_access_required; sessions stay hidden

### Edge
- Title: Duplicate join and leave
- Steps: Join twice, then leave
- Expected: One membership; leave returns the Group to Discover; the Host cannot leave

## SG-03 Live Session entry and token

### Functional
- Title: Host start keeps waiting occupancy and writes one meeting
- Steps: Enter during Starting Soon, then start
- Expected: State becomes live; occupancy is unchanged; one meeting row

### Negative
- Title: Capacity, closed Session, and a token for someone outside
- Steps: Fill the Session; enter too early; request a token without entering
- Expected: session_full, session_not_open, or forbidden

### Edge
- Title: First come first served and no Host grant in the token
- Steps: Overlap entry requests with different request times; decode the token
- Expected: Earlier request time wins; the token room is this Session and has no Host claim; the log line is encrypted and has no raw token
