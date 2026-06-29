import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadHubConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface TailscaleDevice {
	id: string;
	name: string;
	hostname: string;
	addresses: string[];
	tags?: string[];
	online?: boolean;
}

const CACHE_MS = 45_000;
let cache: { at: number; devices: TailscaleDevice[] } | null = null;
let cliWarned = false;

export async function fetchTailscaleDevices(): Promise<TailscaleDevice[]> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.devices;

	const apiKey = process.env.TAILSCALE_API_KEY;
	const tailnet = process.env.TAILSCALE_TAILNET;
	let devices: TailscaleDevice[] = [];

	if (apiKey && tailnet) {
		devices = await fetchFromApi(apiKey, tailnet);
	}

	if (!devices.length) {
		devices = await fetchFromCli();
	}

	const filtered = applyTagFilter(devices);
	cache = { at: Date.now(), devices: filtered };
	return filtered;
}

function applyTagFilter(devices: TailscaleDevice[]): TailscaleDevice[] {
	const tagFilter = loadHubConfig().tailscaleTag;
	if (!tagFilter) return devices;
	return devices.filter((d) => d.tags?.includes(tagFilter));
}

async function fetchFromApi(apiKey: string, tailnet: string): Promise<TailscaleDevice[]> {
	const url = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`;
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) {
			console.warn(`[tailscale] API ${res.status}: ${await res.text()}`);
			return cache?.devices ?? [];
		}

		const body = (await res.json()) as { devices?: Array<Record<string, unknown>> };
		return (body.devices ?? []).map((d) => ({
			id: String(d.id ?? d.nodeId ?? ""),
			name: String(d.name ?? d.hostname ?? "unknown"),
			hostname: String(d.hostname ?? d.name ?? "unknown"),
			addresses: (d.addresses as string[]) ?? [],
			tags: d.tags as string[] | undefined,
			online: d.online as boolean | undefined,
		}));
	} catch (err) {
		console.warn("[tailscale] API request failed:", err);
		return [];
	}
}

async function fetchFromCli(): Promise<TailscaleDevice[]> {
	try {
		const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
			timeout: 5000,
			maxBuffer: 4 * 1024 * 1024,
		});
		const body = JSON.parse(stdout) as {
			Peer?: Record<
				string,
				{
					HostName?: string;
					DNSName?: string;
					TailscaleIPs?: string[];
					Tags?: string[];
					Online?: boolean;
				}
			>;
		};

		const peers = body.Peer ?? {};
		return Object.entries(peers).map(([key, peer]) => {
			const dnsName = peer.DNSName?.replace(/\.$/, "");
			return {
				id: key,
				name: dnsName || peer.HostName || "unknown",
				hostname: peer.HostName ?? "unknown",
				addresses: (peer.TailscaleIPs ?? []).map(String),
				tags: peer.Tags,
				online: peer.Online,
			};
		});
	} catch (err) {
		if (!cliWarned) {
			cliWarned = true;
			console.warn(
				"[tailscale] CLI discovery unavailable (install Tailscale or set TAILSCALE_API_KEY):",
				err instanceof Error ? err.message : err,
			);
		}
		return [];
	}
}

export function pickTailscaleIp(device: TailscaleDevice): string {
	const v4 = device.addresses.find((a) => a.includes(".") && !a.includes(":"));
	return v4?.split("/")[0] ?? device.addresses[0]?.split("/")[0] ?? "";
}
