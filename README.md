# Google Antigravity Multi-Account Rotation Extension

A TypeScript extension for [pi-coding-agent](https://github.com/badlogic/pi-mono) that implements automatic account rotation for the `google-antigravity` provider to bypass rate limits.

## Features

✅ **Multi-Account Storage** - Store multiple Google OAuth credentials in session state  
✅ **Interactive Setup** - Configure accounts via `/rotationsetup` command  
✅ **Automatic Rotation** - Detects rate limit errors (429, 404, quota exceeded) and switches accounts  
✅ **Manual Control** - Use `rotate_account` tool for manual rotation  
✅ **Session Persistence** - State survives restarts and works across branches  
✅ **Custom Rendering** - Beautiful TUI display for rotation events  

## Installation

### Option 1: Global Extension

Place the extension in your global pi extensions directory:

```bash
# Copy to global extensions folder
cp account-rotation.ts ~/.pi/agent/extensions/

# Or create a symlink for development
ln -s $(pwd)/account-rotation.ts ~/.pi/agent/extensions/account-rotation.ts
```

### Option 2: Project-Local Extension

Place the extension in your project's `.pi/extensions/` directory:

```bash
# Create project extensions directory
mkdir -p .pi/extensions

# Copy or symlink the extension
cp account-rotation.ts .pi/extensions/
```

### Option 3: Temporary Loading

Load the extension for a single session:

```bash
pi -e ./account-rotation.ts
```

## Usage

### 1. Configure Accounts

Use the `/rotationsetup` command to add multiple Google Antigravity accounts:

```
/rotationsetup
```

The interactive wizard will prompt you to add accounts. For each account, you can provide:

**Option A: Full OAuth JSON**
```json
{"refresh":"ya29...", "access":"ya29...", "expires":1707436800000}
```

**Option B: Just the access token** (refresh token will be set to the same value)
```
ya29.a0AfB_byC...
```

The extension will:
- Validate each credential
- Allow you to add multiple accounts
- Persist the configuration in the session
- Activate the first account automatically

### 2. Automatic Rotation

Once configured, the extension automatically monitors for rate limit errors:

- **429 Too Many Requests**
- **404 Not Found** (quota-related)
- **Resource Exhausted**
- **Quota Exceeded** messages

When detected, it will:
1. Show a notification: "Rate limit detected. Attempting to rotate account..."
2. Switch to the next account in the list
3. Update the `google-antigravity` provider with new credentials
4. Show success: "Rotated to account 2/5 (rotation #1)"

If all accounts are exhausted, you'll see:
```
All 5 account(s) may be rate limited. Please wait before retrying.
```

### 3. Manual Rotation

The LLM can manually trigger account rotation using the `rotate_account` tool:

**Rotate to next account:**
```typescript
// LLM calls this automatically when needed
rotate_account({ action: "rotate" })
```

**Check rotation status:**
```typescript
rotate_account({ action: "status" })
// Returns: "5 account(s) configured, currently using account 2, 3 rotation(s) performed"
```

### 4. View Status

After setup, you can view the current configuration in session:

- Look for the "🔄 Account Rotation" message in your chat
- Use the `rotate_account` tool with `action: "status"`
- Press `Ctrl+O` on tool results to expand and see details

## State Persistence

The extension stores state in session entries, which means:

- ✅ **Survives restarts** - Configuration persists across pi sessions
- ✅ **Branch-aware** - Each branch has the correct state for that point in history
- ✅ **Fork-safe** - Forking a session preserves account configuration
- ✅ **Tree navigation** - State reconstructs correctly when navigating conversation trees

State is reconstructed from:
- Tool results from `rotate_account` calls
- Custom messages from `/rotationsetup` command

## Implementation Details

### Rate Limit Detection

The extension detects these error patterns:
- HTTP 429 status code
- "rate limit" in error message
- "quota exceeded" in error message
- "resource_exhausted" in error message
- 404 errors that mention "not found" (quota-related)
- "too many requests" in error message

### Provider Credential Update

The extension uses `pi.registerProvider()` with OAuth configuration to dynamically update credentials:

```typescript
pi.registerProvider("google-antigravity", {
  oauth: {
    name: "Google Antigravity (Multi-Account)",
    async login() {
      return currentAccountCredentials;
    },
    async refreshToken(creds) {
      return creds; // Use stored credentials
    },
    getApiKey(creds) {
      return creds.access;
    },
  },
});
```

### State Structure

```typescript
interface AccountRotationState {
  accounts: OAuthCredentials[];  // List of all accounts
  currentIndex: number;           // Index of active account
  rotationCount: number;          // Total rotations performed
}

interface OAuthCredentials {
  refresh: string;  // Refresh token
  access: string;   // Access token
  expires: number;  // Expiration timestamp
}
```

## Example Session

```
You: /rotationsetup
Pi: Starting account rotation setup...

[Dialog: Add Account (1)]
> {"refresh":"ya29.a0...", "access":"ya29.a0...", "expires":1707436800000}
✓ Account 1 added successfully!

[Dialog: Add Another?]
> Yes

[Dialog: Add Account (2)]
> ya29.a1...
✓ Account 2 added successfully!

[Dialog: Add Another?]
> No

✓ Setup complete! 2 account(s) configured. Currently using account 1.

🔄 Account Rotation: Setup complete: 2 account(s)
  • 2 account(s) configured
  • Active: Account 1

You: Generate a large dataset
Pi: [... uses account 1 ...]
⚠️ Rate limit detected. Attempting to rotate account...
✓ Rotated to account 2/2 (rotation #1)
Pi: [... continues with account 2 ...]
```

## Troubleshooting

### "No accounts configured"

Run `/rotationsetup` to add accounts first.

### "Failed to rotate account"

The extension couldn't update the provider credentials. Check:
- OAuth credentials are valid
- google-antigravity provider is available
- No other extensions are interfering with provider registration

### Accounts still rate limited

If all accounts hit rate limits:
1. Wait for the quota reset period (usually hourly or daily)
2. Add more accounts via `/rotationsetup`
3. Consider spreading requests across longer time periods

### State not persisting

The extension stores state in session tool results and custom messages. Ensure:
- You're not using ephemeral sessions
- The session file is being saved properly
- You're reconstructing from the correct branch

## Development

### Testing

```bash
# Test with the extension loaded
pi -e ./account-rotation.ts

# Test commands
/rotationsetup
rotate_account({ action: "status" })
```

### Debugging

Add console.log statements to see state changes:

```typescript
const rotateAccount = async (ctx: ExtensionContext): Promise<boolean> => {
  console.log("Current state:", state);
  // ... rest of function
};
```

Run pi with verbose logging:

```bash
DEBUG=* pi -e ./account-rotation.ts
```

## Architecture

The extension follows the stateful tool pattern from pi's `todo.ts` example:

1. **State in Memory** - `AccountRotationState` object
2. **Persistence via Tools** - Store state in tool result `details`
3. **Reconstruction** - Rebuild state from session entries on load
4. **Session Events** - Listen to `session_start`, `session_switch`, `session_fork`, `session_tree`
5. **Event Handling** - React to `model_error` for automatic rotation

## API Reference

### `/rotationsetup` Command

Interactive wizard to configure accounts.

### `rotate_account` Tool

**Parameters:**
- `action`: `"rotate"` | `"status"`

**Returns:**
- Text description of the action
- `RotationDetails` in `details` field

### Events

- `model_error` - Triggers automatic rotation on rate limits
- `session_start/switch/fork/tree` - Reconstructs state

## License

MIT

## Contributing

Contributions welcome! Please follow the pi extension development guidelines in the [pi documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs).

## Credits

Built for [pi-coding-agent](https://github.com/badlogic/pi-mono) by following the extension API patterns and examples.
