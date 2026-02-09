# AGENTS.md - AI Agent Guidelines for pi-antigravity-multiaccount

## Project Overview

This is a TypeScript extension for [pi-coding-agent](https://github.com/badlogic/pi-mono) that implements automatic Google OAuth account rotation for the `google-antigravity` provider to bypass rate limits.

**Current Version:** 1.2.0

---

## Architecture

### Core Components

```
pi-antigravity-multiaccount/
├── account-rotation.ts    # Main extension (~1600 lines)
│   ├── Types & Interfaces
│   ├── Config Management
│   ├── Credentials Management
│   ├── OAuth Flow
│   ├── Rate Limit Detection
│   ├── Rate Limit Wait Logic (NEW in v1.2)
│   ├── Selection Strategies
│   ├── Health Scoring
│   ├── Soft Quota Threshold (NEW in v1.2)
│   ├── Provider Registration
│   ├── Tool: rotate_account
│   ├── Commands: /rotationsetup, /rotationstatus, /rotationconfig
│   └── Custom Rendering
├── package.json           # NPM package with pi config
├── rotation-config.schema.json  # JSON Schema for config
├── test-example.ts        # Test script
└── docs/                  # EN/UA documentation
```

### Key Interfaces

```typescript
type SelectionStrategy = "sticky" | "round-robin" | "hybrid";

interface RotationConfig {
  // Selection strategy
  account_selection_strategy: SelectionStrategy;
  pid_offset_enabled: boolean;
  
  // Rate limiting
  max_rate_limit_wait_seconds: number;
  failure_ttl_seconds: number;
  rate_limit_wait_enabled: boolean;     // NEW in v1.2
  rate_limit_initial_wait_seconds: number; // NEW in v1.2
  
  // Quota management
  soft_quota_threshold_percent: number; // NEW in v1.2
  
  // Behavior
  debug: boolean;
  quiet_mode: boolean;
}

interface AccountCredentials extends OAuthCredentials {
  id: string;
  label?: string;
  addedAt: number;
  enabled: boolean;
}

interface AccountQuotaState {
  lastRateLimitAt?: number;
  rateLimitUntil?: number;
  requestCount: number;
  failureCount: number;
  lastSuccessAt?: number;
}

interface AccountRotationState {
  accounts: AccountCredentials[];
  currentIndex: number;
  rotationCount: number;
  quotaState: Record<string, AccountQuotaState>;
}

interface RotationDetails {
  action: "setup" | "rotate" | "status" | "oauth" | "enable" | "disable" | "config";
  state: AccountRotationState;
  message: string;
  error?: string;
}
```

### Extension API Usage

This extension uses the pi Extension API:

| API | Usage |
|-----|-------|
| `pi.on("session_start/switch/fork/tree", ...)` | State reconstruction |
| `pi.on("model_error", ...)` | Auto-rotation trigger with wait logic |
| `pi.registerTool({...})` | `rotate_account` tool |
| `pi.registerCommand("rotationsetup", {...})` | Setup command |
| `pi.registerCommand("rotationstatus", {...})` | Status command |
| `pi.registerCommand("rotationconfig", {...})` | Config command |
| `pi.registerProvider("google-antigravity", {...})` | OAuth credentials |
| `pi.sendMessage({...})` | Session persistence |
| `pi.registerMessageRenderer("rotation-setup", ...)` | Custom TUI |

---

## Version History

### v1.2.0 (Current)
- **Rate Limit Wait Logic**: Wait before rotating to preserve prompt cache
- **Soft Quota Threshold**: Skip accounts that have high failure rates
- **Exponential Backoff**: Smart wait time calculation (5s, 10s, 20s...)
- **New Config Options**: `rate_limit_wait_enabled`, `rate_limit_initial_wait_seconds`, `soft_quota_threshold_percent`

### v1.1.0
- Configuration file system (`~/.pi/agent/rotation-config.json`)
- Account enable/disable
- Multiple selection strategies (sticky, round-robin, hybrid)
- Debug logging
- Health scoring system
- Quota state tracking
- PID offset for parallel sessions
- `/rotationstatus` and `/rotationconfig` commands

### v1.0.0
- Initial release
- Multi-account storage
- Interactive setup via `/rotationsetup`
- Automatic rotation on rate limits
- Manual rotation via `rotate_account` tool
- Session persistence
- Custom TUI rendering

---

## Development Guidelines

### Adding New Features

1. **State Changes**: Always store state in tool result `details` for proper branching:
```typescript
return {
  content: [{ type: "text", text: "..." }],
  details: { action: "...", state: {...state}, message: "..." } as RotationDetails,
};
```

2. **Session Events**: Handle all session events for state reconstruction:
```typescript
pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));
```

3. **Provider Registration**: Use OAuth config for credentials:
```typescript
pi.registerProvider("google-antigravity", {
  oauth: {
    name: "Google Antigravity (Rotated)",
    async login() { return credentials; },
    async refreshToken(creds) { return refreshOAuthToken(creds.refresh); },
    getApiKey(creds) { return creds.access; },
  },
});
```

### Coding Standards

- **TypeScript**: Strict types, no `any` unless necessary
- **Imports**: Use `@mariozechner/pi-coding-agent`, `@sinclair/typebox`, `@mariozechner/pi-tui`
- **Error Handling**: Always notify user via `ctx.ui.notify()`
- **UI Check**: Always check `ctx.hasUI` before interactive dialogs
- **File Permissions**: Use mode `0o600` for credential files
- **Debug Logging**: Use `debug()` function for all debug output

### Testing

```bash
# Load extension temporarily
pi -e ./account-rotation.ts

# Test commands
/rotationsetup
/rotationstatus
/rotationconfig
rotate_account({ action: "status" })
rotate_account({ action: "health" })

# Debug mode
PI_ROTATION_DEBUG=1 pi -e ./account-rotation.ts
```

---

## Rate Limit Detection Patterns

The extension detects these error patterns:
- HTTP 429 status code
- `"rate limit"` in error message
- `"quota exceeded"` in error message
- `"resource_exhausted"` in error message
- `"too many requests"` in error message
- `"rate_limit_exceeded"` in error message
- 404 errors with `"not found"` (quota-related)

### Adding New Patterns

Edit `isRateLimitError()` function:
```typescript
function isRateLimitError(error: any): boolean {
  const errorStr = typeof error === "string" ? error : JSON.stringify(error).toLowerCase();
  return (
    errorStr.includes("429") ||
    errorStr.includes("rate limit") ||
    // Add new patterns here
  );
}
```

---

## Rate Limit Wait Logic (v1.2.0)

When a rate limit is detected, the extension now:

1. **Checks wait eligibility**: Only waits if multiple accounts are enabled
2. **Calculates wait time**: Uses exponential backoff (5s, 10s, 20s, 40s...)
3. **Waits before rotating**: Preserves prompt cache if wait is reasonable
4. **Rotates if needed**: Switches to healthier account after waiting

```typescript
function calculateWaitTime(failureCount: number, config: RotationConfig): number {
  const baseWait = config.rate_limit_initial_wait_seconds;
  // Exponential backoff: 5, 10, 20, 40... capped at max
  const waitTime = baseWait * Math.pow(2, Math.min(failureCount, 4));
  return Math.min(waitTime, config.max_rate_limit_wait_seconds);
}
```

---

## Soft Quota Threshold (v1.2.0)

Accounts are skipped if they've reached the soft quota threshold:

```typescript
function hasReachedSoftQuota(account, quotaState, config): boolean {
  const quota = quotaState[account.id];
  
  // Currently rate limited
  if (quota.rateLimitUntil && Date.now() < quota.rateLimitUntil) return true;
  
  // High failure rate
  if (quota.requestCount >= 10) {
    const failureRate = (quota.failureCount / quota.requestCount) * 100;
    if (failureRate >= config.soft_quota_threshold_percent) return true;
  }
  
  return false;
}
```

---

## Credential Storage

### File Location
`~/.pi/agent/rotation-credentials.json`

### Format
```json
[
  {
    "id": "acc_1234567890_abc123def",
    "refresh": "ya29.a0...",
    "access": "ya29.a0...",
    "expires": 1707436800000,
    "label": "Work Account",
    "addedAt": 1707433200000,
    "enabled": true
  }
]
```

### Security
- File mode: `0o600` (owner read/write only)
- Never commit credentials to git
- `.gitignore` excludes credential patterns

---

## Configuration

### File Location
`~/.pi/agent/rotation-config.json`

### Default Values
```json
{
  "account_selection_strategy": "hybrid",
  "pid_offset_enabled": false,
  "max_rate_limit_wait_seconds": 60,
  "failure_ttl_seconds": 3600,
  "rate_limit_wait_enabled": true,
  "rate_limit_initial_wait_seconds": 5,
  "soft_quota_threshold_percent": 90,
  "debug": false,
  "quiet_mode": false
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `account_selection_strategy` | `string` | `"hybrid"` | Selection strategy: sticky, round-robin, hybrid |
| `pid_offset_enabled` | `boolean` | `false` | Use PID for initial account selection |
| `max_rate_limit_wait_seconds` | `number` | `60` | Maximum wait time before rotating |
| `failure_ttl_seconds` | `number` | `3600` | Reset failures after this time |
| `rate_limit_wait_enabled` | `boolean` | `true` | Wait before rotating (preserves cache) |
| `rate_limit_initial_wait_seconds` | `number` | `5` | Initial wait time for backoff |
| `soft_quota_threshold_percent` | `number` | `90` | Skip accounts with this failure rate |
| `debug` | `boolean` | `false` | Enable debug logging |
| `quiet_mode` | `boolean` | `false` | Suppress toast notifications |

---

## Known Issues & Workarounds

### Issue: OAuth requires client_id/secret
**Workaround**: Set environment variables:
```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
```
Or use manual token input mode.

### Issue: State not persisting across branches
**Solution**: State is stored in tool result `details`, which is branch-aware by design.

### Issue: Provider credentials not updating
**Solution**: `pi.registerProvider()` with OAuth config dynamically updates credentials.

---

## Implementation Status (RESEARCH_AND_ROADMAP.md)

### Phase 1: Core - COMPLETED
- [x] Configuration file system
- [x] Account enable/disable
- [x] Multiple selection strategies (sticky, round-robin, hybrid)
- [x] Debug logging

### Phase 2: Quota Management - COMPLETED
- [x] Quota state tracking
- [x] Rate limit wait logic
- [x] Soft quota threshold
- [x] Health score system

### Phase 3: Advanced - PARTIAL
- [ ] Dual quota pools (Antigravity + Gemini CLI) - Future
- [x] PID offset for parallel sessions
- [ ] Session recovery - Future

### Phase 4: Polish - IN PROGRESS
- [x] Enhanced commands (/rotationstatus, /rotationconfig)
- [ ] Import/export config - Future
- [ ] npm publish - Pending

---

## Reference Documentation

### pi Extension API
- [extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [custom-provider.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md)
- [session.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/session.md)

### Examples
- [todo.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/todo.ts) - State management pattern
- [summarize.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/summarize.ts) - Custom UI
- [permission-gate.ts](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts) - Tool blocking

### Related Projects
- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - OpenCode plugin reference
- [mitsupi](https://github.com/mitsuhiko/agent-stuff) - pi extensions collection

---

## Contributing

1. Read this AGENTS.md and RESEARCH_AND_ROADMAP.md
2. Follow pi extension patterns
3. Update both EN and UA documentation
4. Test with `pi -e ./account-rotation.ts`
5. Submit PR with clear description

---

## File Manifest

| File | Purpose |
|------|---------|
| `account-rotation.ts` | Main extension code |
| `package.json` | NPM package config |
| `test-example.ts` | Test script |
| `README.md` | English documentation |
| `README_UA.md` | Ukrainian documentation |
| `QUICKSTART.md` / `QUICKSTART_UA.md` | Quick start guides |
| `SETUP.md` / `SETUP_UA.md` | OAuth setup guides |
| `FILES.md` / `FILES_UA.md` | Project structure |
| `COMPLETE.md` | Project completion summary |
| `RESEARCH_AND_ROADMAP.md` | Analysis and improvement plan |
| `AGENTS.md` | This file - AI agent guidelines |

---

**Version:** 1.2.0
**Last Updated:** 2026-02-09
