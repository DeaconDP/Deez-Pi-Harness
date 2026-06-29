import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	root: "client",
	publicDir: "public",
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		proxy: {
			"/ws": {
				target: "ws://127.0.0.1:3141",
				ws: true,
			},
		},
	},
	plugins: [
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["icon.svg", "icon-180.png", "icon-192.png", "icon-512.png"],
			manifest: {
				name: "Deez Pi Ui",
				short_name: "Deez Pi Ui",
				description: "Three-panel hub for the Pi coding agent",
				theme_color: "#000000",
				background_color: "#000000",
				display: "standalone",
				start_url: "/",
				icons: [
					{
						src: "icon.svg",
						sizes: "any",
						type: "image/svg+xml",
						purpose: "any maskable",
					},
					{
						src: "icon-180.png",
						sizes: "180x180",
						type: "image/png",
					},
					{
						src: "icon-192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "icon-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
				navigateFallback: "index.html",
				runtimeCaching: [],
			},
		}),
	],
});
