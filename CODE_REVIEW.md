# Code Review: Red Court Invitational Tournament Software

## Executive Summary
A well-structured Next.js tournament management system with a React-based admin interface. The codebase demonstrates solid fundamentals but has several areas for improvement in scalability, error handling, and maintainability.

---

## ✅ Strengths

### 1. **Clean Component Architecture**
- Clear separation of concerns (e.g., `Brand`, `Sidebar`, `BracketEditor`, `EntryManager`)
- Reusable UI components like `LevelTabs`, `DivisionTabs`, `MiniMatch`
- Well-organized type definitions at the top of the file

### 2. **Type Safety**
- TypeScript throughout
- Good use of union types (`Level`, `Division`, `AdminSection`)
- Proper typing for complex structures (`BracketData`, `MatchScore`)

### 3. **Smart Tournament Logic**
- Excellent bracket algorithm in `bracket.ts` (balanced first round, automatic advancement)
- Proper handling of walkovers and byes
- Clean separation of bracket logic from UI

### 4. **Optimistic UI Updates**
- Auto-save functionality with good debouncing (900ms)
- Conflict resolution logic for concurrent edits
- Version tracking for optimistic concurrency

### 5. **Accessibility Awareness**
- ARIA labels and roles on interactive elements
- Semantic HTML structure
- Keyboard navigation support through buttons

---

## ⚠️ Issues & Recommendations

### **CRITICAL**

#### 1. **Massive Component File** (`app/page.tsx` is 2000+ lines)
**Problem:** Single component doing too much - rendering, state management, styling all in one file.

**Impact:** 
- Extremely difficult to test
- Hard to maintain/modify
- Poor code reusability
- Performance concerns

**Recommendation:**
```typescript
// Split into separate files:
// app/components/admin/AdminView.tsx (400+ lines)
// app/components/admin/BracketEditor.tsx
// app/components/admin/EntryManager.tsx
// app/components/admin/ScheduleEditor.tsx
// app/components/admin/CourtAssignmentPanel.tsx
// app/components/public/PublicView.tsx
// app/components/shared/Sidebar.tsx
// app/lib/components.ts (utility components)
```

#### 2. **Poor Error Handling**
**Problem:** Silent failures in save operations
```typescript
// Current: swallows errors
const result = await response.json().catch(() => ({}));
```

**Issues:**
- Network errors silently fail
- JSON parse errors ignored
- User left without feedback on failures

**Recommendation:**
```typescript
const parseResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new Error(`Expected JSON, got ${contentType}`);
  }
  return response.json().catch(err => {
    throw new Error(`Failed to parse response: ${err.message}`);
  });
};
```

#### 3. **Memory Leaks & Race Conditions**
**Problem:** No cleanup of `window.setTimeout` in concurrent scenarios
```typescript
// Current - could have multiple timers pending
useEffect(() => {
  if (!saveSequence) return;
  const timer = window.setTimeout(saveBracket, 900);
  return () => window.clearTimeout(timer); // Good cleanup but...
}, [saveSequence]);
```

**Issues:**
- Retry logic could create infinite loops
- Multiple concurrent saves not properly queued
- No exponential backoff on failure

**Recommendation:**
```typescript
// Implement a proper queue with max retries
const saveBracket = useCallback(async () => {
  const maxRetries = 3;
  const baseDelay = 900;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // save logic
      return;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt); // exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}, []);
```

### **HIGH**

#### 4. **No Validation on Score Input**
**Problem:** Score validation is minimal
```typescript
const setScore = (side: 0 | 1, value: number) => {
  const next = Math.max(0, Math.min(31, Number.isFinite(value) ? value : 0));
  // ...
};
```

**Missing:**
- No validation that only 0-31 is valid
- No check that winner is < 31 on non-winning side
- No audit trail of who changed what

