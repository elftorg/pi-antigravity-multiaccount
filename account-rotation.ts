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
 * - Configuration file support (~/.pi/agent/rotation-config.json)
 * - Multiple selection strategies (sticky, round-robin, hybrid)
 * - Account enable/disable
 * - Debug logging
 * - Rate limit wait logic (wait before rotating to preserve cache)
 * - Soft quota threshold
 * - Health scoring system
 * 
 * @version 1.3.0
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

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type SelectionStrategy = "sticky" | "round-robin" | "hybrid";

interface RotationConfig {
	// Selection strategy
	account_selection_strategy: SelectionStrategy;
	pid_offset_enabled: boolean;
	
	// Rate limiting
	max_rate_limit_wait_seconds: number;
	failure_ttl_seconds: number;
	rate_limit_wait_enabled: boolean;
	rate_limit_initial_wait_seconds: number;
	
	// Quota management
	soft_quota_threshold_percent: number;
	
	// Behavior
	debug: boolean;
	quiet_mode: boolean;
}

interface AccountCredentials extends OAuthCredentials {
	id: string; // Unique account ID
	label?: string; // Optional user-friendly label
	addedAt: number; // Timestamp when added
	enabled: boolean; // Whether account is enabled for rotation
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

const RotateAccountParams = Type.Object({
	action: StringEnum(["rotate", "status", "enable", "disable", "health", "reset"] as const),
	accountId: Type.Optional(Type.String({ description: "Account ID for enable/disable actions" })),
});

// ============================================================================
// CONSTANTS & DEFAULTS
// ============================================================================

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const CREDENTIALS_FILE = join(PI_AGENT_DIR, "rotation-credentials.json");
const CONFIG_FILE = join(PI_AGENT_DIR, "rotation-config.json");

// Maximum recursion depth for rotateAccount to prevent infinite loops
const MAX_ROTATION_DEPTH = 5;

const DEFAULT_CONFIG: RotationConfig = {
	account_selection_strategy: "hybrid",
	pid_offset_enabled: false,
	max_rate_limit_wait_seconds: 60,
	failure_ttl_seconds: 3600,
	rate_limit_wait_enabled: true,
	rate_limit_initial_wait_seconds: 5,
	soft_quota_threshold_percent: 90,
	debug: false,
	quiet_mode: false,
};

// ============================================================================
// LOGGING
// ============================================================================

let debugEnabled = false;

function debug(msg: string, ...args: any[]): void {
	if (debugEnabled || process.env.PI_ROTATION_DEBUG) {
		const timestamp = new Date().toISOString().slice(11, 23);
		console.log(`[rotation ${timestamp}] ${msg}`, ...args);
	}
}

function debugState(label: string, state: any): void {
	if (debugEnabled || process.env.PI_ROTATION_DEBUG) {
		debug(`${label}:`, JSON.stringify(state, null, 2));
	}
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate wait time based on failure count (exponential backoff)
 */
function calculateWaitTime(failureCount: number, config: RotationConfig): number {
	const baseWait = config.rate_limit_initial_wait_seconds;
	// Exponential backoff: 5, 10, 20, 40... capped at max
	const waitTime = baseWait * Math.pow(2, Math.min(failureCount, 4));
	return Math.min(waitTime, config.max_rate_limit_wait_seconds);
}

/**
 * OAuth configuration for Google Antigravity
 * Credentials from opencode-antigravity-auth (public OAuth client)
 */
const ANTIGRAVITY_OAUTH_CONFIG = {
	authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenUrl: "https://oauth2.googleapis.com/token",
	clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
	clientSecret: "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",
	redirectUri: "http://localhost:51121/oauth-callback",
	port: 51121,
	scopes: [
		"https://www.googleapis.com/auth/cloud-platform",
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/userinfo.profile",
		"https://www.googleapis.com/auth/cclog",
		"https://www.googleapis.com/auth/experimentsandconfigs",
	],
};

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

/**
 * Load configuration from file, with defaults
 */
function loadConfig(): RotationConfig {
	try {
		if (!existsSync(CONFIG_FILE)) {
			debug("Config file not found, using defaults");
			return { ...DEFAULT_CONFIG };
		}
		const data = readFileSync(CONFIG_FILE, "utf-8");
		const parsed = JSON.parse(data);
		const config = { ...DEFAULT_CONFIG, ...parsed };
		debug("Loaded config:", config);
		return config;
	} catch (error) {
		console.error("Failed to load config:", error);
		return { ...DEFAULT_CONFIG };
	}
}

/**
 * Save configuration to file
 */
function saveConfig(config: RotationConfig): void {
	try {
		const dir = dirname(CONFIG_FILE);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
		debug("Saved config to", CONFIG_FILE);
	} catch (error) {
		console.error("Failed to save config:", error);
	}
}

// ============================================================================
// CREDENTIALS MANAGEMENT
// ============================================================================

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
		// Invalidate cache since accounts may have changed
		invalidateEnabledAccountsCache();
		debug(`Saved ${accounts.length} account(s) to credentials file`);
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
			debug("Credentials file not found");
			return [];
		}
		const data = readFileSync(CREDENTIALS_FILE, "utf-8");
		const accounts = JSON.parse(data);
		// Migrate old accounts without 'enabled' field
		const migrated = accounts.map((acc: any) => ({
			...acc,
			enabled: acc.enabled !== undefined ? acc.enabled : true,
		}));
		debug(`Loaded ${migrated.length} account(s) from credentials file`);
		return migrated;
	} catch (error) {
		console.error("Failed to load credentials:", error);
		return [];
	}
}

