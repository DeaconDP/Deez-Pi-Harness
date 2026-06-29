import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "online.deac.piui",
	appName: "Deez Pi Ui",
	webDir: "client/dist",
	server: {
		androidScheme: "https",
	},
	ios: {
		contentInset: "automatic",
	},
};

export default config;
