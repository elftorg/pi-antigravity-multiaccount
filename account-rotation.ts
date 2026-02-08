/**
 * Account Rotation Extension for google-antigravity provider with OAuth support
 * 
 * Automatically rotates through multiple Google OAuth credentials to bypass rate limits.
 * 
 * Features:
 * - Full OAuth 2.0 flow with browser authentication
 * - Store multiple Google OAuth credentials in secure file + session state
 * - Interactive setup via /rotationsetup command with OAuth option
 * - Automatic rotation on rate limit errors (429, 404, quota exceeded)
 * - Manual rotation via rotate_account tool
 * - State reconstruction from session entries across branches
 * - Secure credential storage in ~/.pi/agent/rotation-credentials.json
 * - Custom rendering for rotation events
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

interface AccountCredentials extends OAuthCredentials {
	id: string; // Unique account ID
	label?: string; // Optional user-friendly label
	addedAt: number; // Timestamp when added
}

interface AccountRotationState {
	accounts: AccountCredentials[];
	currentIndex: number;
	rotationCount: number;
}

interface RotationDetails {
	action: "setup" | "rotate" | "status" | "oauth";
	state: AccountRotationState;
	message: string;
	error?: string;
}

const RotateAccountParams = Type.Object({
	action: StringEnum(["rotate", "status"] as const),
});

// Path to credentials file
const CREDENTIALS_FILE = join(homedir(), ".pi", "agent", "rotation-credentials.json");

/**
 * OAuth configuration for Google Antigravity
 */
const GOOGLE_OAUTH_CONFIG = {
	authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenUrl: "https://oauth2.googleapis.com/token",
	clientId: process.env.GOOGLE_CLIENT_ID || "",
	clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
	redirectUri: "http://localhost:8888/callback",
	scope: "https://www.googleapis.com/auth/generative-language.retriever",
};

/**
 * Save credentials to secure file
 */
function saveCredentials(accounts: AccountCredentials[]): void {
	try {
		const dir = dirname(CREDENTIALS_FILE);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(CREDENTIALS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
	} catch (error) {
		console.error("Failed to save credentials:", error);
	}
}

/**
 * Load credentials from secure file
 */
function loadCredentials(): AccountCredentials[] {
	try {
		if (!existsSync(CREDENTIALS_FILE)) {
			return [];
		}
		const data = readFileSync(CREDENTIALS_FILE, "utf-8");
		return JSON.parse(data);
	} catch (error) {
		console.error("Failed to load credentials:", error);
		return [];
	}
}

/**
 * Generate OAuth authorization URL
 */
function generateAuthUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: GOOGLE_OAUTH_CONFIG.clientId,
		redirect_uri: GOOGLE_OAUTH_CONFIG.redirectUri,
		response_type: "code",
		scope: GOOGLE_OAUTH_CONFIG.scope,
		access_type: "offline",
		prompt: "consent",
		state,
	});

	return `${GOOGLE_OAUTH_CONFIG.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string): Promise<OAuthCredentials> {
	const params = new URLSearchParams({
		code,
		client_id: GOOGLE_OAUTH_CONFIG.clientId,
		client_secret: GOOGLE_OAUTH_CONFIG.clientSecret,
		redirect_uri: GOOGLE_OAUTH_CONFIG.redirectUri,
		grant_type: "authorization_code",
	});

	const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const data = await response.json();

	return {
		refresh: data.refresh_token || "",
		access: data.access_token,
		expires: Date.now() + (data.expires_in || 3600) * 1000,
	};
}

/**
 * Refresh OAuth access token
 */
async function refreshOAuthToken(refreshToken: string): Promise<OAuthCredentials> {
	const params = new URLSearchParams({
		refresh_token: refreshToken,
		client_id: GOOGLE_OAUTH_CONFIG.clientId,
		client_secret: GOOGLE_OAUTH_CONFIG.clientSecret,
		grant_type: "refresh_token",
	});

	const response = await fetch(GOOGLE_OAUTH_CONFIG.tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token refresh failed: ${error}`);
	}

	const data = await response.json();

	return {
		refresh: refreshToken, // Keep original refresh token
		access: data.access_token,
		expires: Date.now() + (data.expires_in || 3600) * 1000,
	};
}

