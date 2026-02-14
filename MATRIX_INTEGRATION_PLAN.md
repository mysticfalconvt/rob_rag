# Matrix Integration, Scheduled Reminders & Auto-Sync Plan

## Overview
Integrate Matrix chat bot with RAG flow, scheduled reminders, auto-sync for data sources, and management dashboard.

## 1. Database Schema (Prisma Migration)

### New Models
```prisma
// Matrix configuration (add to Settings model)
matrixHomeserver      String?
matrixAccessToken     String?   // Encrypted
matrixUserId          String?
matrixEnabled         Boolean   @default(false)

// Matrix rooms
model MatrixRoom {
  id          String   @id @default(uuid())
  roomId      String   @unique  // Matrix room ID
  name        String
  description String?
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([enabled])
}

// Unified scheduled tasks
model ScheduledTask {
  id              String          @id @default(uuid())
  type            String          // "matrix_reminder", "auto_sync"
  name            String          // "Daily calendar summary"
  schedule        String          // Cron expression: "0 7 * * *"
  enabled         Boolean         @default(true)
  query           String?         // For reminders: the RAG query
  matrixRoomId    String?         // Target room for reminders
  syncSource      String?         // For syncs: "google-calendar", "paperless"
  lastRun         DateTime?
  lastRunStatus   String?         // "success", "failed", "skipped"
  nextRun         DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  executions      TaskExecution[]

  @@index([enabled, nextRun])
  @@index([type])
}

// Execution history
model TaskExecution {
  id              String        @id @default(uuid())
  taskId          String
  status          String        // "success", "failed"
  startedAt       DateTime
  completedAt     DateTime?
  duration        Int?          // milliseconds
  error           String?
  response        String?       // Response sent to Matrix/logs
  metadata        String?       // JSON: room, query, result count, etc.
  task            ScheduledTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, startedAt])
  @@index([status])
}

// Data source sync schedules (add to Settings model)
googleCalendarSyncSchedule   String?  @default("0 0 * * *")  // Cron: midnight daily
paperlessSyncSchedule        String?  @default("0 * * * *")  // Cron: hourly
goodreadsSyncSchedule        String?  @default("0 2 * * *")  // Cron: 2am daily
```

## 2. Matrix Integration

### Dependencies
```bash
pnpm add matrix-js-sdk
```

### New Files

#### `lib/matrix/client.ts`
Matrix SDK wrapper with connection management:
- Initialize client with homeserver URL and access token
- Auto-reconnect on connection loss
- Join rooms automatically
- Handle sync state
- Export singleton instance

#### `lib/matrix/messageHandler.ts`
Process incoming Matrix messages:
- Listen for room message events
- Validate room is enabled in MatrixRoom table
- Extract message text, sender, room context
- Call RAG flow (similar to `/api/chat` but internal)
- Format response with sources
- Handle errors gracefully

#### `lib/matrix/sender.ts`
Send messages to Matrix rooms:
- Format RAG responses for Matrix (markdown support)
- Handle long messages (split if needed)
- Send typing indicators
- Handle room errors
- Format sources as citations

#### `lib/plugins/matrixPlugin.ts`
Matrix as a data source plugin:
- Implements `DataSourcePlugin` interface
- Tools: `search_matrix_messages`, `get_room_list`, `get_room_history`
- Query recent Matrix messages as RAG context
- Optional: store message history in database

### API Routes

#### `/api/matrix/config` (GET/POST)
- GET: Return Matrix configuration (mask token)
- POST: Update homeserver, access token, userId, enabled
- Validate connection before saving

#### `/api/matrix/rooms` (GET/POST/PATCH/DELETE)
- GET: List all Matrix rooms bot is in
- POST: Add room to tracking (enable/disable)
- PATCH: Update room settings (name, enabled)
- DELETE: Remove room from tracking

#### `/api/matrix/send` (POST)
- Manual message sending to specific room
- For testing or admin commands

#### `/api/matrix/sync` (POST)
- Trigger Matrix client sync/reconnect
- Useful for debugging connection issues

### UI Components

#### `components/MatrixConfiguration.tsx`
Add to `/config` page:
- Homeserver URL input
- Access token input (password field)
- Bot user ID display
- Connection status indicator
- Test connection button
- Enable/disable toggle
- Room management section:
  - List of joined rooms
  - Enable/disable per room
  - Set room names/descriptions

