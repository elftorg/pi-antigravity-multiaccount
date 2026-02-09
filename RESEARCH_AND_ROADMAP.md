# Research Report: Pi Antigravity Multi-Account Extension

## Executive Summary

This document provides a comprehensive analysis of the current pi-antigravity-multiaccount extension, comparison with the opencode-antigravity-auth plugin, and a detailed roadmap for improvements.

---

## 1. Current State Analysis

### 1.1 What Has Been Built

The current `account-rotation.ts` extension (816 lines) provides:

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-account storage | ✅ Complete | File-based + session state |
| Interactive setup (`/rotationsetup`) | ✅ Complete | Manual token + OAuth option |
| Automatic rotation on rate limits | ✅ Complete | Detects 429, quota errors |
| Manual rotation (`rotate_account` tool) | ✅ Complete | Actions: rotate, status |
| Session persistence | ✅ Complete | State in tool results |
| State reconstruction | ✅ Complete | session_start/switch/fork/tree |
| Custom TUI rendering | ✅ Complete | Themed output |
| OAuth 2.0 flow | ⚠️ Partial | Requires client_id/secret env vars |
| Token refresh | ✅ Complete | Automatic refresh on expiry |

### 1.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   pi-coding-agent                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│               account-rotation.ts                        │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────┐              │
│  │ In-Memory State │  │ File Storage     │              │
│  │ - accounts[]    │  │ ~/.pi/agent/     │              │
│  │ - currentIndex  │◄─│ rotation-creds.  │              │
│  │ - rotationCount │  │ json             │              │
│  └─────────────────┘  └──────────────────┘              │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────────────────────────────┐            │
│  │ Event Handlers                          │            │
│  │ - session_start/switch/fork/tree        │            │
│  │ - model_error (auto-rotation)           │            │
│  └─────────────────────────────────────────┘            │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────────────────────────────┐            │
│  │ pi.registerProvider("google-antigravity")│            │
│  │ - OAuth credentials                      │            │
│  │ - Dynamic updates on rotation            │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Key Files

| File | Size | Purpose |
|------|------|---------|
| `account-rotation.ts` | 816 lines | Main extension |
| `package.json` | 33 lines | NPM package config |
| `test-example.ts` | ~100 lines | Test script |
| Documentation | 14 files | EN/UA docs |

---

## 2. Comparison with opencode-antigravity-auth

### 2.1 Feature Comparison

| Feature | Our Extension | opencode-antigravity-auth |
|---------|---------------|---------------------------|
| Multi-account | ✅ | ✅ |
| Auto-rotation | ✅ (on error) | ✅ (proactive + error) |
| Dual quota pools | ❌ | ✅ (Antigravity + Gemini CLI) |
| Quota checking | ❌ | ✅ (API-based) |
| Account enable/disable | ❌ | ✅ |
| PID offset for parallel | ❌ | ✅ |
| Soft quota threshold | ❌ | ✅ |
| Selection strategies | ❌ (round-robin only) | ✅ (sticky/round-robin/hybrid) |
| Rate limit wait | ❌ | ✅ (with max wait) |
| Session recovery | ❌ | ✅ (tool_result_missing) |
| Thinking block handling | N/A | ✅ (strip/cache signatures) |
| Schema cleaning | N/A | ✅ (Antigravity restrictions) |
| Debug logging | ❌ | ✅ |
| Config file | ❌ | ✅ (antigravity.json) |

### 2.2 Architecture Differences

**opencode-antigravity-auth** uses:
- Fetch interceptor pattern (intercepts `fetch()` calls)
- Request/Response transformation pipeline
- Separate modules for auth, request, recovery, quota
- Disk-based caching for signatures
- Per-model-family tracking (Claude vs Gemini)

**Our extension** uses:
- pi Extension API (`registerProvider`, `registerTool`, etc.)
- Event-based architecture (session_*, model_error)
- In-memory + file state
- Session-based persistence

### 2.3 What opencode Has That We Don't

1. **Dual Quota System**
   - Antigravity quota (primary)
   - Gemini CLI quota (fallback)
   - Automatic fallback between pools

2. **Quota Monitoring**
   ```json
   {
     "soft_quota_threshold_percent": 90,
     "quota_refresh_interval_minutes": 15
   }
   ```

3. **Smart Account Selection**
   - Sticky (preserves prompt cache)
   - Round-robin (max throughput)
   - Hybrid (health score + token bucket + LRU)

4. **Parallel Session Support**
   - PID-based offset for oh-my-opencode style parallel agents

5. **Session Recovery**
   - Automatic recovery from tool_result_missing errors
   - Thinking block order recovery

6. **Configuration System**
   - `~/.config/opencode/antigravity.json`
   - JSON schema for validation
   - Environment variables

---

## 3. Gap Analysis

### 3.1 Critical Gaps (High Priority)

