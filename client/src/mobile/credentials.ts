import { Capacitor } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

const KEY_PREFIX = "pi_pwa_api_key_";

function storageKey(provider: string): string {
	return `${KEY_PREFIX}${provider}`;
}

export async function getApiKey(provider: string): Promise<string | null> {
	const key = storageKey(provider);
	try {
		if (Capacitor.isNativePlatform()) {
			const { value } = await SecureStoragePlugin.get({ key });
			return value || null;
		}
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
	const key = storageKey(provider);
	if (Capacitor.isNativePlatform()) {
		await SecureStoragePlugin.set({ key, value: apiKey });
		return;
	}
	localStorage.setItem(key, apiKey);
}

export async function removeApiKey(provider: string): Promise<void> {
	const key = storageKey(provider);
	try {
		if (Capacitor.isNativePlatform()) {
			await SecureStoragePlugin.remove({ key });
			return;
		}
		localStorage.removeItem(key);
	} catch {
		/* key may not exist */
	}
}

export async function hasApiKey(provider: string): Promise<boolean> {
	const value = await getApiKey(provider);
	return Boolean(value?.trim());
}