## 3. Scheduler Enhancement

### Update `lib/scheduler.ts`

Current functionality:
- Runs every 60 seconds
- Checks for Paperless sync

New functionality:
- Check `ScheduledTask` table for due tasks (WHERE `nextRun <= NOW()` AND `enabled = true`)
- For each due task:
  - If `type = "matrix_reminder"`:
    - Execute RAG query with `query` field
    - Send result to `matrixRoomId`
    - Record `TaskExecution`
  - If `type = "auto_sync"`:
    - Call appropriate sync function based on `syncSource`
    - Record sync stats in `TaskExecution`
  - Calculate `nextRun` based on cron `schedule`
  - Update `lastRun`, `lastRunStatus`

### Cron Expression Support
- Use simple cron parser or `cron-parser` npm package
- Support common patterns:
  - `0 7 * * *` - Daily at 7am
  - `0 */4 * * *` - Every 4 hours
  - `0 0 * * 0` - Weekly on Sunday
  - `0 0 1 * *` - Monthly on 1st

### Sync Schedule Implementation
Per data source in Settings:
- **Google Calendar**: `googleCalendarSyncSchedule` (default: `0 0 * * *` - midnight)
- **Paperless**: `paperlessSyncSchedule` (default: `0 * * * *` - hourly)
- **Goodreads**: `goodreadsSyncSchedule` (default: `0 2 * * *` - 2am)

On app startup:
- Create `ScheduledTask` records for each enabled data source
- Or check/update existing sync tasks

## 4. Scheduled Tasks Dashboard

### New Page: `/scheduled`

Accessible from main navigation (admin only).

#### Section 1: Upcoming Executions
Timeline view of next 24-48 hours:
```
┌─────────────────────────────────────────────────┐
│ Next 24 Hours                                   │
├─────────────────────────────────────────────────┤
│ 🕐 Today 7:00 AM                                │
│   📅 Daily calendar summary → #personal         │
│   Last run: Feb 14, 7:00 AM ✓                   │
│   [Skip Once] [Edit] [Delete]                   │
│                                                  │
│ 🕐 Today 12:00 AM (Tomorrow)                    │
│   🔄 Google Calendar Sync                       │
│   Status: Auto-sync • Last: Feb 14, 12:00 AM   │
│   [Run Now] [Configure]                         │
│                                                  │
│ 🕐 Tomorrow 7:00 AM                             │
│   📅 Daily calendar summary → #personal         │
│   [Skip Once] [Edit]                            │
└─────────────────────────────────────────────────┘
```

#### Section 2: Active Tasks
Table with columns:
- **Status** - Active (green) / Paused (yellow) / Failed (red)
- **Type** - Matrix Reminder / Auto-Sync
- **Name** - Task name
- **Schedule** - Human readable (Daily 7:00 AM) + cron expression
- **Query/Action** - For reminders: RAG query; For syncs: source name
- **Target** - Matrix room name or "System"
- **Last Run** - Timestamp + status (Success ✓ / Failed ✗)
- **Next Run** - Timestamp
- **Actions** - Pause/Edit/Delete/Run Now buttons

Filters:
- Type (All/Reminders/Syncs)
- Status (All/Active/Paused)
- Target Room (All/Specific room)

#### Section 3: Execution History
List of last 50 executions (paginated):
```
┌─────────────────────────────────────────────────┐
│ Execution History                               │
├─────────────────────────────────────────────────┤
│ ✓ Feb 14, 7:00 AM - Daily calendar summary     │
│   Duration: 2.3s • Sent to #personal            │
│   [View Response] [View Logs]                   │
│                                                  │
│ ✓ Feb 14, 12:00 AM - Google Calendar Sync      │
│   Synced: 47 events • Duration: 8.1s            │
│                                                  │
│ ✗ Feb 13, 7:00 AM - Daily calendar summary     │
│   Error: Matrix room unavailable                │
│   [Retry] [View Error]                          │
└─────────────────────────────────────────────────┘
```

Click to expand:
- Full error message
- RAG response sent
- Token usage
- Sources used
- Request/response metadata

