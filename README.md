# Google Antigravity Multi-Account Rotation Extension

A TypeScript extension for [pi-coding-agent](https://github.com/badlogic/pi-mono) that implements automatic account rotation for the `google-antigravity` provider to bypass rate limits.

## Features

### v1.3.0 Features (NEW)
- **OAuth Browser Authentication** - Full OAuth 2.0 flow with browser-based login (no manual tokens needed)
- **PKCE Support** - Secure authorization code flow with Proof Key for Code Exchange
- **Auto Browser Launch** - Automatically opens browser for authentication
- **Local Callback Server** - Listens on port 51121 for OAuth callback

### Core Features
- **Multi-Account Storage** - Store multiple Google OAuth credentials in secure file  
- **Interactive Setup** - Configure accounts via `/rotationsetup` command  
- **Automatic Rotation** - Detects rate limit errors (429, 404, quota exceeded) and switches accounts  
- **Manual Control** - Use `rotate_account` tool for manual rotation  
- **Session Persistence** - State survives restarts and works across branches  
- **Custom Rendering** - Beautiful TUI display for rotation events  

### v1.2.x Features
- **Rate Limit Wait Logic** - Wait before rotating to preserve prompt cache
- **Soft Quota Threshold** - Skip accounts with high failure rates
- **Exponential Backoff** - Smart wait time calculation (5s, 10s, 20s...)

### v1.1.0 Features
- **Configuration File** - `~/.pi/agent/rotation-config.json` for persistent settings  
- **Selection Strategies** - Choose between `sticky`, `round-robin`, or `hybrid` (default)  
- **Account Enable/Disable** - Toggle accounts without removing them  
- **Health Scores** - Each account has a 0-100 health score based on history  
- **Debug Logging** - Enable via config or `PI_ROTATION_DEBUG` env variable  
- **PID Offset** - Distribute parallel sessions across accounts  

## Installation

### Option 1: Global Extension

```bash
cp account-rotation.ts ~/.pi/agent/extensions/
```

### Option 2: Project-Local Extension

```bash
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
```

### Option 3: Temporary Loading

```bash
pi -e ./account-rotation.ts
```

## Quick Start

```bash
# 1. Start pi with extension
pi -e ./account-rotation.ts

# 2. Configure accounts
/rotationsetup

# 3. Check status
/rotationstatus

# 4. That's it! Rotation happens automatically on rate limits
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/rotationsetup` | Interactive setup wizard |
| `/rotationstatus` | Show status and health scores |
| `/rotationconfig` | Show current configuration |

### Tool Actions

The `rotate_account` tool supports these actions:

| Action | Description |
|--------|-------------|
| `rotate` | Switch to next account |
| `status` | Show all accounts with details |
| `health` | Show health scores |
| `enable <id>` | Enable an account |
| `disable <id>` | Disable an account |
| `reset` | Clear all failure counters |

Example:
```typescript
rotate_account({ action: "health" })
rotate_account({ action: "disable", accountId: "acc_123..." })
```

## Configuration

The extension uses `~/.pi/agent/rotation-config.json`:

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

### Selection Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `sticky` | Stay on same account until rate limited | Preserving prompt cache |
| `round-robin` | Rotate on every request | Maximum throughput |
| `hybrid` | Use health scores to select best | General use (default) |

### Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `account_selection_strategy` | `hybrid` | How to select accounts |
| `pid_offset_enabled` | `false` | Use PID for initial account selection |
| `max_rate_limit_wait_seconds` | `60` | Max wait before switching accounts |
| `rate_limit_wait_enabled` | `true` | Wait before rotating (preserves cache) |
| `rate_limit_initial_wait_seconds` | `5` | Initial wait time for exponential backoff |
| `soft_quota_threshold_percent` | `90` | Skip accounts with this failure rate |
| `failure_ttl_seconds` | `3600` | Reset failures after this time |
| `debug` | `false` | Enable debug logging |
| `quiet_mode` | `false` | Suppress toast notifications |

## Rate Limit Wait Logic (v1.2.0)

When a rate limit is detected, the extension now:

1. **Checks wait eligibility** - Only waits if multiple accounts are enabled
2. **Calculates wait time** - Uses exponential backoff (5s, 10s, 20s, 40s...)
3. **Waits before rotating** - Preserves prompt cache if wait is reasonable
4. **Rotates if needed** - Switches to healthier account after waiting

This helps preserve prompt cache by waiting briefly before switching accounts.

## Soft Quota Threshold (v1.2.0)

Accounts are automatically skipped if they've reached the soft quota threshold:
- Currently rate limited (rateLimitUntil not expired)
- High failure rate (>= soft_quota_threshold_percent)

This prevents repeatedly trying accounts that are likely to fail.

## Health Scores

Each account has a health score (0-100):

- **100** - Healthy, no issues
- **50-99** - Some past failures or rate limits
- **0-49** - Recent rate limits, may be temporarily avoided
- **Active rate limit** - Score drops to ~20

The `hybrid` strategy uses health scores to select the best account.

## Account Management

### Enable/Disable Accounts

Via `/rotationsetup`:
1. Run `/rotationsetup`
2. Select "Manage existing accounts"
3. Toggle account status

Via tool:
```typescript
rotate_account({ action: "disable", accountId: "acc_123..." })
rotate_account({ action: "enable", accountId: "acc_123..." })
```

### Reset Failure Counters

```typescript
rotate_account({ action: "reset" })
```

## Rate Limit Detection

The extension detects:
- HTTP 429 status code
- "rate limit" in error message
- "quota exceeded" in error message
- "resource_exhausted" in error message
- "rate_limit_exceeded" in error message
- 404 errors with "not found" (quota-related)
- "too many requests" in error message

## Debugging

### Enable Debug Logging

Option 1 - Environment variable:
```bash
PI_ROTATION_DEBUG=1 pi -e ./account-rotation.ts
```

Option 2 - Configuration:
```json
{
  "debug": true
}
```

Option 3 - Via `/rotationsetup`:
1. Select "Configure settings"
2. Toggle debug logging

### Log Output

Debug logs show:
- Configuration loading
- Account selection decisions
- Rate limit detection
- Wait time calculations
- Rotation events
- Health score calculations

## Parallel Sessions

For parallel agents (like oh-my-opencode style):

```json
{
  "pid_offset_enabled": true
}
```

Each process will start with a different account based on PID.

## Files

| File | Location |
|------|----------|
| Extension | `~/.pi/agent/extensions/account-rotation.ts` |
| Credentials | `~/.pi/agent/rotation-credentials.json` |
| Configuration | `~/.pi/agent/rotation-config.json` |

**Security**: Credentials file is created with mode `0o600` (owner only).

## API Reference

### State Structure

```typescript
interface AccountRotationState {
  accounts: AccountCredentials[];
  currentIndex: number;
  rotationCount: number;
  quotaState: Record<string, AccountQuotaState>;
}

interface AccountCredentials {
  id: string;
  refresh: string;
  access: string;
  expires: number;
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
```

### Events Handled

- `session_start/switch/fork/tree` - State reconstruction
- `model_error` - Automatic rotation on rate limits with wait logic

## Troubleshooting

### "No enabled accounts"

All accounts are disabled. Run `/rotationsetup` > "Manage existing accounts" to enable.

### "All accounts may be rate limited"

1. Wait for quota reset (hourly/daily)
2. Add more accounts
3. Reset failure counters: `rotate_account({ action: "reset" })`

### State not persisting

- Check you're not using ephemeral sessions
- Verify session file is being saved
- State is stored in tool result `details`

### Config not loading

- Check file exists: `~/.pi/agent/rotation-config.json`
- Verify JSON syntax
- Check file permissions

## Version History

### v1.2.0 (Current)
- Rate limit wait logic (wait before rotating to preserve cache)
- Soft quota threshold (skip high-failure accounts)
- Exponential backoff for wait times
- New config options: `rate_limit_wait_enabled`, `rate_limit_initial_wait_seconds`, `soft_quota_threshold_percent`

### v1.1.0
- Configuration file system
- Selection strategies (sticky, round-robin, hybrid)
- Account enable/disable
- Health scoring system
- Debug logging
- PID offset support
- `/rotationstatus` and `/rotationconfig` commands

### v1.0.0
- Initial release
- Multi-account storage
- Automatic rotation on rate limits
- Manual rotation via tool
- Session persistence

## License

MIT

## Contributing

See [AGENTS.md](AGENTS.md) and [RESEARCH_AND_ROADMAP.md](RESEARCH_AND_ROADMAP.md) for development guidelines.

## Credits

Built for [pi-coding-agent](https://github.com/badlogic/pi-mono) following the extension API patterns.

Inspired by [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth).