/**
 * Generate PKCE code verifier (random string)
 */
function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate PKCE code challenge from verifier (SHA-256 hash, base64url encoded)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
	// Convert to base64url
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate OAuth authorization URL with PKCE
 */
function generateAuthUrl(state: string, codeChallenge: string): string {
	const params = new URLSearchParams({
		client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
		redirect_uri: ANTIGRAVITY_OAUTH_CONFIG.redirectUri,
		response_type: "code",
		scope: ANTIGRAVITY_OAUTH_CONFIG.scopes.join(" "),
		access_type: "offline",
		prompt: "consent",
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});

	return `${ANTIGRAVITY_OAUTH_CONFIG.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens (with PKCE support)
 */
async function exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<OAuthCredentials> {
	const params: Record<string, string> = {
		code,
		client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
		client_secret: ANTIGRAVITY_OAUTH_CONFIG.clientSecret,
		redirect_uri: ANTIGRAVITY_OAUTH_CONFIG.redirectUri,
		grant_type: "authorization_code",
	};
	
	if (codeVerifier) {
		params.code_verifier = codeVerifier;
	}

	const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(params).toString(),
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
		client_id: ANTIGRAVITY_OAUTH_CONFIG.clientId,
		client_secret: ANTIGRAVITY_OAUTH_CONFIG.clientSecret,
		grant_type: "refresh_token",
	});

	const response = await fetch(ANTIGRAVITY_OAUTH_CONFIG.tokenUrl, {
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

			if (url.pathname === "/oauth-callback") {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Authentication Failed</h1><p style="color: red;">${error}</p><p>You can close this window.</p></body></html>`);
					server.close();
					reject(new Error(`OAuth error: ${error}`));
					return;
				}

				if (code && state) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(
						`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1 style="color: green;">Authentication Successful!</h1><p>You can close this window and return to pi.</p></body></html>`
					);
					server.close();
					resolve({ code, state });
					return;
				}

				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Invalid Request</h1><p>Missing code or state parameter.</p></body></html>`);
			} else {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h1>Not Found</h1><p>Waiting for OAuth callback at /oauth-callback</p></body></html>`);
			}
		});

		server.listen(ANTIGRAVITY_OAUTH_CONFIG.port, () => {
			debug(`OAuth callback server started on http://localhost:${ANTIGRAVITY_OAUTH_CONFIG.port}`);
		});

		server.on("error", (err: any) => {
			if (err.code === "EADDRINUSE") {
				reject(new Error(`Port ${ANTIGRAVITY_OAUTH_CONFIG.port} is already in use. Please close other applications using this port.`));
			} else {
				reject(new Error(`Server error: ${err.message}`));
			}
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth timeout - no response received within 5 minutes"));
		}, 5 * 60 * 1000);
	});
}

/**
 * Check if an error message indicates a rate limit
 */
