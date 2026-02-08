# Quick Start Guide

Get up and running with Google Antigravity account rotation in 5 minutes!

## Step 1: Install the Extension

Choose one of these methods:

**Global (recommended for regular use):**
```bash
# Copy to global extensions folder
mkdir -p ~/.pi/agent/extensions
cp account-rotation.ts ~/.pi/agent/extensions/
```

**Project-local:**
```bash
# Create project extensions folder
mkdir -p .pi/extensions
cp account-rotation.ts .pi/extensions/
```

**Temporary (for testing):**
```bash
# Load just for this session
pi -e ./account-rotation.ts
```

## Step 2: Get Google OAuth Tokens

You need access tokens for multiple Google accounts. The easiest method:

### Using OAuth 2.0 Playground

1. Visit https://developers.google.com/oauthplayground/
2. Click the gear icon ⚙️, check "Use your own OAuth credentials"
3. Enter your OAuth Client ID and Secret
4. Select scopes (e.g., "Google Gemini API v1")
5. Click "Authorize APIs" and sign in
6. Click "Exchange authorization code for tokens"
7. Copy the tokens!

Repeat for each Google account you want to add.

## Step 3: Configure Accounts

Launch pi and run the setup:

```bash
pi
```

Then in pi:

```
/rotationsetup
```

Follow the prompts:

```
Add Account (1)
> Paste your first account's OAuth JSON or access token

[SUCCESS] Account 1 added!

Add Another? Yes

Add Account (2) 
> Paste your second account's OAuth JSON or access token

[SUCCESS] Account 2 added!

Add Another? No

[SUCCESS] Setup complete! 2 account(s) configured.
```

## Step 4: Verify It Works

Check the status:

```
Ask pi: "Use the rotate_account tool to check rotation status"
```

Pi should respond with something like:
```
rotate_account({ action: "status" })
→ 2 account(s) configured, currently using account 1, 0 rotation(s) performed
```

## Step 5: Test Automatic Rotation

Now just use pi normally! When you hit a rate limit:

```
You: [Your request that triggers rate limit]

[Pi makes API call]
⚠️ Rate limit detected. Attempting to rotate account...
✓ Rotated to account 2/2 (rotation #1)

[Pi continues with new account]
```

## Common Issues

### "No accounts configured"
→ Run `/rotationsetup` first

### "Invalid credentials format"  
→ Make sure you're pasting valid JSON or a plain token string

### "Failed to rotate account"
→ Check that:
  - Tokens are still valid (not expired)
  - google-antigravity provider exists
  - You have API access enabled

## Tips

- **Use 3+ accounts** for better rotation
- **Test each token** before adding (make a test API call)
- **Check status periodically** to see rotation counts
- **Re-run /rotationsetup** if you need to add more accounts
- **Store backup tokens** somewhere safe

## What's Next?

- Read [README.md](README.md) for full documentation
- Check [SETUP.md](SETUP.md) for detailed token generation guides
- Run [test-example.ts](test-example.ts) to understand the internals

## Example Session

Here's a complete example from start to finish:

```bash
# 1. Start pi with extension
pi -e ./account-rotation.ts

# 2. Configure accounts
> /rotationsetup
[Add 3 accounts via interactive prompts]

# 3. Use normally
> "Generate a comprehensive analysis of..."

[Works fine with account 1]

> "Now generate another analysis..."

[Rate limit hit]
⚠️ Rate limit detected. Attempting to rotate account...
✓ Rotated to account 2/3 (rotation #1)

[Continues with account 2]

> "And one more analysis..."

[Rate limit hit again]
⚠️ Rate limit detected. Attempting to rotate account...
✓ Rotated to account 3/3 (rotation #2)

[Continues with account 3]

# 4. Check status anytime
> "What's the rotation status?"

[Pi uses rotate_account tool]
→ 3 account(s) configured, currently using account 3, 2 rotation(s) performed
```

## Advanced: Scripting

You can also check status programmatically:

```typescript
// In your pi session, the LLM can:
rotate_account({ action: "status" })  // Check status
rotate_account({ action: "rotate" })  // Manually rotate
```

## Need Help?

- Check the [README.md](README.md) for detailed docs
- Review [SETUP.md](SETUP.md) for credential formats
- File an issue if you find bugs
- Contribute improvements!

---

**That's it!** You now have automatic account rotation for Google Antigravity. 🎉

When you hit rate limits, the extension will automatically switch accounts and keep working!