**Recommendation:**
```typescript
interface ScoreChange {
  matchId: string;
  userId: string;
  timestamp: number;
  before: MatchScore;
  after: MatchScore;
}

const validateScore = (score: MatchScore): boolean => {
  return score[0] >= 0 && score[0] <= 31 &&
         score[1] >= 0 && score[1] <= 31 &&
         !(score[0] === 31 && score[1] === 31) &&
         !(score[0] > 31 || score[1] > 31);
};
```

#### 5. **Database Schema Lacks Constraints**
**Problem:** `db/schema.ts` is missing critical validations
```typescript
// Current: no constraints
export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey().notNull(),
  division: text("division").notNull(), // no enum check!
  level: text("level").notNull(), // no enum check!
  payload: text("payload").notNull(),
  // no unique constraints, no foreign keys
});
```

**Recommendation:**
```typescript
export const tournamentState = sqliteTable("tournament_state", {
  id: text("id").primaryKey().notNull(),
  division: text("division", { enum: ["Men's Doubles", "Mixed Doubles", "Women's Doubles"] }).notNull(),
  level: text("level", { enum: ["A", "B", "C", "D", "E"] }).notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by"),
}, (table) => ({
  uniqueStateKey: uniqueIndex().on(table.division, table.level),
}));
```

#### 6. **Magic Numbers Throughout**
**Problem:** Hardcoded values scattered everywhere
```typescript
const scores = [
  [21, 18],   // Why these values?
  [17, 21],   // No explanation
  [21, 14],
  [21, 12],
];

const adminColumnWidth = 260;  // Unexplained constant
const adminColumnGap = 64;
const adminStackHeight = Math.max(680, ...);
```

**Recommendation:**
```typescript
// constants.ts
export const TOURNAMENT_CONSTANTS = {
  WINNING_SCORE: 31,
  MAX_LEVEL: 5,
  MOCK_SCORES: [[21, 18], [17, 21], [21, 14], [21, 12]],
  LAYOUT: {
    ADMIN_COLUMN_WIDTH: 260,
    ADMIN_COLUMN_GAP: 64,
    ADMIN_STACK_HEIGHT_MIN: 680,
    PLAYER_COLUMN_WIDTH: 240,
    PLAYER_COLUMN_GAP: 56,
    PLAYER_STACK_HEIGHT_MIN: 520,
  },
  AUTOSAVE_DELAY_MS: 900,
  RETRY_ATTEMPTS: 3,
} as const;
```

### **MEDIUM**

#### 7. **Weak Type Coverage in API**
**Problem:** API routes lack proper typing
```typescript
// app/api/tournament/route.ts probably has loose types
await fetch("/api/tournament", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: key,
    division: snapshotDivision,
    level: snapshotLevel,
    bracket: snapshot,
    baseVersion,
  }),
});
```

**Missing:** API contract types, request/response validation

**Recommendation:**
```typescript
// lib/api-types.ts
export interface TournamentSaveRequest {
  id: string;
  division: TournamentDivision;
  level: TournamentLevel;
  bracket: BracketData;
  baseVersion: number;
}

export interface TournamentSaveResponse {
  version: number;
  bracket?: BracketData;
  error?: string;
}

// Use in API route
export async function PUT(request: Request): Promise<Response> {
  const body = await validateRequest<TournamentSaveRequest>(request);
  // ...
}
```

#### 8. **No Loading States or Skeletons**
**Problem:** Switching between views can feel jarring
- No skeleton loaders for bracket views
- No indication when data is syncing
- Empty state messages could be more helpful

**Recommendation:**
```typescript
const BracketSkeleton = () => (
  <div className="skeleton-bracket">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="skeleton-round" />
    ))}
  </div>
);
```

#### 9. **Confirmation Dialogs Not Accessible**
**Problem:** Modal overlays might trap focus
```typescript
{pendingTeam && (
  <div className="confirmation-backdrop" role="presentation">
    <section
      className="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="duplicate-entry-title"
    >
      {/* Missing: focus trap, ESC key to close */}
    </section>
  </div>
)}
```

**Missing:** Focus management, keyboard event handling, scroll locking

