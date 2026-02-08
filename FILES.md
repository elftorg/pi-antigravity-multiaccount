# Pi Antigravity Multi-Account Extension - Files Summary

## 📁 Project Structure

```
pi-antigravity-multiaccount/
├── account-rotation.ts     # Main extension file
├── package.json           # NPM package configuration
├── README.md             # Full documentation
├── QUICKSTART.md         # 5-minute quick start guide
├── SETUP.md              # Detailed OAuth token setup guide
├── test-example.ts       # Example test/validation script
├── .gitignore           # Git ignore file (protects credentials)
└── FILES.md             # This file
```

## 📄 File Descriptions

### `account-rotation.ts` (12.9 KB)
**The main extension implementation**

Key features:
- Stores multiple OAuth credentials in session state
- `/rotationsetup` command for interactive account configuration
- Listens to `model_error` event for automatic rotation
- `rotate_account` tool for manual control
- State reconstruction from session entries
- Custom rendering for rotation events

Architecture highlights:
- Follows pi's stateful tool pattern (like `todo.ts`)
- Uses `pi.appendEntry()` for persistence
- Reconstructs state on session events
- Dynamically updates provider via `pi.registerProvider()`

### `package.json` (801 bytes)
**NPM package configuration**

Enables sharing as a pi package:
- Declares as ESM module
- Specifies peer dependencies
- Defines extension entry point
- Ready for npm/git distribution

### `README.md` (8.2 KB)
**Complete documentation**

Sections:
- Features overview
- Installation options (global/project/temporary)
- Usage guide (setup, automatic, manual)
- State persistence explanation
- Implementation details
- Example session
- Troubleshooting
- API reference

### `QUICKSTART.md` (4.3 KB)
**Fast 5-minute setup guide**

For users who want to get started immediately:
- Step-by-step installation
- OAuth token generation (simplified)
- Account configuration walkthrough
- Verification steps
- Common issues + solutions
- Complete example session

### `SETUP.md` (5.6 KB)
**Detailed OAuth credential guide**

In-depth credential documentation:
- Multiple credential format examples
- 4 methods to obtain Google OAuth tokens
  - Google Cloud Console
  - OAuth 2.0 Playground
  - gcloud CLI
  - google-auth-library
- Security best practices
- Token expiration handling
- Service account setup
- Troubleshooting

### `test-example.ts` (3.9 KB)
**Test and validation script**

Demonstrates:
- Credential parsing logic
- Rate limit detection logic
- Example usage scenarios
- Testing different input formats
- Validation of core functions

Can be run with:
```bash
npx tsx test-example.ts
```

### `.gitignore` (466 bytes)
**Git ignore configuration**

Protects sensitive data:
- Credentials and OAuth tokens
- Session files
- Build outputs
- IDE files
- OS-specific files

Critical for security!

## 🎯 Usage Patterns

### Pattern 1: Global Installation
```bash
cp account-rotation.ts ~/.pi/agent/extensions/
pi
> /rotationsetup
```

### Pattern 2: Project-Specific
```bash
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
pi
> /rotationsetup
```

### Pattern 3: Development/Testing
```bash
pi -e ./account-rotation.ts
> /rotationsetup
```

### Pattern 4: As NPM Package
```bash
npm install pi-extension-antigravity-rotation
# Extension auto-loads from node_modules
pi
> /rotationsetup
```

## 🔧 Key Components

### State Management
```typescript
interface AccountRotationState {
  accounts: OAuthCredentials[];
  currentIndex: number;
  rotationCount: number;
}
```

### Event Handlers
- `session_start` → Reconstruct state
- `session_switch` → Reconstruct state
- `session_fork` → Reconstruct state
- `session_tree` → Reconstruct state
- `model_error` → Auto-rotate on rate limit

### Commands & Tools
- `/rotationsetup` → Interactive account configuration
- `rotate_account` → Manual rotation tool for LLM
  - `action: "rotate"` → Switch to next account
  - `action: "status"` → Show current state

