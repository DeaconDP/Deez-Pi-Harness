import type { StackNodeSummary } from "../../../shared/protocol.js";

export function renderNodes(container: HTMLElement, nodes: StackNodeSummary[]): void {
	container.innerHTML = "";

	if (!nodes.length) {
		const empty = document.createElement("div");
		empty.className = "panel-empty";
		empty.textContent = "No nodes found. Install Tailscale or configure API credentials.";
		container.appendChild(empty);
		return;
	}

	for (const node of nodes) {
		const card = document.createElement("div");
		card.className = `node-card${node.isLocal ? " local" : ""}`;

		const name = document.createElement("div");
		name.className = "node-name";
		name.textContent = node.name;
		name.title = `${node.hostname} (${node.tailscaleIp})`;

		card.append(
			name,
			statusRow("Pi", node.piActive ? "active" : "inactive", node.piActive ? "Active" : "Inactive"),
			statusRow(
				"Provider",
				node.providerConnected ? "connected" : "disconnected",
				node.providerConnected ? "Connected" : "Disconnected",
			),
			statusRow("LLM", "connected", node.llmModel),
		);

		container.appendChild(card);
	}
}

function statusRow(label: string, dotClass: string, value: string): HTMLElement {
	const row = document.createElement("div");
	row.className = "node-status-row";
	const dot = document.createElement("span");
	dot.className = `node-status-dot ${dotClass}`;
	const text = document.createElement("span");
	text.textContent = `${label}: ${value}`;
	row.append(dot, text);
	return row;
}