#### Section 4: Auto-Sync Overview
Quick status panel:
```
┌─────────────────────────────────────────────────┐
│ Data Source Syncs                               │
├─────────────────────────────────────────────────┤
│ Google Calendar    | Daily 12:00 AM | [Configure]│
│   Last: Feb 14, 12:00 AM ✓ (47 events)         │
│                                                  │
│ Paperless-ngx      | Every 60 min   | [Configure]│
│   Last: Feb 14, 2:00 PM ✓ (12 docs)            │
│                                                  │
│ Goodreads RSS      | Daily 2:00 AM  | [Configure]│
│   Last: Feb 14, 2:00 AM ✓ (3 books)            │
└─────────────────────────────────────────────────┘
```

### Components

#### `app/scheduled/page.tsx`
Main dashboard page with all sections.

#### `components/ScheduledTasksList.tsx`
Active tasks table with:
- Sorting by column
- Filtering
- Inline actions (pause/resume/delete)
- Edit dialog
- Run now with confirmation

#### `components/UpcomingExecutions.tsx`
Timeline view:
- Next 24-48 hours
- Grouped by time
- Visual timeline
- Quick actions

#### `components/ExecutionHistory.tsx`
Past runs log:
- Paginated list
- Success/failure filtering
- Expandable details
- Retry failed executions

#### `components/CreateReminderDialog.tsx`
Quick create form:
- Natural language input with parser suggestions
- Or structured form:
  - Name
  - Schedule (dropdown presets + custom cron)
  - Query text
  - Target Matrix room
  - Enable/disable

#### `components/SyncScheduleCard.tsx`
Per-source sync configuration:
- Schedule picker (presets or cron)
- Enable/disable
- Run now button
- Last sync status

### API Routes

#### `/api/scheduled/tasks` (GET/POST)
- GET: List all scheduled tasks (with filters)
- POST: Create new task

#### `/api/scheduled/tasks/[id]` (GET/PATCH/DELETE)
- GET: Get single task details
- PATCH: Update task (schedule, query, enabled, etc.)
- DELETE: Delete task

#### `/api/scheduled/tasks/[id]/run` (POST)
- Trigger immediate execution
- Records execution in TaskExecution
- Returns result

#### `/api/scheduled/executions` (GET)
- List execution history (paginated)
- Filters: taskId, status, dateRange

#### `/api/scheduled/upcoming` (GET)
- Get next 24-48 hours of scheduled executions
- Useful for timeline view

## 5. RAG Flow Integration

### Modify `/app/api/chat/route.ts`

Add support for internal/scheduled requests:

#### New Parameters
```typescript
{
  messages: [...],
  conversationId?: string,
  sourceFilter?: string,
  sourceCount?: number,
  documentPath?: string,
  // NEW:
  matrixRoomId?: string,        // For Matrix context
  triggerSource?: 'user' | 'scheduled' | 'matrix',
  internalServiceKey?: string,  // Auth bypass for scheduler
}
```

#### Authentication Logic
```typescript
if (triggerSource === 'scheduled' || triggerSource === 'matrix') {
  // Validate internalServiceKey (env variable)
  if (internalServiceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return 401 Unauthorized
  }
  // Use system service account
  userId = 'system'
} else {
  // Require normal authentication
  const session = await requireAuth(req)
  userId = session.user.id
}
```

#### Response Format
For scheduled/matrix requests, return structured data:
```typescript
{
  response: string,          // Full response text
  sources: SourceData[],     // Used sources
  conversationId: string,
  tokenUsage: {...},
  duration: number
}
```

Instead of streaming for these internal requests.

## 6. Configuration UI Updates

### `/config` page additions

#### Matrix Configuration Section
After Google Calendar config:
- **Matrix Configuration** card
- Homeserver URL input
- Access token input (masked)
- Bot User ID (auto-filled after connection)
- Connection status (Connected ✓ / Disconnected ✗)
- Test Connection button
- Enable/Disable toggle
- **Tracked Rooms** subsection:
  - Table of rooms
  - Room ID, Name, Enabled toggle
  - Actions (edit name, remove)

#### Sync Schedules Section
Add to each data source configuration:

