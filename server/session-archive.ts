import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigDir } from "./config.js";

const ARCHIVE_PATH = () => path.join(getConfigDir(), "archived-sessions.json");

export class SessionArchiveStore {
	private paths = new Set<string>();

	constructor() {
		this.load();
	}

	load(): Set<string> {
		try {
			const p = ARCHIVE_PATH();
			if (fs.existsSync(p)) {
				const data = JSON.parse(fs.readFileSync(p, "utf8")) as { paths?: string[] };
				this.paths = new Set(data.paths ?? []);
				return this.paths;
			}
		} catch {
			/* empty */
		}
		this.paths = new Set();
		return this.paths;
	}

	isArchived(sessionPath: string): boolean {
		return this.paths.has(sessionPath);
	}

	archive(sessionPath: string): void {
		this.paths.add(sessionPath);
		this.save();
	}

	unarchive(sessionPath: string): void {
		this.paths.delete(sessionPath);
		this.save();
	}

	remove(sessionPath: string): void {
		this.paths.delete(sessionPath);
		this.save();
	}

	private save(): void {
		fs.mkdirSync(getConfigDir(), { recursive: true });
		const tmp = `${ARCHIVE_PATH()}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify({ paths: [...this.paths] }, null, 2));
		fs.renameSync(tmp, ARCHIVE_PATH());
	}
}