### Provider Integration
```typescript
pi.registerProvider("google-antigravity", {
  oauth: {
    async login() { return currentCredentials; },
    async refreshToken(creds) { return creds; },
    getApiKey(creds) { return creds.access; }
  }
});
```

## 📊 State Persistence

The extension stores state in two ways:

1. **Tool Results** - `rotate_account` tool stores state in `details`
2. **Custom Messages** - `/rotationsetup` stores state in custom messages

State is reconstructed by scanning the current branch for:
- Tool results with `toolName === "rotate_account"`
- Custom messages with `customType === "rotation-setup"`

This ensures:
- ✅ Survives restarts
- ✅ Correct state per branch
- ✅ Works with fork/tree navigation
- ✅ No external files needed

## 🎨 Custom Rendering

### Tool Call Rendering
```
rotate_account status
```

### Tool Result Rendering
```
✓ Rotated to account 2/5 (rotation #1)
  • Accounts: 5
  • Current: #2
  • Rotations: 1
```

### Custom Message Rendering
```
🔄 Account Rotation: Setup complete: 3 account(s)
  • 3 account(s) configured
  • Active: Account 1
```

## 🚨 Error Detection

Detects these rate limit patterns:
- `429` HTTP status
- `"rate limit"`
- `"quota exceeded"`
- `"resource_exhausted"`
- `404` + `"not found"` (quota-related)
- `"too many requests"`

## 🔒 Security Notes

⚠️ **CRITICAL**: OAuth tokens grant full API access!

Security measures in `.gitignore`:
- All JSON files (except package.json)
- Credentials folders
- Environment files
- OAuth token files
- Session data

Always:
- Store tokens in environment variables
- Use `.gitignore` to prevent commits
- Rotate tokens regularly
- Revoke unused tokens
- Limit token scopes

## 📦 Distribution

The extension can be shared via:

1. **Direct file copy** - Copy `account-rotation.ts` to extensions folder
2. **Git repository** - Clone and link/copy
3. **NPM package** - `npm install pi-extension-antigravity-rotation`
4. **Pi package** - Add to `settings.json`:
   ```json
   {
     "packages": ["git:github.com/user/pi-antigravity-multiaccount"]
   }
   ```

## 🧪 Testing

Run the test example:
```bash
npx tsx test-example.ts
```

Test in pi:
```bash
pi -e ./account-rotation.ts
> /rotationsetup
[Add test accounts]
> rotate_account({ action: "status" })
```

## 🤝 Contributing

To improve this extension:

1. Fork the repository
2. Make changes to `account-rotation.ts`
3. Test with `pi -e ./account-rotation.ts`
4. Update documentation if needed
5. Submit a pull request

## 📖 Documentation Hierarchy

1. **QUICKSTART.md** - Read this first (5 min)
2. **README.md** - Full documentation (15 min)
3. **SETUP.md** - OAuth credential details (when needed)
4. **FILES.md** - Project structure (this file)

## 🎓 Learning Resources

To understand the implementation:

1. Read pi's `examples/extensions/todo.ts` for stateful pattern
2. Check `docs/extensions.md` for API reference
3. Review `docs/custom-provider.md` for provider registration
4. Study `test-example.ts` for core logic

## ✨ Features Summary

✅ Multi-account storage in session state  
✅ Interactive setup via `/rotationsetup`  
✅ Automatic rotation on rate limits  
✅ Manual rotation via `rotate_account` tool  
✅ State persistence across sessions/branches  
✅ Custom TUI rendering  
✅ Graceful error handling  
✅ Security via `.gitignore`  
✅ Complete documentation  
✅ Example test script  

## 📝 License

MIT - See individual files for full license text

## 🔗 Links

- [pi-coding-agent](https://github.com/badlogic/pi-mono)
- [Extension API Docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
- [Google Cloud Console](https://console.cloud.google.com/)

---

**Ready to use!** Copy `account-rotation.ts` to `~/.pi/agent/extensions/` and run `/rotationsetup` in pi.
