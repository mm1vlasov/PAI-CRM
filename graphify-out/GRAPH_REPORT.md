# Graph Report - PAI-CRM-main  (2026-09-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 105 nodes · 162 edges · 10 communities (8 shown, 1 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c4e01dd1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- schema.sql
- package.json
- app.js
- api-client.js
- generate-seed.js
- auth.js
- session.js
- server.js
- escapeVal

## God Nodes (most connected - your core abstractions)
1. `requireRole()` - 6 edges
2. `isEmployee()` - 5 edges
3. `isSenior()` - 5 edges
4. `authenticateRequest()` - 5 edges
5. `verifySessionToken()` - 5 edges
6. `members` - 5 edges
7. `hashPassword()` - 4 edges
8. `requireAdmin()` - 4 edges
9. `requireAuth()` - 4 edges
10. `requireEmployee()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `requireEmployee()` --indirect_call--> `isEmployee()`  [INFERRED]
  lib/auth.js → lib/roles.js
- `requireSenior()` --indirect_call--> `isSenior()`  [INFERRED]
  lib/auth.js → lib/roles.js
- `authenticateRequest()` --calls--> `verifySessionToken()`  [EXTRACTED]
  lib/auth.js → lib/session.js
- `requireAdmin()` --indirect_call--> `isAdmin()`  [INFERRED]
  lib/auth.js → lib/roles.js
- `requireVerified()` --indirect_call--> `isVerified()`  [INFERRED]
  lib/auth.js → lib/roles.js

## Import Cycles
- None detected.

## Communities (10 total, 1 thin omitted)

### Community 0 - "schema.sql"
Cohesion: 0.18
Nodes (18): activities, call_candidates, call_scores, meeting_attendance, meetings, members, monthly_log, questions (+10 more)

### Community 1 - "package.json"
Cohesion: 0.12
Nodes (15): dotenv, express, dependencies, dotenv, express, pg, main, name (+7 more)

### Community 2 - "app.js"
Cohesion: 0.20
Nodes (10): app, __dirname, __filename, pool, canAssignRole(), isEmployee(), isSenior(), publicUser() (+2 more)

### Community 3 - "api-client.js"
Cohesion: 0.22
Nodes (9): apiFetch(), getMe(), getMondayOf(), getWeekKey(), isEmployee(), isoDateLocal(), isSenior(), requireAuth() (+1 more)

### Community 4 - "generate-seed.js"
Cohesion: 0.19
Nodes (10): DDL, REPORTS, reportsPath, S, schemaPath, sql, statePath, hashPassword() (+2 more)

### Community 5 - "auth.js"
Cohesion: 0.27
Nodes (12): authenticateRequest(), clearSessionCookie(), parseCookies(), requireAdmin(), requireAuth(), requireEmployee(), requireRole(), requireSenior() (+4 more)

### Community 6 - "session.js"
Cohesion: 0.48
Nodes (6): b64url(), b64urlDecode(), getSecret(), SESSION_COOKIE, signSessionToken(), verifySessionToken()

### Community 7 - "server.js"
Cohesion: 0.40
Nodes (4): app, __dirname, __filename, pool

## Knowledge Gaps
- **28 isolated node(s):** `monthly_log`, `settings`, `main`, `name`, `generate-seed` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 36 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hashPassword()` connect `generate-seed.js` to `app.js`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `monthly_log`, `settings`, `main` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._