**Google Calendar Config:**
- Sync Schedule dropdown:
  - Manual (disabled)
  - Hourly
  - Daily at [time picker]
  - Custom cron [input]
- Last Synced: Feb 14, 12:00 AM
- Next Sync: Feb 15, 12:00 AM
- [Sync Now] button

**Paperless Config:**
- Same as above (currently has interval, migrate to cron)

**Goodreads Config:**
- Same as above

## 7. Implementation Flow Examples

### Example 1: Matrix Message Flow
```
1. User sends message: "What's on my calendar today?" in Matrix room #personal
2. Matrix SDK fires event → messageHandler.ts receives it
3. messageHandler validates:
   - Room #personal exists in MatrixRoom table
   - Room is enabled
4. Extract message text, sender, room context
5. Call /api/chat internally:
   {
     messages: [{ role: 'user', content: 'What's on my calendar today?' }],
     triggerSource: 'matrix',
     matrixRoomId: '!abc123:matrix.org',
     internalServiceKey: process.env.INTERNAL_SERVICE_KEY
   }
6. RAG flow executes:
   - Uses get_upcoming_events tool (real-time from Google API)
   - Formats response with sources
7. sender.ts receives response, formats for Matrix (markdown)
8. Sends response to #personal room
9. User sees formatted response with calendar events
```

### Example 2: Scheduled Reminder Flow
```
1. User creates reminder in Matrix or web UI:
   "Remind me every morning at 7am about my calendar"
2. Creates ScheduledTask record:
   {
     type: 'matrix_reminder',
     name: 'Daily calendar summary',
     schedule: '0 7 * * *',
     query: 'What events are on my calendar today?',
     matrixRoomId: '!abc123:matrix.org',
     enabled: true,
     nextRun: '2026-02-15 07:00:00'
   }
3. Previous night at midnight:
   - Auto-sync task fires (type: 'auto_sync', source: 'google-calendar')
   - Runs syncCalendarEvents() → indexCalendarEvents()
   - Records TaskExecution (success, 47 events synced)
4. Next morning at 7:00 AM:
   - Scheduler detects ScheduledTask with nextRun <= now
   - Executes reminder:
     a. Call /api/chat with query
     b. RAG uses get_upcoming_events tool (fresh data from midnight sync)
     c. Format response
     d. Send to Matrix room #personal
   - Create TaskExecution record (success, 2.3s, response stored)
   - Calculate nextRun = tomorrow 7:00 AM
   - Update ScheduledTask
5. User wakes up, sees calendar summary in Matrix
```

### Example 3: Auto-Sync Flow
```
1. App startup:
   - Check Settings for googleCalendarSyncSchedule = "0 0 * * *"
   - Create/update ScheduledTask:
     {
       type: 'auto_sync',
       name: 'Google Calendar Sync',
       schedule: '0 0 * * *',
       syncSource: 'google-calendar',
       enabled: true,
       nextRun: '2026-02-15 00:00:00'
     }
2. Scheduler runs every 60 seconds
3. At 12:00 AM (midnight):
   - Detects ScheduledTask due
   - Executes sync:
     a. Call syncCalendarEvents()
     b. Fetch events from Google Calendar API
     c. Call indexCalendarEvents()
     d. Update/insert CalendarEvent records
     e. Generate embeddings for new/changed events
   - Create TaskExecution:
     {
       status: 'success',
       duration: 8100ms,
       metadata: { eventsAdded: 12, eventsUpdated: 35, eventsDeleted: 0 }
     }
   - Update ScheduledTask:
     lastRun = now
     lastRunStatus = 'success'
     nextRun = tomorrow midnight
4. All calendar data is now fresh for morning reminders
```

### Example 4: Natural Language Reminder Creation
```
User types in Matrix: "Remind me every Friday at 5pm to review my week"

1. Matrix bot receives message
2. Detect "remind me" pattern
3. Parse components:
   - Frequency: "every Friday" → cron "0 17 * * 5"
   - Time: "5pm" → 17:00
   - Query: "review my week" → expand to: "What books did I read this week? What were my important calendar events?"
4. Create ScheduledTask:
   {
     type: 'matrix_reminder',
     name: 'Weekly review',
     schedule: '0 17 * * 5',
     query: 'Summarize my week: books read, important calendar events, Paperless documents',
     matrixRoomId: [current room],
     enabled: true,
     nextRun: [next Friday 5pm]
   }
5. Respond in Matrix: "✓ Reminder set! I'll send you a weekly review every Friday at 5pm."
6. Show link to dashboard to edit/manage
```