| Gap | Impact | Effort |
|-----|--------|--------|
| No quota monitoring | Can't avoid rate limits proactively | Medium |
| Single selection strategy | Cache invalidation, suboptimal throughput | Medium |
| No account enable/disable | Can't handle banned accounts | Low |
| No config file | Must edit code to change settings | Low |
| No dual quota pools | 50% less Gemini quota utilization | High |

### 3.2 Important Gaps (Medium Priority)

| Gap | Impact | Effort |
|-----|--------|--------|
| No debug logging | Hard to troubleshoot | Low |
| No rate limit wait | Immediate failover wastes cache | Medium |
| No PID offset | Conflicts in parallel sessions | Low |
| Limited error patterns | May miss some rate limit errors | Low |

### 3.3 Nice-to-Have Gaps (Low Priority)

| Gap | Impact | Effort |
|-----|--------|--------|
| No CLI for quota check | Less convenient | Low |
| No session recovery | Manual intervention needed | High |
| No thinking handling | N/A for pi (different API) | N/A |

---

## 4. Improvement Proposals

### 4.1 Phase 1: Core Improvements (2-3 days)

#### P1.1 Configuration System
Create `~/.pi/agent/rotation-config.json`:
```json
{
  "$schema": "...",
  "account_selection_strategy": "hybrid",
  "debug": false,
  "max_rate_limit_wait_seconds": 60,
  "soft_quota_threshold_percent": 90
}
```

#### P1.2 Account Enable/Disable
Add `enabled: boolean` field to accounts:
```typescript
interface AccountCredentials extends OAuthCredentials {
  id: string;
  label?: string;
  addedAt: number;
  enabled: boolean;  // NEW
}
```

#### P1.3 Multiple Selection Strategies
```typescript
type SelectionStrategy = "sticky" | "round-robin" | "hybrid";

function selectAccount(strategy: SelectionStrategy): number {
  switch (strategy) {
    case "sticky": return state.currentIndex;
    case "round-robin": return (state.currentIndex + 1) % state.accounts.length;
    case "hybrid": return selectByHealthScore();
  }
}
```

#### P1.4 Debug Logging
```typescript
const debug = (msg: string, ...args: any[]) => {
  if (config.debug || process.env.PI_ROTATION_DEBUG) {
    console.log(`[rotation] ${msg}`, ...args);
  }
};
```

### 4.2 Phase 2: Quota Management (3-4 days)

#### P2.1 Quota Tracking State
```typescript
interface AccountQuotaState {
  lastRateLimitAt?: number;
  rateLimitUntil?: number;
  requestCount: number;
  failureCount: number;
  lastSuccessAt?: number;
}

interface EnhancedState extends AccountRotationState {
  quotaState: Map<string, AccountQuotaState>;
}
```

#### P2.2 Rate Limit Wait Logic
```typescript
async function handleRateLimit(accountId: string): Promise<boolean> {
  const waitTime = calculateWaitTime(accountId);
  
  if (waitTime <= config.max_rate_limit_wait_seconds) {
    // Wait and retry same account (preserves cache)
    await sleep(waitTime * 1000);
    return true;
  }
  
  // Switch accounts
  return await rotateAccount(ctx);
}
```

#### P2.3 Soft Quota Threshold
```typescript
function shouldSkipAccount(accountId: string): boolean {
  const quota = getQuotaUsage(accountId);
  return quota && quota.usagePercent >= config.soft_quota_threshold_percent;
}
```

### 4.3 Phase 3: Advanced Features (5-7 days)

#### P3.1 Dual Quota Pools (Antigravity + Gemini CLI)
```typescript
type QuotaPool = "antigravity" | "gemini-cli";

interface ModelRoute {
  model: string;
  primaryPool: QuotaPool;
  fallbackPool?: QuotaPool;
}

const routes: ModelRoute[] = [
  { model: "claude-*", primaryPool: "antigravity" },
  { model: "gemini-*", primaryPool: "antigravity", fallbackPool: "gemini-cli" },
];
```

#### P3.2 PID-Based Offset
```typescript
function getInitialAccountIndex(): number {
  if (config.pid_offset_enabled) {
    return process.pid % state.accounts.length;
  }
  return 0;
}
```

#### P3.3 Health Score System
```typescript
function calculateHealthScore(account: AccountCredentials): number {
  const quota = quotaState.get(account.id);
  if (!quota) return 100;
  
  let score = 100;
  
  // Penalize recent rate limits
  if (quota.rateLimitUntil && Date.now() < quota.rateLimitUntil) {
    score -= 50;
  }
  
  // Penalize failures
  score -= quota.failureCount * 10;
  
  // Reward recent success
  if (quota.lastSuccessAt && Date.now() - quota.lastSuccessAt < 60000) {
    score += 20;
  }
  
  return Math.max(0, Math.min(100, score));
}
```

### 4.4 Phase 4: Commands & Tools (2-3 days)

