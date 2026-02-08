# Example Account Configuration

This file shows examples of how to format Google OAuth credentials for the rotation extension.

## Format 1: Full OAuth Object (Recommended)

```json
{
  "refresh": "1//0gXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "access": "ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "expires": 1707436800000
}
```

**Fields:**
- `refresh`: Refresh token (starts with `1//0g`)
- `access`: Access token (starts with `ya29.`)
- `expires`: Unix timestamp in milliseconds when the access token expires

## Format 2: Access Token Only

If you only have an access token, paste it directly:

```
ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The extension will use it for both refresh and access, with a default 1-hour expiration.

## Format 3: JSON String Token

```json
"ya29.a0AfB_byXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

Same as Format 2, but wrapped in JSON quotes.

## How to Get Google OAuth Tokens

### Method 1: Using Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the required APIs (e.g., Gemini API)
4. Go to "APIs & Services" → "Credentials"
5. Create OAuth 2.0 Client ID
6. Download the credentials JSON
7. Use OAuth 2.0 Playground or gcloud CLI to get tokens

### Method 2: Using OAuth 2.0 Playground

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check "Use your own OAuth credentials"
4. Enter your Client ID and Client Secret
5. In Step 1, select the APIs you need (e.g., "Google Gemini API v1")
6. Click "Authorize APIs"
7. In Step 2, click "Exchange authorization code for tokens"
8. Copy the `access_token` and `refresh_token`

### Method 3: Using gcloud CLI

```bash
# Install gcloud if not already installed
# https://cloud.google.com/sdk/docs/install

# Login and get credentials
gcloud auth login

# Get access token
gcloud auth print-access-token

# Get full OAuth credentials
gcloud auth application-default print-access-token --format=json
```

### Method 4: Using google-auth-library (Node.js)

```javascript
const { OAuth2Client } = require('google-auth-library');

const oauth2Client = new OAuth2Client(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'YOUR_REDIRECT_URI'
);

// Generate auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/generative-language']
});

console.log('Visit this URL:', authUrl);

// After user authorizes, exchange code for tokens
const { tokens } = await oauth2Client.getToken('AUTHORIZATION_CODE');
console.log(JSON.stringify(tokens, null, 2));
```

## Example: Multiple Accounts Setup

When using `/rotationsetup`, you'll be prompted multiple times. Here's an example session:

```
Add Account (1):
> {"refresh":"1//0gAAA...", "access":"ya29.a0AAA...", "expires":1707436800000}
✓ Account 1 added successfully!

Add Another? Yes

Add Account (2):
> ya29.a0BBB...
✓ Account 2 added successfully!

Add Another? Yes

Add Account (3):
> {"refresh":"1//0gCCC...", "access":"ya29.a0CCC...", "expires":1707440400000}
✓ Account 3 added successfully!

Add Another? No

✓ Setup complete! 3 account(s) configured. Currently using account 1.
```

## Security Notes

⚠️ **IMPORTANT**: OAuth tokens are sensitive credentials that grant access to your Google account!

- **Never commit tokens to version control** (add to `.gitignore`)
- **Don't share tokens publicly**
- **Rotate tokens regularly** for security
- **Use service accounts** for production systems when possible
- **Limit token scopes** to only what's needed
- **Store tokens securely** (environment variables, secret managers)
- **Revoke tokens** when no longer needed

## Token Expiration

- **Access tokens** typically expire after 1 hour
- **Refresh tokens** can be long-lived or expire based on policy
- The extension stores both, but relies on the provider's refresh mechanism
- If tokens expire during rotation, you may need to re-run `/rotationsetup`

## Troubleshooting

### "Invalid credentials format"

Make sure your JSON is valid:
- Use double quotes for keys and string values
- No trailing commas
- Proper escaping of special characters

### "Failed to rotate account"

- Check that tokens are still valid (not expired or revoked)
- Verify the google-antigravity provider is available
- Ensure you have proper API access enabled

### Rate limits still occurring

- Some APIs have per-project limits, not just per-account
- Consider using different Google Cloud projects for each account
- Add more accounts to spread the load
- Implement request throttling in your application

## Best Practices

1. **Use at least 3-5 accounts** for reliable rotation
2. **Test each account** before adding to ensure they work
3. **Monitor rotation counts** to detect if one account is problematic
4. **Set up monitoring** for rate limit events
5. **Have a backup plan** if all accounts are exhausted
6. **Document your setup** for team members

## Advanced: Service Accounts

For production use, consider Google Service Accounts:

```bash
# Create service account
gcloud iam service-accounts create rotation-account-1

# Generate key
gcloud iam service-accounts keys create key1.json \
  --iam-account=rotation-account-1@PROJECT_ID.iam.gserviceaccount.com

# Grant necessary permissions
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:rotation-account-1@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Then use the service account key to generate OAuth tokens.