## 8. Key Features Summary

### Multi-Room Support
- Bot joins and monitors multiple Matrix rooms simultaneously
- Each room can be enabled/disabled independently
- Reminders target specific rooms (one-to-one or group)
- Room-based context: use recent room messages in RAG queries
- Per-room rate limiting to prevent spam

### Natural Language Reminder Creation
Support patterns like:
- "Remind me every morning at 7am about my calendar"
- "Every Monday at 9am, tell me how many unread Paperless documents I have"
- "Daily at 6pm, summarize my calendar for tomorrow"
- "Every Friday afternoon, list books I read this week"
- "Once on February 20th at 2pm, remind me about vacation planning"

Parse to structured data:
- Frequency/recurrence
- Specific time
- Query intent
- Target room (current room by default)

### Fresh Time-Sensitive Data
Auto-sync ensures data freshness:
- **Calendar**: Syncs nightly (midnight) before morning reminders
- **Paperless**: Syncs hourly for latest document availability
- **Goodreads**: Syncs daily for reading updates

Result: Reminders always query fresh, indexed data.

### Management & Debugging
Dashboard provides:
- **Visibility**: See all automation in one place
- **Timeline**: Next 24-48 hours of scheduled executions
- **Control**: Pause/resume, skip once, edit, delete
- **Testing**: "Run Now" to test without waiting
- **Audit Trail**: Full execution history with success/failure
- **Error Handling**: View error messages, retry failed tasks
- **Response Review**: See exactly what was sent to Matrix

### Actions Available
From dashboard:
- ✅ **Pause/Resume** - Temporarily disable without deleting
- ⏭️ **Skip Once** - Skip next execution only, keep recurring
- ▶️ **Run Now** - Trigger immediately for testing
- ✏️ **Edit** - Change schedule, query, target room
- 🗑️ **Delete** - Remove permanently
- 📊 **View Logs** - See execution history for specific task
- 📄 **View Response** - See what was sent to Matrix
- 🔄 **Retry** - Re-run failed execution

## 9. Security Considerations

### Matrix Access Token
- Store encrypted in database (use encryption key from env)
- Never expose in API responses (mask with `***`)
- Validate token on save
- Allow token rotation

### Room Membership Validation
- Only respond to messages in rooms bot has joined
- Verify room exists in MatrixRoom table
- Check enabled status before responding

### Rate Limiting
- Per-room rate limits (e.g., max 10 messages/minute)
- Global rate limit for all Matrix responses
- Prevent spam/abuse

### Internal Service Authentication
- Generate random `INTERNAL_SERVICE_KEY` (env variable)
- Scheduler/Matrix handler includes this key when calling /api/chat
- Bypasses user authentication but logs as 'system' user
- Different from user sessions (cannot be stolen)

### Optional: User ID Whitelist
- Add `matrixAllowedUsers` to Settings (JSON array)
- Only respond to messages from specific Matrix user IDs
- Useful for personal deployments

### Audit Trail
- All TaskExecution records include metadata
- Track who created scheduled tasks
- Log all Matrix interactions
- Monitor for suspicious patterns

## 10. File Structure Summary

