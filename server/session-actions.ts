import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

/** Delete a session file, trying `trash` first then falling back to unlink. */
export async function deleteSessionFile(
	sessionPath: string,
): Promise<{ ok: boolean; error?: string }> {
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

	if (trashResult.status === 0 || !existsSync(sessionPath)) {
		return { ok: true };
	}

	try {
		await unlink(sessionPath);
		return { ok: true };
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const stderr = trashResult.stderr?.trim();
		const trashHint = stderr ? `trash: ${stderr.split("\n")[0]}` : null;
		const error = trashHint ? `${unlinkError} (${trashHint})` : unlinkError;
		return { ok: false, error };
	}
}