#### P4.1 Enhanced `/rotationsetup` Command
- Add account management (enable/disable/remove)
- Show quota status per account
- Import/export configuration

#### P4.2 `/rotationstatus` Command
```
Account Rotation Status
─────────────────────────────────
Strategy: hybrid
Accounts: 3 (2 enabled, 1 disabled)

  #1 work@gmail.com [ACTIVE]
      Health: 95/100
      Requests: 142
      Last rate limit: never
      
  #2 personal@gmail.com
      Health: 60/100  
      Requests: 89
      Last rate limit: 5m ago
      
  #3 backup@gmail.com [DISABLED]
      
Total rotations: 7
─────────────────────────────────
```

#### P4.3 Enhanced `rotate_account` Tool
Add actions:
- `health` - Show health scores
- `reset` - Reset failure counters
- `enable <id>` / `disable <id>`

---

## 5. Implementation Roadmap

### Sprint 1: Foundation (Week 1)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Create config system | P1 | 4h | - |
| Add account enable/disable | P1 | 2h | - |
| Implement selection strategies | P1 | 4h | Config |
| Add debug logging | P1 | 2h | Config |
| Update documentation | P2 | 2h | All above |

**Deliverable:** v1.1.0 with config support and selection strategies

### Sprint 2: Quota Management (Week 2)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Quota state tracking | P1 | 4h | - |
| Rate limit wait logic | P1 | 4h | Quota state |
| Soft quota threshold | P2 | 3h | Quota state |
| Health score system | P2 | 4h | Quota state |
| `/rotationstatus` command | P2 | 3h | Health score |

**Deliverable:** v1.2.0 with proactive quota management

### Sprint 3: Advanced Features (Week 3)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| PID offset support | P1 | 2h | Config |
| Dual quota pools | P2 | 8h | Quota state |
| Enhanced `/rotationsetup` | P2 | 4h | All account features |
| Import/export config | P3 | 2h | Config |
| Unit tests | P2 | 4h | All features |

**Deliverable:** v1.3.0 with parallel session support and dual quotas

### Sprint 4: Polish (Week 4)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Session recovery | P2 | 6h | - |
| Error handling improvements | P1 | 2h | - |
| Performance optimization | P2 | 2h | - |
| Documentation update | P1 | 4h | All features |
| npm publish preparation | P1 | 2h | Tests |

**Deliverable:** v2.0.0 stable release

---

## 6. Technical Specifications

### 6.1 Config File Schema

```typescript
interface RotationConfig {
  // Selection
  account_selection_strategy: "sticky" | "round-robin" | "hybrid";
  pid_offset_enabled: boolean;
  
  // Rate limiting
  max_rate_limit_wait_seconds: number;
  failure_ttl_seconds: number;
  
  // Quotas
  soft_quota_threshold_percent: number;
  quota_fallback: boolean;
  
  // Behavior
  debug: boolean;
  quiet_mode: boolean;
  
  // Claude-specific (future)
  keep_thinking: boolean;
  session_recovery: boolean;
}
```

### 6.2 Enhanced State Structure

```typescript
interface EnhancedAccountRotationState {
  version: number;
  accounts: AccountCredentials[];
  currentIndex: number;
  currentIndexByFamily: {
    claude: number;
    gemini: number;
  };
  rotationCount: number;
  quotaState: Record<string, AccountQuotaState>;
  config: RotationConfig;
}
```

### 6.3 Events to Add

```typescript
// New events for monitoring
pi.on("rotation_performed", (event) => {
  // { fromAccount, toAccount, reason }
});

pi.on("quota_threshold_reached", (event) => {
  // { accountId, usagePercent }
});

pi.on("all_accounts_exhausted", (event) => {
  // { family, waitTime }
});
```

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking changes in pi API | Low | High | Pin versions, test thoroughly |
| OAuth changes by Google | Medium | High | Abstract auth layer |
| Rate limit pattern changes | Low | Medium | Configurable patterns |
| File permission issues | Low | Low | Graceful degradation |
| Performance impact | Low | Low | Lazy loading, caching |

---

## 8. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Rate limit incidents | Unknown | -70% |
| Manual interventions | Frequent | Rare |
| Quota utilization | ~50% | ~90% |
| Configuration changes | Code edits | Config file |
| Parallel session conflicts | Common | Zero |

---

## 9. Conclusion

The current extension provides a solid foundation for account rotation. By implementing the proposed improvements in phases, we can achieve feature parity with opencode-antigravity-auth while leveraging pi's native Extension API for better integration.

**Recommended priority order:**
1. Configuration system (foundation for everything else)
2. Selection strategies (immediate UX improvement)
3. Quota management (proactive vs reactive)
4. Dual quota pools (maximize available quota)
5. Parallel session support (for power users)

---

**Document Version:** 1.0
**Last Updated:** 2026-02-09
**Author:** AI Assistant
