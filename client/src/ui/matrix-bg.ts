const GLYPHS =
	"アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
	"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=#";

export function initMatrixBg(container: HTMLElement, canvas: HTMLCanvasElement): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	const context = canvas.getContext("2d");
	if (!context) return;

	let width = 0;
	let height = 0;
	let columns = 0;
	let drops: number[] = [];
	let rafId = 0;
	let running = true;

	const fontSize = 14;
	const opacity = 0.12;

	function resize(): void {
		const rect = container.getBoundingClientRect();
		width = Math.floor(rect.width);
		height = Math.floor(rect.height);
		canvas.width = width;
		canvas.height = height;
		columns = Math.floor(width / fontSize);
		drops = Array.from({ length: columns }, () => Math.random() * -50);
	}

	function draw(): void {
		if (!running) return;

		context.fillStyle = `rgba(0, 0, 0, ${1 - opacity * 0.3})`;
		context.fillRect(0, 0, width, height);

		context.font = `${fontSize}px monospace`;
		context.fillStyle = `rgba(0, 255, 65, ${opacity})`;

		for (let i = 0; i < columns; i++) {
			const char = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
			const x = i * fontSize;
			const y = drops[i] * fontSize;

			context.fillText(char, x, y);

			if (y > height && Math.random() > 0.975) {
				drops[i] = 0;
			}
			drops[i]++;
		}

		rafId = requestAnimationFrame(draw);
	}

	const observer = new ResizeObserver(resize);
	observer.observe(container);
	resize();

	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			running = false;
			cancelAnimationFrame(rafId);
		} else {
			running = true;
			draw();
		}
	});

	draw();
}
