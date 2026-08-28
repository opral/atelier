import { Check } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Owns Atelier's global save shortcut. Files are persisted as they change, so
 * Cmd/Ctrl+S only suppresses the browser save dialog and explains autosave.
 */
export function AtelierAutosaveHint() {
	const [hintKey, setHintKey] = useState(0);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "s") return;

			event.preventDefault();
			event.stopPropagation();
			setHintKey((current) => current + 1);
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	useEffect(() => {
		if (hintKey === 0) return;
		const timeoutId = window.setTimeout(() => setHintKey(0), 2400);
		return () => window.clearTimeout(timeoutId);
	}, [hintKey]);

	if (hintKey === 0) return null;

	return (
		<div
			key={hintKey}
			className="atelier-autosave-hint"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<span className="atelier-autosave-hint-icon" aria-hidden="true">
				<Check aria-hidden />
			</span>
			<span>
				<strong>Auto-saved.</strong> No Cmd+S needed.
			</span>
		</div>
	);
}
