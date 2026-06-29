export interface ComboboxOption {
	value: string;
	label: string;
	badge?: string;
	badgeClass?: string;
	suffix?: string;
}

export interface ComboboxOptions {
	options: ComboboxOption[];
	value?: string | null;
	placeholder?: string;
	disabled?: boolean;
	fieldId?: string;
	inputClass?: string;
	wrapClass?: string;
	onSelect: (value: string) => void;
}

function formatOptionLabel(opt: ComboboxOption): string {
	return opt.suffix ? `${opt.label} ${opt.suffix}` : opt.label;
}

export function createCombobox(opts: ComboboxOptions): HTMLElement {
	const { options, onSelect, placeholder = "Search…", disabled = false, fieldId, inputClass, wrapClass } = opts;
	let selectedValue = opts.value ?? null;
	let open = false;
	let highlightIndex = -1;
	let filter = "";

	const root = document.createElement("div") as unknown as ComboboxElement;
	root.className = `combobox${disabled ? " disabled" : ""}`;
	root.setAttribute("role", "combobox");
	root.setAttribute("aria-expanded", "false");
	root.setAttribute("aria-disabled", String(disabled));

	const inputWrap = document.createElement("div");
	inputWrap.className = wrapClass ? `combobox-input-wrap ${wrapClass}` : "combobox-input-wrap";

	const input = document.createElement("input");
	input.type = "text";
	input.className = inputClass ? `combobox-input ${inputClass}` : "combobox-input";
	input.placeholder = placeholder;
	input.autocomplete = "off";
	input.spellcheck = false;
	input.disabled = disabled;
	if (fieldId) input.dataset.agentField = fieldId;

	const chevron = document.createElement("span");
	chevron.className = "combobox-chevron";
	chevron.setAttribute("aria-hidden", "true");
	chevron.textContent = "▾";

	const dropdown = document.createElement("ul");
	dropdown.className = "combobox-dropdown hidden";
	dropdown.setAttribute("role", "listbox");

	inputWrap.append(input, chevron);
	root.append(inputWrap, dropdown);

	function selectedLabel(): string {
		if (!selectedValue) return "";
		const opt = options.find((o) => o.value === selectedValue);
		return opt ? formatOptionLabel(opt) : selectedValue;
	}

	function filteredOptions(): ComboboxOption[] {
		if (!filter) return options;
		const q = filter.toLowerCase();
		return options.filter((o) => {
			const haystack = `${o.label} ${o.suffix ?? ""} ${o.badge ?? ""}`.toLowerCase();
			return haystack.includes(q);
		});
	}

	function syncInputDisplay() {
		if (open) return;
		input.value = selectedLabel();
		filter = "";
	}

	function setOpen(next: boolean) {
		if (disabled) return;
		open = next;
		root.setAttribute("aria-expanded", String(open));
		dropdown.classList.toggle("hidden", !open);
		if (open) {
			filter = "";
			input.value = "";
			highlightIndex = -1;
			renderOptions();
			input.focus();
		} else {
			syncInputDisplay();
		}
	}

	function selectOption(value: string) {
		selectedValue = value;
		setOpen(false);
		onSelect(value);
		syncInputDisplay();
	}

	function renderOptions() {
		dropdown.innerHTML = "";
		const items = filteredOptions();
		if (items.length === 0) {
			const empty = document.createElement("li");
			empty.className = "combobox-empty";
			empty.textContent = "No matches";
			dropdown.appendChild(empty);
			return;
		}
		items.forEach((opt, i) => {
			const li = document.createElement("li");
			li.className = "combobox-option";
			if (opt.value === selectedValue) li.classList.add("selected");
			if (i === highlightIndex) li.classList.add("highlighted");
			li.setAttribute("role", "option");

			const labelSpan = document.createElement("span");
			labelSpan.className = "combobox-option-label";
			labelSpan.textContent = formatOptionLabel(opt);
			li.appendChild(labelSpan);

			if (opt.badge) {
				const badge = document.createElement("span");
				badge.className = `combobox-option-badge${opt.badgeClass ? ` ${opt.badgeClass}` : ""}`;
				badge.textContent = opt.badge;
				li.appendChild(badge);
			}

			li.addEventListener("mousedown", (e) => {
				e.preventDefault();
				selectOption(opt.value);
			});
			dropdown.appendChild(li);
		});
	}

	function moveHighlight(delta: number) {
		const items = filteredOptions();
		if (items.length === 0) return;
		if (highlightIndex < 0) {
			highlightIndex = delta > 0 ? 0 : items.length - 1;
		} else {
			highlightIndex = (highlightIndex + delta + items.length) % items.length;
		}
		renderOptions();
		const highlighted = dropdown.querySelector(".highlighted");
		highlighted?.scrollIntoView({ block: "nearest" });
	}

	input.addEventListener("focus", () => {
		if (!disabled) setOpen(true);
	});

	input.addEventListener("input", () => {
		if (disabled) return;
		filter = input.value;
		highlightIndex = -1;
		if (!open) setOpen(true);
		renderOptions();
	});

	input.addEventListener("keydown", (e) => {
		if (disabled) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (!open) setOpen(true);
			moveHighlight(1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!open) setOpen(true);
			moveHighlight(-1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const items = filteredOptions();
			if (highlightIndex >= 0 && items[highlightIndex]) {
				selectOption(items[highlightIndex].value);
			} else if (items.length === 1) {
				selectOption(items[0].value);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
			input.blur();
		}
	});

	inputWrap.addEventListener("click", () => {
		if (disabled) return;
		setOpen(!open);
	});

	document.addEventListener("mousedown", (e) => {
		if (!root.contains(e.target as Node)) setOpen(false);
	});

	root.setValue = (value: string | null) => {
		selectedValue = value;
		syncInputDisplay();
	};

	root.setDisabled = (next: boolean) => {
		root.classList.toggle("disabled", next);
		root.setAttribute("aria-disabled", String(next));
		input.disabled = next;
		if (next) setOpen(false);
	};

	root.setOptions = (next: ComboboxOption[]) => {
		options.length = 0;
		options.push(...next);
		if (selectedValue && !options.some((o) => o.value === selectedValue)) {
			selectedValue = null;
		}
		syncInputDisplay();
		if (open) renderOptions();
	};

	syncInputDisplay();
	return root;
}

export type ComboboxElement = HTMLElement & {
	setValue: (value: string | null) => void;
	setDisabled: (next: boolean) => void;
	setOptions: (next: ComboboxOption[]) => void;
};