/**
 * Start local server to handle OAuth callback
 */
async function startOAuthServer(): Promise<{ code: string; state: string }> {
	return new Promise((resolve, reject) => {
		const http = require("node:http");
		const server = http.createServer((req: any, res: any) => {
			const url = new URL(req.url, `http://${req.headers.host}`);

			if (url.pathname === "/callback") {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p></body></html>`);
					server.close();
					reject(new Error(`OAuth error: ${error}`));
					return;
				}

				if (code && state) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						`<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to pi.</p></body></html>`
					);
					server.close();
					resolve({ code, state });
					return;
				}

				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(`<html><body><h1>Invalid Request</h1></body></html>`);
			}
		});

		server.listen(8888, () => {
			console.log("OAuth callback server started on http://localhost:8888");
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth timeout - no response received"));
		}, 5 * 60 * 1000);
	});
}

/**
 * Check if an error message indicates a rate limit
 */
function isRateLimitError(error: any): boolean {
	if (!error) return false;

	const errorStr = typeof error === "string" ? error : JSON.stringify(error).toLowerCase();

	return (
		errorStr.includes("429") ||
		errorStr.includes("rate limit") ||
		errorStr.includes("quota exceeded") ||
		errorStr.includes("resource_exhausted") ||
		(errorStr.includes("404") && errorStr.includes("not found")) ||
		errorStr.includes("too many requests")
	);
}

/**
 * Parse OAuth credentials from user input
 */
function parseCredentials(input: string): Omit<AccountCredentials, "id" | "addedAt"> | null {
	try {
		// Try parsing as JSON first
		const parsed = JSON.parse(input);

		// Check if it's a full OAuth object
		if (parsed.refresh && parsed.access) {
			return {
				refresh: parsed.refresh,
				access: parsed.access,
				expires: parsed.expires || Date.now() + 3600000,
				label: parsed.label,
			};
		}

		// Check if it's just an access token
		if (typeof parsed === "string") {
			return {
				refresh: parsed,
				access: parsed,
				expires: Date.now() + 3600000,
			};
		}

		return null;
	} catch {
		// If not JSON, treat as plain access token
		const token = input.trim();
		if (token.length > 0) {
			return {
				refresh: token,
				access: token,
				expires: Date.now() + 3600000,
			};
		}
		return null;
	}
}

/**
 * Generate unique ID for account
 */
function generateAccountId(): string {
	return `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default function (pi: ExtensionAPI) {
	// In-memory state (reconstructed from session on load)
	let state: AccountRotationState = {
		accounts: [],
		currentIndex: 0,
		rotationCount: 0,
	};

	// Load credentials from file on startup
	const loadAccountsFromFile = () => {
		const accounts = loadCredentials();
		if (accounts.length > 0) {
			state.accounts = accounts;
			console.log(`Loaded ${accounts.length} account(s) from credentials file`);
		}
	};

	/**
	 * Reconstruct state from session entries
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		// First try to load from file
		loadAccountsFromFile();

		// Then check session for current index and rotation count
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;

			// Check tool results from rotate_account tool
			if (msg.role === "toolResult" && msg.toolName === "rotate_account") {
				const details = msg.details as RotationDetails | undefined;
				if (details?.state) {
					// Only update index and count, keep accounts from file
					state.currentIndex = details.state.currentIndex;
					state.rotationCount = details.state.rotationCount;
				}
			}

			// Check custom messages from /rotationsetup
			if (msg.role === "custom") {
				const customMsg = msg as any;
				if (customMsg.customType === "rotation-setup") {
					const details = customMsg.details as RotationDetails | undefined;
					if (details?.state) {
						state.currentIndex = details.state.currentIndex;
						state.rotationCount = details.state.rotationCount;
					}
				}
			}
		}
	};

	/**
	 * Switch to the next available account
	 */
	const rotateAccount = async (ctx: ExtensionContext): Promise<boolean> => {
		if (state.accounts.length === 0) {
			ctx.ui.notify("No accounts configured for rotation. Use /rotationsetup to add accounts.", "error");
			return false;
		}

		if (state.accounts.length === 1) {
			ctx.ui.notify("Only one account configured. Cannot rotate.", "warning");
			return false;
		}

		// Move to next account
		const previousIndex = state.currentIndex;
		state.currentIndex = (state.currentIndex + 1) % state.accounts.length;
		state.rotationCount++;

		const newCredentials = state.accounts[state.currentIndex];

		// Check if token needs refresh
		let credentials = newCredentials;
		if (credentials.expires && credentials.expires < Date.now() + 60000) {
			// Token expires in less than 1 minute
			try {
				ctx.ui.notify("Refreshing expired token...", "info");
				credentials = await refreshOAuthToken(credentials.refresh);
				// Update stored credentials
				state.accounts[state.currentIndex] = {
					...newCredentials,
					...credentials,
				};
				saveCredentials(state.accounts);
			} catch (error) {
				ctx.ui.notify(`Failed to refresh token: ${error}`, "error");
				// Try next account
				state.currentIndex = (state.currentIndex + 1) % state.accounts.length;
				return rotateAccount(ctx);
			}
		}

		// Try to update the provider credentials
		try {
			// Register provider with new credentials
			pi.registerProvider("google-antigravity", {
				oauth: {
					name: "Google Antigravity (Rotated)",
					async login() {
						return credentials;
					},
					async refreshToken(creds: OAuthCredentials) {
						return refreshOAuthToken(creds.refresh);
					},
					getApiKey(creds: OAuthCredentials) {
						return creds.access;
					},
				},
			});

			const label = newCredentials.label || `#${state.currentIndex + 1}`;
			ctx.ui.notify(
				`Rotated to account ${label} (${state.currentIndex + 1}/${state.accounts.length}) - rotation #${state.rotationCount}`,
				"success"
			);

			return true;
		} catch (error) {
			ctx.ui.notify(`Failed to rotate account: ${error}`, "error");
			// Revert to previous index on failure
			state.currentIndex = previousIndex;
			return false;
		}
	};

	// Reconstruct state on session events
	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	// Listen for model errors and auto-rotate on rate limits
	pi.on("model_error", async (event, ctx) => {
		if (isRateLimitError(event.error)) {
			ctx.ui.notify("Rate limit detected. Attempting to rotate account...", "warning");

			const success = await rotateAccount(ctx);

			if (!success && state.accounts.length > 0) {
				ctx.ui.notify(
					`All ${state.accounts.length} account(s) may be rate limited. Please wait before retrying.`,
					"error"
				);
			}
		}
	});

	// Register the rotate_account tool for manual rotation
	pi.registerTool({
		name: "rotate_account",
		label: "Rotate Account",
		description: "Manually rotate to the next Google Antigravity account or check rotation status",
		parameters: RotateAccountParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "status") {
				const accounts = state.accounts.map((acc, i) => {
					const label = acc.label || `Account ${i + 1}`;
					const current = i === state.currentIndex ? " (current)" : "";
					const expires = new Date(acc.expires).toLocaleString();
					return `  ${label}${current} - expires: ${expires}`;
				});

				const status =
					state.accounts.length === 0
						? "No accounts configured"
						: `${state.accounts.length} account(s) configured:\n${accounts.join("\n")}\n\nRotations performed: ${state.rotationCount}`;

				return {
					content: [{ type: "text", text: status }],
					details: {
						action: "status",
						state: { ...state },
						message: status,
					} as RotationDetails,
				};
			}

			// Rotate action
			if (state.accounts.length === 0) {
				return {
					content: [{ type: "text", text: "No accounts configured. Use /rotationsetup to add accounts." }],
					details: {
						action: "rotate",
						state: { ...state },
						message: "No accounts",
						error: "No accounts configured",
					} as RotationDetails,
				};
			}

			const success = await rotateAccount(ctx);

			if (success) {
				const label = state.accounts[state.currentIndex].label || `#${state.currentIndex + 1}`;
				const message = `Rotated to account ${label} (${state.currentIndex + 1}/${state.accounts.length})`;
				return {
					content: [{ type: "text", text: message }],
					details: {
						action: "rotate",
						state: { ...state },
						message,
					} as RotationDetails,
				};
			} else {
				return {
					content: [{ type: "text", text: "Failed to rotate account" }],
					details: {
						action: "rotate",
						state: { ...state },
						message: "Rotation failed",
						error: "Failed to update provider credentials",
					} as RotationDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("rotate_account "));
			text += theme.fg("muted", args.action);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as RotationDetails | undefined;

			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
			}

			let text = "";
			if (details.action === "rotate") {
				text = theme.fg("success", "✓ ") + theme.fg("muted", details.message);
			} else {
				text = theme.fg("accent", "ⓘ ") + theme.fg("muted", details.message);
			}

			if (expanded && details.state.accounts.length > 0) {
				text += "\n" + theme.fg("dim", `Accounts: ${details.state.accounts.length}`);
				text += "\n" + theme.fg("dim", `Current: #${details.state.currentIndex + 1}`);
				text += "\n" + theme.fg("dim", `Rotations: ${details.state.rotationCount}`);
			}

			return new Text(text, 0, 0);
		},
	});

	// Register /rotationsetup command
	pi.registerCommand("rotationsetup", {
		description: "Configure multiple Google Antigravity accounts for automatic rotation (with OAuth support)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/rotationsetup requires interactive mode", "error");
				return;
			}

			ctx.ui.notify("Starting account rotation setup...", "info");

			// Show current state
			if (state.accounts.length > 0) {
				const proceed = await ctx.ui.confirm(
					"Existing Configuration",
					`${state.accounts.length} account(s) already configured. Add more accounts?`
				);
				if (!proceed) {
					return;
				}
			}

			// Check if OAuth is configured
			const hasOAuthConfig =
				GOOGLE_OAUTH_CONFIG.clientId && GOOGLE_OAUTH_CONFIG.clientSecret;

			// Collect accounts
			let addingAccounts = true;
			let newAccounts: AccountCredentials[] = [...state.accounts];

			while (addingAccounts) {
				// Ask for method
				const methods = ["Manual Token Input", "OAuth 2.0 Flow (Browser)"];
				if (!hasOAuthConfig) {
					methods[1] += " (Not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)";
				}

				const method = await ctx.ui.select(
					`Add Account (${newAccounts.length + 1}) - Choose Method:`,
					methods
				);

				if (!method) {
					// User cancelled
					const done = await ctx.ui.confirm("Cancel Setup", "Stop adding accounts and save current configuration?");
					if (done) {
						addingAccounts = false;
					}
					continue;
				}

				if (method.includes("OAuth") && hasOAuthConfig) {
					// OAuth flow
					try {
						ctx.ui.notify("Starting OAuth flow...", "info");

						const stateParam = generateAccountId();
						const authUrl = generateAuthUrl(stateParam);

						ctx.ui.notify(`Opening browser for authentication...\n${authUrl}`, "info");
						ctx.ui.notify("Waiting for OAuth callback on http://localhost:8888...", "info");

						// Start local server and wait for callback
						const serverPromise = startOAuthServer();

						// Give user option to manually enter callback URL
						const manualInput = await ctx.ui.confirm(
							"Browser Authentication",
							`Browser should open automatically. If not, visit:\n${authUrl}\n\nWaiting for callback...`,
							{ timeout: 10000 }
						);

						let credentials: OAuthCredentials;

						if (!manualInput) {
							// Wait for server callback
							const { code, state: returnedState } = await serverPromise;

							if (returnedState !== stateParam) {
								throw new Error("State mismatch - possible security issue");
							}

							// Exchange code for tokens
							ctx.ui.notify("Exchanging code for tokens...", "info");
							credentials = await exchangeCodeForTokens(code);
						} else {
							// Manual fallback
							const callbackUrl = await ctx.ui.input(
								"Manual Callback",
								"Paste the callback URL from your browser"
							);

							if (!callbackUrl) {
								ctx.ui.notify("OAuth cancelled.", "warning");
								continue;
							}

							const url = new URL(callbackUrl);
							const code = url.searchParams.get("code");

							if (!code) {
								throw new Error("No authorization code in callback URL");
							}

							credentials = await exchangeCodeForTokens(code);
						}

						// Ask for optional label
						const label = await ctx.ui.input(
							"Account Label (optional)",
							`e.g., "Work Account", "Personal", etc.`
						);

						const account: AccountCredentials = {
							id: generateAccountId(),
							...credentials,
							label: label || undefined,
							addedAt: Date.now(),
						};

						newAccounts.push(account);
						ctx.ui.notify(`Account ${newAccounts.length} added successfully via OAuth!`, "success");
					} catch (error) {
						ctx.ui.notify(`OAuth failed: ${error}`, "error");
						const retry = await ctx.ui.confirm("OAuth Error", "Try adding this account again?");
						if (!retry) {
							addingAccounts = false;
						}
						continue;
					}
				} else {
					// Manual token input
					const input = await ctx.ui.input(
						`Add Account (${newAccounts.length + 1})`,
						'Paste OAuth JSON {"refresh":"...","access":"...","expires":...} or access token'
					);

					if (!input) {
						// User cancelled
						const done = await ctx.ui.confirm("Cancel Setup", "Stop adding accounts and save current configuration?");
						if (done) {
							addingAccounts = false;
						}
						continue;
					}

					const credentials = parseCredentials(input);

					if (!credentials) {
						ctx.ui.notify("Invalid credentials format. Please try again.", "error");
						const retry = await ctx.ui.confirm("Invalid Input", "Try adding this account again?");
						if (!retry) {
							addingAccounts = false;
						}
						continue;
					}

					// Ask for optional label
					const label = await ctx.ui.input("Account Label (optional)", `e.g., "Account A", "Backup", etc.`);

					const account: AccountCredentials = {
						id: generateAccountId(),
						...credentials,
						label: label || undefined,
						addedAt: Date.now(),
					};

					newAccounts.push(account);
					ctx.ui.notify(`Account ${newAccounts.length} added successfully!`, "success");
				}

				const addMore = await ctx.ui.confirm(
					"Add Another?",
					`${newAccounts.length} account(s) configured. Add another account?`
				);

				if (!addMore) {
					addingAccounts = false;
				}
			}

			if (newAccounts.length === 0) {
				ctx.ui.notify("No accounts configured. Setup cancelled.", "warning");
				return;
			}

			// Update state and save to file
			state.accounts = newAccounts;
			state.currentIndex = 0;
			saveCredentials(state.accounts);

			// Persist to session
			pi.sendMessage(
				{
					customType: "rotation-setup",
					content: `Configured ${state.accounts.length} account(s) for rotation`,
					display: true,
					details: {
						action: "setup",
						state: { ...state },
						message: `Setup complete: ${state.accounts.length} account(s)`,
					} as RotationDetails,
				},
				{ triggerTurn: false }
			);

			// Apply the first account
			if (state.accounts.length > 0) {
				try {
					const firstAccount = state.accounts[0];
					pi.registerProvider("google-antigravity", {
						oauth: {
							name: "Google Antigravity (Multi-Account)",
							async login() {
								return firstAccount;
							},
							async refreshToken(creds: OAuthCredentials) {
								return refreshOAuthToken(creds.refresh);
							},
							getApiKey(creds: OAuthCredentials) {
								return creds.access;
							},
						},
					});

					const label = firstAccount.label || "Account 1";
					ctx.ui.notify(
						`Setup complete! ${state.accounts.length} account(s) configured. Currently using ${label}.`,
						"success"
					);
				} catch (error) {
					ctx.ui.notify(`Setup complete but failed to activate account: ${error}`, "warning");
				}
			}
		},
	});

	// Register custom message renderer for rotation-setup messages
	pi.registerMessageRenderer("rotation-setup", (message, theme) => {
		const details = message.details as RotationDetails | undefined;
		if (!details) {
			return new Text(theme.fg("muted", String(message.content)), 0, 0);
		}

		let text = theme.fg("accent", "🔄 Account Rotation: ");
		text += theme.fg("success", details.message);

		if (details.state.accounts.length > 0) {
			text += "\n" + theme.fg("dim", `  • ${details.state.accounts.length} account(s) configured`);
			const currentLabel =
				details.state.accounts[details.state.currentIndex]?.label || `Account ${details.state.currentIndex + 1}`;
			text += "\n" + theme.fg("dim", `  • Active: ${currentLabel}`);
		}

		return new Text(text, 0, 0);
	});

	// Initialize on load
	loadAccountsFromFile();
}