#### 10. **Session State Could Be Cleaner**
**Problem:** Too many refs and sequences
```typescript
const bracketVersionsRef = useRef<Record<string, number>>({});
const bracketSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
const operationsVersionRef = useRef(operationsVersion);
const operationsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
const [saveSequence, setSaveSequence] = useState(0);
const [operationsSequence, setOperationsSequence] = useState(0);
```

**Issue:** Complex ref + state pattern is hard to follow

**Recommendation:**
```typescript
// Use a custom hook
const useSaveQueue = (saveFn: () => Promise<void>, debounceMs: number) => {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<NodeJS.Timeout>();

  const enqueue = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      queueRef.current = queueRef.current
        .catch(() => {})
        .then(saveFn);
    }, debounceMs);
  }, [saveFn, debounceMs]);

  return enqueue;
};
```

### **LOW**

#### 11. **Duplicate Code in Bracket Rendering**
**Problem:** Player and admin bracket rendering has significant duplication
- Nearly identical SVG line drawing
- Same match display logic
- Different only in sizing/styling

**Recommendation:**
Refactor to a shared `BracketRenderer` component with theming options.

#### 12. **Console Logging**
**Problem:** No debug logging for troubleshooting
- Save failures are silent
- Conflict resolution has no audit trail
- Sync issues hard to diagnose

**Recommendation:**
```typescript
const logger = {
  info: (msg: string, data?: any) => console.log(`[${new Date().toISOString()}]`, msg, data),
  error: (msg: string, error?: Error) => console.error(`[${new Date().toISOString()}]`, msg, error),
  debug: (msg: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG]`, msg, data);
    }
  },
};
```

#### 13. **Missing Responsive Design Considerations**
**Problem:** Large bracket layouts may not scale well to mobile
- Fixed pixel widths in SVG and grids
- No mobile-specific views
- Touch interactions not considered

#### 14. **No Internationalization (i18n)**
**Problem:** All text is hardcoded in English
- Tournament name, division names tied to UI
- Easy to hardcode business logic into strings

---

## 🎯 Priority Action Items

### Week 1
1. **Split `page.tsx` into separate components** (biggest impact)
2. **Add proper error handling** with user-facing messages
3. **Extract magic numbers to constants**

### Week 2
4. **Add database constraints** and validation
5. **Implement proper loading/error states**
6. **Create API type contracts**

### Week 3
7. **Refactor save queue logic** to reusable hook
8. **Add audit trail** for score changes
9. **Improve accessibility** of modals

### Ongoing
- Add unit tests for bracket logic (high value, currently untested)
- Add integration tests for save/conflict resolution
- Consider E2E tests for critical user flows

---

## 📊 Code Quality Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Largest file | 2000+ lines | <300 lines |
| Error handling | ~20% | 80%+ |
| Type coverage | ~70% | 95%+ |
| Test coverage | 0% | >60% |
| Accessibility score | ~60% | 90%+ |

---

## 🚀 Quick Wins (Under 1 hour each)

1. Extract `TOURNAMENT_CONSTANTS` object
2. Add `react-focus-lock` to modals
3. Add loading skeleton for bracket views
4. Extract `displayTeamName` to utilities
5. Add error boundary component

---

## 📚 Suggested Dependencies to Add

```json
{
  "use-query-params": "^2.x",      // URL state sync
  "zustand": "^4.x",                // Simpler state mgmt
  "react-query": "^3.x",            // Server state
  "zod": "^3.x",                    // Runtime validation
  "focus-lock": "^0.x",             // Modal focus management
  "@sentry/react": "^7.x"           // Error tracking
}
```

---

## 🔍 Files Needing Most Attention

1. **`app/page.tsx`** - Split into 8+ components (URGENT)
2. **`lib/tournament-data.ts`** - Add more validation
3. **`db/schema.ts`** - Add constraints
4. **API routes** - Standardize error handling

---

## Questions for Product/Design

1. What's the maximum number of concurrent users?
2. Should there be an audit log of all changes?
3. What happens if internet drops mid-save?
4. Should admins be able to undo bracket changes?
5. Any mobile requirements for tournament scorekeepers?