```
lib/
  matrix/
    ├── client.ts              # Matrix SDK wrapper, connection mgmt
    ├── messageHandler.ts      # Process incoming messages
    ├── sender.ts              # Send formatted responses
    └── scheduler.ts           # Reminder execution logic (optional, can be in main scheduler)

  plugins/
    └── matrixPlugin.ts        # Matrix as data source

  scheduler.ts                 # UPDATED: Add task checking, auto-sync

app/
  api/
    matrix/
      ├── config/route.ts      # Matrix credentials CRUD
      ├── rooms/route.ts       # Room management
      └── send/route.ts        # Manual message sending

    scheduled/
      ├── tasks/
      │   ├── route.ts         # List/create tasks
      │   └── [id]/
      │       ├── route.ts     # Get/update/delete task
      │       └── run/route.ts # Trigger immediate execution
      ├── executions/route.ts  # Execution history
      └── upcoming/route.ts    # Next 24-48h timeline

    chat/route.ts              # UPDATED: Support internal requests

  scheduled/
    └── page.tsx               # Main dashboard

components/
  ├── MatrixConfiguration.tsx   # Matrix config UI
  ├── ScheduledTasksList.tsx    # Active tasks table
  ├── UpcomingExecutions.tsx    # Timeline view
  ├── ExecutionHistory.tsx      # Past runs log
  ├── CreateReminderDialog.tsx  # Quick create form
  └── SyncScheduleCard.tsx      # Per-source sync config

prisma/
  migrations/
    └── [timestamp]_add_matrix_and_scheduling/
        └── migration.sql      # Schema changes

  schema.prisma                # UPDATED: New models
```

## 11. Dependencies

```bash
# Install Matrix SDK
pnpm add matrix-js-sdk

# Optional: Cron expression parser (if not using custom parser)
pnpm add cron-parser
pnpm add -D @types/cron-parser
```

## 12. Implementation Phases

### Phase 1: Database & Scheduler Foundation
1. Create Prisma migration (models: MatrixRoom, ScheduledTask, TaskExecution)
2. Update Settings model (Matrix config, sync schedules)
3. Update scheduler.ts (task checking, execution logic)
4. Add auto-sync ScheduledTask creation on startup

### Phase 2: Matrix Integration
1. Install matrix-js-sdk
2. Create lib/matrix/ files (client, messageHandler, sender)
3. Create API routes for Matrix config and rooms
4. Update lib/init.ts to start Matrix client
5. Test message sending/receiving

### Phase 3: Matrix Plugin
1. Create matrixPlugin.ts
2. Implement tools for querying Matrix messages
3. Register plugin in lib/plugins/index.ts
4. Test plugin tools in RAG flow

### Phase 4: RAG Flow Updates
1. Update /api/chat/route.ts for internal requests
2. Add INTERNAL_SERVICE_KEY authentication
3. Test scheduled/matrix trigger sources
4. Add structured response format

### Phase 5: Dashboard UI
1. Create /scheduled page
2. Implement ScheduledTasksList component
3. Implement UpcomingExecutions component
4. Implement ExecutionHistory component
5. Create API routes for task management
6. Test CRUD operations

### Phase 6: Configuration UI
1. Create MatrixConfiguration component
2. Add to /config page
3. Add sync schedule controls to existing configs
4. Test Matrix connection and room management

### Phase 7: Reminder Creation
1. Implement CreateReminderDialog component
2. Add natural language parser (basic patterns)
3. Test reminder creation from UI and Matrix
4. Test reminder execution flow

### Phase 8: Testing & Polish
1. End-to-end testing (reminder creation → execution → Matrix delivery)
2. Error handling improvements
3. Rate limiting implementation
4. Documentation
5. UI polish (loading states, error messages)

## 13. Testing Checklist

- [ ] Matrix connection established
- [ ] Bot joins room successfully
- [ ] Incoming message triggers RAG flow
- [ ] Response sent back to Matrix room
- [ ] Scheduled task created via UI
- [ ] Scheduled task executed at correct time
- [ ] TaskExecution recorded with correct data
- [ ] Auto-sync runs on schedule
- [ ] Fresh data used in reminders
- [ ] Dashboard shows upcoming tasks
- [ ] Dashboard shows execution history
- [ ] Edit task works
- [ ] Pause/resume task works
- [ ] Delete task works
- [ ] Run now triggers immediate execution
- [ ] Multi-room support works
- [ ] Rate limiting prevents spam
- [ ] Error handling shows clear messages
- [ ] Internal service auth works
- [ ] Token encryption works

## 14. Future Enhancements (Optional)

- Natural language parsing improvements (use LLM to parse complex reminders)
- Matrix message history as RAG context (store messages in DB)
- Reminder templates (common patterns)
- Conditional reminders (only send if conditions met)
- Webhook integration for external triggers
- Multi-user Matrix support (per-user reminders)
- Rich formatting in Matrix (images, reactions)
- Thread support for conversations
- Voice message support (transcription)
- Export/import reminder configurations
