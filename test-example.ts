/**
 * Example Test Script for Account Rotation Extension
 * 
 * This script demonstrates how to use the account rotation extension programmatically.
 * You can adapt this for automated testing or integration into your workflows.
 */

// Example: Simulating the extension's credential parsing
function parseCredentials(input: string) {
	try {
		const parsed = JSON.parse(input);
		
		if (parsed.refresh && parsed.access) {
			return {
				refresh: parsed.refresh,
				access: parsed.access,
				expires: parsed.expires || Date.now() + 3600000,
			};
		}

		if (typeof parsed === "string") {
			return {
				refresh: parsed,
				access: parsed,
				expires: Date.now() + 3600000,
			};
		}

		return null;
	} catch {
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

// Example: Test various credential formats
console.log("Testing credential parsing...\n");

// Test 1: Full OAuth object
const fullOAuth = JSON.stringify({
	refresh: "1//0gXXXXXXXXXXXX",
	access: "ya29.a0XXXXXX",
	expires: 1707436800000,
});
console.log("Test 1 - Full OAuth JSON:");
console.log("Input:", fullOAuth);
console.log("Parsed:", parseCredentials(fullOAuth));
console.log();

// Test 2: Access token only
const accessToken = "ya29.a0AfB_byXXXXXXXXXXXX";
console.log("Test 2 - Access Token Only:");
console.log("Input:", accessToken);
console.log("Parsed:", parseCredentials(accessToken));
console.log();

// Test 3: JSON string token
const jsonStringToken = JSON.stringify("ya29.a0AfB_byYYYYYYYY");
console.log("Test 3 - JSON String Token:");
console.log("Input:", jsonStringToken);
console.log("Parsed:", parseCredentials(jsonStringToken));
console.log();

// Test 4: Invalid input
const invalid = "not a valid credential";
console.log("Test 4 - Invalid Input:");
console.log("Input:", invalid);
console.log("Parsed:", parseCredentials(invalid));
console.log();

// Example: Rate limit detection
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

console.log("\nTesting rate limit detection...\n");

// Test various error formats
const errors = [
	"HTTP 429 Too Many Requests",
	"Rate limit exceeded for this API",
	"Quota exceeded for this project",
	{ status: 429, message: "Too many requests" },
	"Resource exhausted (quota)",
	"404 not found - quota exceeded",
	"Internal server error",
];

errors.forEach((error, i) => {
	const isRateLimit = isRateLimitError(error);
	console.log(`Test ${i + 1}:`, isRateLimit ? "✓ Detected" : "✗ Not detected");
	console.log("  Error:", typeof error === "string" ? error : JSON.stringify(error));
});

console.log("\n--- Test Complete ---\n");

// Example usage scenarios
console.log("Example Usage Scenarios:\n");

console.log("1. Initial Setup:");
console.log("   $ pi -e ./account-rotation.ts");
console.log("   > /rotationsetup");
console.log("   [Follow prompts to add accounts]\n");

console.log("2. Check Status:");
console.log('   Ask pi: "Use the rotate_account tool to check status"');
console.log("   Pi will call: rotate_account({ action: 'status' })\n");

console.log("3. Manual Rotation:");
console.log('   Ask pi: "Rotate to the next account"');
console.log("   Pi will call: rotate_account({ action: 'rotate' })\n");

console.log("4. Automatic Rotation (on rate limit):");
console.log("   [Pi makes API call]");
console.log("   [Rate limit error occurs]");
console.log("   [Extension detects error]");
console.log("   [Extension rotates automatically]");
console.log("   [Pi retries with new account]\n");
