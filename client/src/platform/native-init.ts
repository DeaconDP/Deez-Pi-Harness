import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { StatusBar, Style } from "@capacitor/status-bar";

export async function initNativeShell(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;

	document.body.classList.add("platform-native");

	const mobileNotice = document.getElementById("mobile-notice");
	mobileNotice?.classList.remove("hidden");

	try {
		await StatusBar.setStyle({ style: Style.Dark });
		await StatusBar.setBackgroundColor({ color: "#000000" });
	} catch {
		/* status bar unavailable in some contexts */
	}

	const inputBar = document.getElementById("input-bar");
	if (!inputBar) return;

	try {
		Keyboard.addListener("keyboardWillShow", (info) => {
			inputBar.style.paddingBottom = `${info.keyboardHeight}px`;
		});
		Keyboard.addListener("keyboardWillHide", () => {
			inputBar.style.paddingBottom = "";
		});
	} catch {
		/* keyboard plugin unavailable */
	}
}