function isRateLimitError(error: any): boolean {
	if (!error) return false;

	const errorStr = typeof error === "string" ? error : JSON.stringify(error).toLowerCase();

	const isRateLimit = (
		errorStr.includes("429") ||
		errorStr.includes("rate limit") ||
		errorStr.includes("quota exceeded") ||
		errorStr.includes("resource_exhausted") ||
		(errorStr.includes("404") && errorStr.includes("not found")) ||
		errorStr.includes("too many requests") ||
		errorStr.includes("rate_limit_exceeded")
	);

	if (isRateLimit) {
		debug("Detected rate limit error:", errorStr.slice(0, 200));
	}

	return isRateLimit;
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

// ============================================================================
// SELECTION STRATEGIES & HEALTH SCORING
// ============================================================================

/**
 * Get enabled accounts only (with simple caching)
 * Cache is invalidated when accounts array reference changes
 */
let _enabledAccountsCache: { accounts: AccountCredentials[], result: AccountCredentials[] } | null = null;

function getEnabledAccounts(accounts: AccountCredentials[]): AccountCredentials[] {
	// Simple cache: if same accounts array reference, return cached result
	if (_enabledAccountsCache && _enabledAccountsCache.accounts === accounts) {
		return _enabledAccountsCache.result;
	}
	
	const result = accounts.filter(acc => acc.enabled);
	_enabledAccountsCache = { accounts, result };
	return result;
}

/**
 * Invalidate enabled accounts cache (call when accounts are modified)
 */
function invalidateEnabledAccountsCache(): void {
	_enabledAccountsCache = null;
}

/**
 * Clean up expired failures based on TTL
 * This resets failure counts for accounts whose last failure was longer ago than failure_ttl_seconds
 */
function cleanupExpiredFailures(
	quotaState: Record<string, AccountQuotaState>,
	config: RotationConfig
): void {
	const now = Date.now();
	const ttlMs = config.failure_ttl_seconds * 1000;
	
	for (const accountId of Object.keys(quotaState)) {
		const quota = quotaState[accountId];
		if (quota.failureCount > 0 && quota.lastRateLimitAt) {
			if (now - quota.lastRateLimitAt > ttlMs) {
				debug(`Resetting expired failures for account ${accountId} (TTL: ${config.failure_ttl_seconds}s)`);
				quota.failureCount = 0;
				quota.rateLimitUntil = undefined;
			}
		}
	}
}

/**
 * Check if account has reached soft quota threshold
 * Based on failure patterns and recent rate limits
 */
function hasReachedSoftQuota(
	account: AccountCredentials,
	quotaState: Record<string, AccountQuotaState>,
	config: RotationConfig
): boolean {
	const quota = quotaState[account.id];
	if (!quota) return false;
	
	// Check if currently rate limited
	if (quota.rateLimitUntil && Date.now() < quota.rateLimitUntil) {
		debug(`Account ${account.label || account.id} is currently rate limited`);
		return true;
	}
	
	// Check failure rate if we have enough requests
	if (quota.requestCount >= 10) {
		const failureRate = (quota.failureCount / quota.requestCount) * 100;
		if (failureRate >= config.soft_quota_threshold_percent) {
			debug(`Account ${account.label || account.id} has high failure rate: ${failureRate.toFixed(1)}%`);
			return true;
		}
	}
	
	return false;
}

/**
 * Calculate health score for an account (0-100)
 */
function calculateHealthScore(
	account: AccountCredentials, 
	quotaState: Record<string, AccountQuotaState>,
	config: RotationConfig
): number {
	const quota = quotaState[account.id];
	if (!quota) return 100;
	
	let score = 100;
	const now = Date.now();
	
	// Check if currently rate limited
	if (quota.rateLimitUntil && now < quota.rateLimitUntil) {
		score -= 80; // Heavily penalize active rate limits
	}
	
	// Penalize recent rate limits (within last hour)
	if (quota.lastRateLimitAt && now - quota.lastRateLimitAt < 3600000) {
		const minutesAgo = (now - quota.lastRateLimitAt) / 60000;
		score -= Math.max(0, 30 - minutesAgo * 0.5); // Decrease penalty over time
	}
	
	// Penalize failures (reset after TTL)
	if (quota.failureCount > 0) {
		const lastFailure = quota.lastRateLimitAt || 0;
		if (now - lastFailure < config.failure_ttl_seconds * 1000) {
			score -= Math.min(50, quota.failureCount * 10);
		}
	}
	
	// Reward recent success
	if (quota.lastSuccessAt && now - quota.lastSuccessAt < 60000) {
		score += 10;
	}
	
	return Math.max(0, Math.min(100, score));
}

/**
 * Select next account based on strategy
 */
function selectNextAccount(
	accounts: AccountCredentials[],
	currentIndex: number,
	quotaState: Record<string, AccountQuotaState>,
	config: RotationConfig,
	forceRotate: boolean = false
): number {
	const enabledAccounts = getEnabledAccounts(accounts);
	
	if (enabledAccounts.length === 0) {
		debug("No enabled accounts available");
		return currentIndex;
	}
	
	if (enabledAccounts.length === 1) {
		const idx = accounts.findIndex(a => a.id === enabledAccounts[0].id);
		debug("Only one enabled account, using index:", idx);
		return idx;
	}
	
	const strategy = config.account_selection_strategy;
	debug(`Selecting account with strategy: ${strategy}, forceRotate: ${forceRotate}`);
	
	switch (strategy) {
		case "sticky": {
			// Stay on current account unless forced to rotate or it's disabled
			const currentAccount = accounts[currentIndex];
			if (!forceRotate && currentAccount?.enabled) {
				debug("Sticky: staying on current account");
				return currentIndex;
			}
			// Find next enabled account
			for (let i = 1; i <= accounts.length; i++) {
				const nextIdx = (currentIndex + i) % accounts.length;
				if (accounts[nextIdx].enabled) {
					debug("Sticky: rotating to next enabled account:", nextIdx);
					return nextIdx;
				}
			}
			return currentIndex;
		}
		
		case "round-robin": {
			// Always rotate to next enabled account
			for (let i = 1; i <= accounts.length; i++) {
				const nextIdx = (currentIndex + i) % accounts.length;
				if (accounts[nextIdx].enabled) {
					debug("Round-robin: rotating to account:", nextIdx);
					return nextIdx;
				}
			}
			return currentIndex;
		}
		
		case "hybrid":
		default: {
			// Select based on health score, skip accounts at soft quota threshold
			let bestIdx = currentIndex;
			let bestScore = -1;
			
			for (let i = 0; i < accounts.length; i++) {
				const acc = accounts[i];
				if (!acc.enabled) continue;
				
				// Skip accounts that have reached soft quota threshold
				if (hasReachedSoftQuota(acc, quotaState, config)) {
					debug(`Skipping ${acc.label || acc.id} - at soft quota threshold`);
					continue;
				}
				
				const score = calculateHealthScore(acc, quotaState, config);
				debug(`Health score for ${acc.label || acc.id}: ${score}`);
				
				// Prefer different account if current is rate limited
				const isCurrent = i === currentIndex;
				const adjustedScore = isCurrent && forceRotate ? score - 20 : score;
				
				if (adjustedScore > bestScore) {
					bestScore = adjustedScore;
					bestIdx = i;
				}
			}
			
			debug("Hybrid: selected account with score", bestScore, "at index", bestIdx);
			return bestIdx;
		}
	}
}

/**
 * Get initial account index (with PID offset support)
 */
function getInitialAccountIndex(accounts: AccountCredentials[], config: RotationConfig): number {
	const enabledAccounts = getEnabledAccounts(accounts);
	if (enabledAccounts.length === 0) return 0;
	
	if (config.pid_offset_enabled) {
		const offset = process.pid % enabledAccounts.length;
		const selectedAccount = enabledAccounts[offset];
		const actualIdx = accounts.findIndex(a => a.id === selectedAccount.id);
		debug(`PID offset enabled: pid=${process.pid}, offset=${offset}, actualIdx=${actualIdx}`);
		return actualIdx;
	}
	
	// Default to first enabled account
	const firstEnabled = accounts.findIndex(a => a.enabled);
	return firstEnabled >= 0 ? firstEnabled : 0;
}

export default function (pi: ExtensionAPI) {
	// Load configuration
	let config = loadConfig();
	debugEnabled = config.debug;
	debug("Extension starting with config:", config);

	// In-memory state (reconstructed from session on load)
	let state: AccountRotationState = {
		accounts: [],
		currentIndex: 0,
		rotationCount: 0,
		quotaState: {},
	};

	// Load credentials from file on startup
	const loadAccountsFromFile = () => {
		const accounts = loadCredentials();
		if (accounts.length > 0) {
			state.accounts = accounts;
			// Set initial index with PID offset if enabled
			if (state.currentIndex === 0) {
				state.currentIndex = getInitialAccountIndex(accounts, config);
			}
			debug(`Loaded ${accounts.length} account(s), current index: ${state.currentIndex}`);
		}
	};

	/**
	 * Reconstruct state from session entries
	 */
	const reconstructState = (ctx: ExtensionContext) => {
		// Reload config in case it changed
		config = loadConfig();
		debugEnabled = config.debug;

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
					// Merge quota state
					state.quotaState = { ...state.quotaState, ...details.state.quotaState };
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

		debug("State reconstructed:", {
			accountCount: state.accounts.length,
			currentIndex: state.currentIndex,
			rotationCount: state.rotationCount,
		});
	};

	/**
	 * Record rate limit for an account
	 */
	const recordRateLimit = (accountId: string) => {
		const now = Date.now();
		const existing = state.quotaState[accountId] || {
			requestCount: 0,
			failureCount: 0,
		};
		
		state.quotaState[accountId] = {
			...existing,
			lastRateLimitAt: now,
			rateLimitUntil: now + config.max_rate_limit_wait_seconds * 1000,
			failureCount: existing.failureCount + 1,
		};
		
		debug(`Recorded rate limit for ${accountId}:`, state.quotaState[accountId]);
	};

	/**
	 * Record success for an account
	 */
	const recordSuccess = (accountId: string) => {
		const existing = state.quotaState[accountId] || {
			requestCount: 0,
			failureCount: 0,
		};
		
		state.quotaState[accountId] = {
			...existing,
			lastSuccessAt: Date.now(),
			requestCount: existing.requestCount + 1,
		};
	};

	/**
	 * Switch to the next available account
	 * @param ctx Extension context
	 * @param forceRotate Force rotation even if current account is healthy
	 * @param depth Recursion depth to prevent infinite loops (max: MAX_ROTATION_DEPTH)
	 */
	const rotateAccount = async (ctx: ExtensionContext, forceRotate: boolean = true, depth: number = 0): Promise<boolean> => {
		// Prevent infinite recursion
		if (depth >= MAX_ROTATION_DEPTH) {
			debug(`Max rotation depth (${MAX_ROTATION_DEPTH}) reached, stopping recursion`);
			if (!config.quiet_mode) {
				ctx.ui.notify("Max rotation attempts reached. All accounts may have issues.", "error");
			}
			return false;
		}

		// Clean up expired failures before selecting
		cleanupExpiredFailures(state.quotaState, config);

		const enabledAccounts = getEnabledAccounts(state.accounts);
		
		if (enabledAccounts.length === 0) {
			if (!config.quiet_mode) {
				ctx.ui.notify("No enabled accounts for rotation. Use /rotationsetup to add accounts.", "error");
			}
			debug("No enabled accounts available");
			return false;
		}

		if (enabledAccounts.length === 1 && forceRotate) {
			const currentAccount = state.accounts[state.currentIndex];
			if (currentAccount?.enabled) {
				if (!config.quiet_mode) {
					ctx.ui.notify("Only one enabled account. Cannot rotate.", "warning");
				}
				debug("Only one enabled account, cannot rotate");
				return false;
			}
		}

		// Record rate limit for current account if force rotating
		if (forceRotate && state.accounts[state.currentIndex]) {
			recordRateLimit(state.accounts[state.currentIndex].id);
		}

		// Select next account using strategy
		const previousIndex = state.currentIndex;
		state.currentIndex = selectNextAccount(
			state.accounts, 
			state.currentIndex, 
			state.quotaState, 
			config,
			forceRotate
		);
		
		if (state.currentIndex === previousIndex && forceRotate && enabledAccounts.length > 1) {
			// Force move to different account
			for (let i = 1; i <= state.accounts.length; i++) {
				const nextIdx = (previousIndex + i) % state.accounts.length;
				if (state.accounts[nextIdx].enabled) {
					state.currentIndex = nextIdx;
					break;
				}
			}
		}

		state.rotationCount++;
		debug(`Rotating from index ${previousIndex} to ${state.currentIndex}`);

		const newCredentials = state.accounts[state.currentIndex];

		// Check if token needs refresh
		let credentials = newCredentials;
		if (credentials.expires && credentials.expires < Date.now() + 60000) {
			// Token expires in less than 1 minute
			try {
				debug("Token expired, refreshing...");
				if (!config.quiet_mode) {
					ctx.ui.notify("Refreshing expired token...", "info");
				}
				credentials = await refreshOAuthToken(credentials.refresh);
				// Update stored credentials
				state.accounts[state.currentIndex] = {
					...newCredentials,
					...credentials,
				};
				saveCredentials(state.accounts);
				debug("Token refreshed successfully");
			} catch (error) {
				debug("Token refresh failed:", error);
				if (!config.quiet_mode) {
					ctx.ui.notify(`Failed to refresh token: ${error}`, "error");
				}
				// Record failure and try next account (with incremented depth)
				recordRateLimit(newCredentials.id);
				return rotateAccount(ctx, true, depth + 1);
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
			const healthScore = calculateHealthScore(newCredentials, state.quotaState, config);
			
			// Record successful rotation for the new account
			recordSuccess(newCredentials.id);
			
			if (!config.quiet_mode) {
				ctx.ui.notify(
					`Rotated to account ${label} (${state.currentIndex + 1}/${state.accounts.length}) [health: ${healthScore}] - rotation #${state.rotationCount}`,
					"success"
				);
			}
			
			debug(`Successfully rotated to account ${label}, health: ${healthScore}`);
			return true;
		} catch (error) {
			debug("Failed to register provider:", error);
			if (!config.quiet_mode) {
				ctx.ui.notify(`Failed to rotate account: ${error}`, "error");
			}
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
			const currentAccount = state.accounts[state.currentIndex];
			const accountId = currentAccount?.id || "unknown";
			const quota = state.quotaState[accountId] || { requestCount: 0, failureCount: 0 };
			
			debug("Rate limit error detected for account:", accountId);
			
			// Check if we should wait before rotating (to preserve prompt cache)
			if (config.rate_limit_wait_enabled && getEnabledAccounts(state.accounts).length > 1) {
				const waitTime = calculateWaitTime(quota.failureCount, config);
				
				// Only wait if it's the first few failures for this account
				if (quota.failureCount < 3 && waitTime <= config.max_rate_limit_wait_seconds) {
					if (!config.quiet_mode) {
						ctx.ui.notify(
							`Rate limit detected. Waiting ${waitTime}s before rotating (to preserve cache)...`,
							"warning"
						);
					}
					debug(`Waiting ${waitTime}s before rotating...`);
					await sleep(waitTime * 1000);
				}
			}
			
			if (!config.quiet_mode) {
				ctx.ui.notify("Attempting to rotate account...", "info");
			}

			const success = await rotateAccount(ctx, true);

			if (!success && getEnabledAccounts(state.accounts).length > 0) {
				if (!config.quiet_mode) {
					ctx.ui.notify(
						`All ${getEnabledAccounts(state.accounts).length} enabled account(s) may be rate limited. Please wait before retrying.`,
						"error"
					);
				}
			}
		}
	});

	// Register the rotate_account tool for manual rotation
	pi.registerTool({
		name: "rotate_account",
		label: "Rotate Account",
		description: "Manage Google Antigravity account rotation. Actions: rotate (switch account), status (show accounts), enable/disable (toggle account), health (show scores), reset (clear failures)",
		parameters: RotateAccountParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			debug(`Tool called with action: ${params.action}, accountId: ${params.accountId}`);

			// Handle enable/disable actions
			if (params.action === "enable" || params.action === "disable") {
				if (!params.accountId) {
					return {
						content: [{ type: "text", text: `Error: accountId required for ${params.action} action` }],
						details: {
							action: params.action,
							state: { ...state },
							message: "Missing accountId",
							error: "accountId required",
						} as RotationDetails,
						isError: true,
					};
				}

				const accountIdx = state.accounts.findIndex(a => a.id === params.accountId);
				if (accountIdx === -1) {
					return {
						content: [{ type: "text", text: `Error: Account ${params.accountId} not found` }],
						details: {
							action: params.action,
							state: { ...state },
							message: "Account not found",
							error: `Account ${params.accountId} not found`,
						} as RotationDetails,
						isError: true,
					};
				}

				const newEnabled = params.action === "enable";
				state.accounts[accountIdx].enabled = newEnabled;
				saveCredentials(state.accounts);

				const label = state.accounts[accountIdx].label || `Account ${accountIdx + 1}`;
				const message = `${label} ${newEnabled ? "enabled" : "disabled"}`;
				debug(message);

				return {
					content: [{ type: "text", text: message }],
					details: {
						action: params.action,
						state: { ...state },
						message,
					} as RotationDetails,
				};
			}

			// Handle health action
			if (params.action === "health") {
				const healthInfo = state.accounts.map((acc, i) => {
					const label = acc.label || `Account ${i + 1}`;
					const score = calculateHealthScore(acc, state.quotaState, config);
					const enabled = acc.enabled ? "" : " [DISABLED]";
					const current = i === state.currentIndex ? " (current)" : "";
					const quota = state.quotaState[acc.id];
					
					let status = `  ${label}${current}${enabled}: ${score}/100`;
					if (quota) {
						if (quota.rateLimitUntil && Date.now() < quota.rateLimitUntil) {
							const waitSec = Math.ceil((quota.rateLimitUntil - Date.now()) / 1000);
							status += ` [rate limited, ${waitSec}s remaining]`;
						}
						status += ` (requests: ${quota.requestCount}, failures: ${quota.failureCount})`;
					}
					return status;
				});

				const message = state.accounts.length === 0
					? "No accounts configured"
					: `Health scores:\n${healthInfo.join("\n")}\n\nStrategy: ${config.account_selection_strategy}`;

				return {
					content: [{ type: "text", text: message }],
					details: {
						action: "status",
						state: { ...state },
						message,
					} as RotationDetails,
				};
			}

			// Handle reset action
			if (params.action === "reset") {
				state.quotaState = {};
				const message = "All failure counters and rate limit states have been reset";
				debug(message);

				return {
					content: [{ type: "text", text: message }],
					details: {
						action: "status",
						state: { ...state },
						message,
					} as RotationDetails,
				};
			}

			if (params.action === "status") {
				const accounts = state.accounts.map((acc, i) => {
					const label = acc.label || `Account ${i + 1}`;
					const current = i === state.currentIndex ? " (current)" : "";
					const enabled = acc.enabled ? "" : " [DISABLED]";
					const expires = new Date(acc.expires).toLocaleString();
					const health = calculateHealthScore(acc, state.quotaState, config);
					return `  ${label}${current}${enabled} - health: ${health}/100, expires: ${expires}, id: ${acc.id}`;
				});

				const enabledCount = getEnabledAccounts(state.accounts).length;
				const status =
					state.accounts.length === 0
						? "No accounts configured"
						: `${state.accounts.length} account(s) configured (${enabledCount} enabled):\n${accounts.join("\n")}\n\nRotations performed: ${state.rotationCount}\nStrategy: ${config.account_selection_strategy}`;

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
			if (getEnabledAccounts(state.accounts).length === 0) {
				return {
					content: [{ type: "text", text: "No enabled accounts. Use /rotationsetup to add accounts." }],
					details: {
						action: "rotate",
						state: { ...state },
						message: "No accounts",
						error: "No enabled accounts",
					} as RotationDetails,
				};
			}

			const success = await rotateAccount(ctx, true);

			if (success) {
				const acc = state.accounts[state.currentIndex];
				const label = acc.label || `#${state.currentIndex + 1}`;
				const health = calculateHealthScore(acc, state.quotaState, config);
				const message = `Rotated to account ${label} (${state.currentIndex + 1}/${state.accounts.length}) [health: ${health}]`;
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
			if (args.accountId) {
				text += " " + theme.fg("accent", args.accountId);
			}
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
				const enabledCount = getEnabledAccounts(details.state.accounts).length;
				text += "\n" + theme.fg("dim", `Accounts: ${details.state.accounts.length} (${enabledCount} enabled)`);
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

			debug("Starting rotation setup");
			ctx.ui.notify("Starting account rotation setup...", "info");

			// Show current state and options
			if (state.accounts.length > 0) {
				const enabledCount = getEnabledAccounts(state.accounts).length;
				const choice = await ctx.ui.select(
					`${state.accounts.length} account(s) configured (${enabledCount} enabled). What do you want to do?`,
					[
						"Add more accounts",
						"Manage existing accounts (enable/disable)",
						"Configure settings",
						"Clear all and start fresh",
						"Cancel"
					]
				);

				if (!choice || choice === "Cancel") {
					return;
				}

				if (choice.includes("Manage existing")) {
					// Show account list for enable/disable
					const accountChoices = state.accounts.map((acc, i) => {
						const label = acc.label || `Account ${i + 1}`;
						const status = acc.enabled ? "[ENABLED]" : "[DISABLED]";
						const current = i === state.currentIndex ? " (current)" : "";
						return `${label} ${status}${current}`;
					});
					accountChoices.push("Back");

					const selected = await ctx.ui.select("Select account to toggle:", accountChoices);
					if (selected && selected !== "Back") {
						const idx = accountChoices.indexOf(selected);
						if (idx >= 0 && idx < state.accounts.length) {
							state.accounts[idx].enabled = !state.accounts[idx].enabled;
							saveCredentials(state.accounts);
							const newStatus = state.accounts[idx].enabled ? "enabled" : "disabled";
							ctx.ui.notify(`Account ${state.accounts[idx].label || idx + 1} ${newStatus}`, "success");
						}
					}
					return;
				}

				if (choice.includes("Configure settings")) {
					// Show settings menu
					const strategies: SelectionStrategy[] = ["sticky", "round-robin", "hybrid"];
					const currentStrategy = config.account_selection_strategy;
					
					const strategyChoice = await ctx.ui.select(
						`Current strategy: ${currentStrategy}. Select new strategy:`,
						[
							`sticky - Stay on same account until rate limited${currentStrategy === "sticky" ? " (current)" : ""}`,
							`round-robin - Rotate on every request${currentStrategy === "round-robin" ? " (current)" : ""}`,
							`hybrid - Use health scores to select best account${currentStrategy === "hybrid" ? " (current)" : ""}`,
							"Back"
						]
					);

					if (strategyChoice && strategyChoice !== "Back") {
						const newStrategy = strategyChoice.split(" - ")[0] as SelectionStrategy;
						config.account_selection_strategy = newStrategy;
						saveConfig(config);
						ctx.ui.notify(`Strategy changed to: ${newStrategy}`, "success");
						debug("Strategy changed to:", newStrategy);
					}

					// Toggle debug
					const debugChoice = await ctx.ui.confirm(
						"Debug Logging",
						`Debug logging is currently ${config.debug ? "ENABLED" : "DISABLED"}. Toggle?`
					);
					if (debugChoice) {
						config.debug = !config.debug;
						debugEnabled = config.debug;
						saveConfig(config);
						ctx.ui.notify(`Debug logging ${config.debug ? "enabled" : "disabled"}`, "info");
					}

					// Toggle PID offset
					const pidChoice = await ctx.ui.confirm(
						"PID Offset",
						`PID offset is ${config.pid_offset_enabled ? "ENABLED" : "DISABLED"} (for parallel sessions). Toggle?`
					);
					if (pidChoice) {
						config.pid_offset_enabled = !config.pid_offset_enabled;
						saveConfig(config);
						ctx.ui.notify(`PID offset ${config.pid_offset_enabled ? "enabled" : "disabled"}`, "info");
					}

					return;
				}

				if (choice.includes("Clear all")) {
					const confirm = await ctx.ui.confirm(
						"Clear All Accounts",
						`This will delete all ${state.accounts.length} account(s). Are you sure?`
					);
					if (confirm) {
						state.accounts = [];
						state.currentIndex = 0;
						state.rotationCount = 0;
						state.quotaState = {};
						saveCredentials(state.accounts);
						ctx.ui.notify("All accounts cleared.", "success");
					}
					return;
				}

				// If "Add more accounts", continue below
			}

			// Antigravity OAuth is always available (hardcoded credentials)
			const hasOAuthConfig = true;

			// Collect accounts
			let addingAccounts = true;
			let newAccounts: AccountCredentials[] = [...state.accounts];

			while (addingAccounts) {
				// Ask for method
				const methods = ["OAuth 2.0 Flow (Browser) - Recommended", "Manual Token Input"];

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

				if (method.includes("OAuth")) {
					// OAuth flow with PKCE
					try {
						debug("Starting OAuth flow with PKCE");
						ctx.ui.notify("Starting Google Antigravity OAuth flow...", "info");

						// Generate PKCE code verifier and challenge
						const codeVerifier = generateCodeVerifier();
						const codeChallenge = await generateCodeChallenge(codeVerifier);
						const stateParam = generateAccountId();
						const authUrl = generateAuthUrl(stateParam, codeChallenge);

						// Try to open browser
						const open = require("node:child_process");
						try {
							if (process.platform === "win32") {
								open.exec(`start "" "${authUrl}"`);
							} else if (process.platform === "darwin") {
								open.exec(`open "${authUrl}"`);
							} else {
								open.exec(`xdg-open "${authUrl}"`);
							}
							ctx.ui.notify("Browser opened for authentication", "info");
						} catch {
							ctx.ui.notify("Could not open browser automatically", "warning");
						}

						ctx.ui.notify(`Waiting for OAuth callback on http://localhost:${ANTIGRAVITY_OAUTH_CONFIG.port}...`, "info");
						ctx.ui.notify(`If browser didn't open, visit:\n${authUrl}`, "info");

						// Start local server and wait for callback
						const serverPromise = startOAuthServer();

						let credentials: OAuthCredentials;

						try {
							// Wait for server callback
							const { code, state: returnedState } = await serverPromise;

							if (returnedState !== stateParam) {
								throw new Error("State mismatch - possible security issue");
							}

							// Exchange code for tokens
							ctx.ui.notify("Exchanging code for tokens...", "info");
							credentials = await exchangeCodeForTokens(code, codeVerifier);
							debug("OAuth tokens obtained successfully");
						} catch (serverError) {
							// If server failed, offer manual input
							ctx.ui.notify(`Server error: ${serverError}. Try manual input.`, "warning");
							
							const callbackUrl = await ctx.ui.input(
								"Manual Callback",
								"Paste the full callback URL from your browser (starts with http://localhost:51121/oauth-callback?code=...)"
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

							credentials = await exchangeCodeForTokens(code, codeVerifier);
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
							enabled: true,
						};

						newAccounts.push(account);
						ctx.ui.notify(`Account ${newAccounts.length} added successfully via OAuth!`, "success");
						debug("Account added via OAuth:", account.id);
					} catch (error) {
						debug("OAuth failed:", error);
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
						enabled: true,
					};

					newAccounts.push(account);
					ctx.ui.notify(`Account ${newAccounts.length} added successfully!`, "success");
					debug("Account added manually:", account.id);
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
			state.currentIndex = getInitialAccountIndex(newAccounts, config);
			saveCredentials(state.accounts);
			debug("Setup complete, saved", newAccounts.length, "accounts");

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

			// Apply the first enabled account
			const enabledAccounts = getEnabledAccounts(state.accounts);
			if (enabledAccounts.length > 0) {
				try {
					const firstAccount = state.accounts[state.currentIndex];
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
						`Setup complete! ${state.accounts.length} account(s) configured. Currently using ${label}. Strategy: ${config.account_selection_strategy}`,
						"success"
					);
				} catch (error) {
					debug("Failed to activate account:", error);
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
			const enabledCount = getEnabledAccounts(details.state.accounts).length;
			text += "\n" + theme.fg("dim", `  • ${details.state.accounts.length} account(s) (${enabledCount} enabled)`);
			const currentLabel =
				details.state.accounts[details.state.currentIndex]?.label || `Account ${details.state.currentIndex + 1}`;
			text += "\n" + theme.fg("dim", `  • Active: ${currentLabel}`);
		}

		return new Text(text, 0, 0);
	});

	// Register /rotationstatus command for quick status check
	pi.registerCommand("rotationstatus", {
		description: "Show current account rotation status and health",
		handler: async (_args, ctx) => {
			const enabledCount = getEnabledAccounts(state.accounts).length;
			
			if (state.accounts.length === 0) {
				ctx.ui.notify("No accounts configured. Use /rotationsetup to add accounts.", "warning");
				return;
			}

			let statusText = `Account Rotation Status\n`;
			statusText += `${"─".repeat(40)}\n`;
			statusText += `Strategy: ${config.account_selection_strategy}\n`;
			statusText += `Accounts: ${state.accounts.length} (${enabledCount} enabled)\n`;
			statusText += `Rotations: ${state.rotationCount}\n\n`;

			for (let i = 0; i < state.accounts.length; i++) {
				const acc = state.accounts[i];
				const label = acc.label || `Account ${i + 1}`;
				const current = i === state.currentIndex ? " [ACTIVE]" : "";
				const enabled = acc.enabled ? "" : " [DISABLED]";
				const health = calculateHealthScore(acc, state.quotaState, config);
				const quota = state.quotaState[acc.id];

				statusText += `#${i + 1} ${label}${current}${enabled}\n`;
				statusText += `    Health: ${health}/100\n`;
				
				if (quota) {
					statusText += `    Requests: ${quota.requestCount || 0}\n`;
					statusText += `    Failures: ${quota.failureCount || 0}\n`;
					if (quota.rateLimitUntil && Date.now() < quota.rateLimitUntil) {
						const waitSec = Math.ceil((quota.rateLimitUntil - Date.now()) / 1000);
						statusText += `    Rate limited: ${waitSec}s remaining\n`;
					}
				}
				statusText += `\n`;
			}

			ctx.ui.notify(statusText, "info");
		},
	});

	// Register /rotationconfig command
	pi.registerCommand("rotationconfig", {
		description: "Show or edit rotation configuration",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(JSON.stringify(config, null, 2), "info");
				return;
			}

			const configText = `Current Configuration:
─────────────────────────────────
Strategy: ${config.account_selection_strategy}
PID Offset: ${config.pid_offset_enabled}
Max Rate Limit Wait: ${config.max_rate_limit_wait_seconds}s
Rate Limit Wait Enabled: ${config.rate_limit_wait_enabled}
Initial Wait Time: ${config.rate_limit_initial_wait_seconds}s
Soft Quota Threshold: ${config.soft_quota_threshold_percent}%
Failure TTL: ${config.failure_ttl_seconds}s
Debug: ${config.debug}
Quiet Mode: ${config.quiet_mode}
─────────────────────────────────
Config file: ${CONFIG_FILE}`;

			ctx.ui.notify(configText, "info");
		},
	});

	// Initialize on load
	loadAccountsFromFile();
}
