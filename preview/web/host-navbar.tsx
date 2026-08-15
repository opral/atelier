/**
 * Host-owned top bar content for the preview app.
 *
 * Atelier ships no brand mark and no repository picker — it only reserves the
 * `navbarBrand` and `navbarRepository` slots. This file is what a real host
 * writes to fill them, and doubles as the working reference for that contract.
 */
import { useState } from "react";

/** Mark rendered at the far left of the top bar, before the panel toggle. */
export function HostBrandMark() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			role="img"
			aria-label="Atelier preview"
		>
			<rect width="24" height="24" rx="6" fill="#EA580C" />
			<path
				d="M7.5 16.5 12 7l4.5 9.5"
				stroke="#FFF7ED"
				strokeWidth="2.1"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>
			<path
				d="M9.5 13.5h5"
				stroke="#FFF7ED"
				strokeWidth="2.1"
				strokeLinecap="round"
			/>
		</svg>
	);
}

const REPOSITORIES = ["peter-parker", "daily-bugle"] as const;

const initialsOf = (name: string): string =>
	name
		.split(/[-_\s]+/)
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase())
		.join("");

/**
 * Repository picker rendered after the panel toggle. The chip is the host's
 * "where you are"; Atelier's tab strip after the divider is "what's open".
 */
export function HostRepositoryPicker() {
	const [repository, setRepository] = useState<string>(REPOSITORIES[0]);
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div className="host-repo">
			<button
				type="button"
				className="host-repo__chip"
				aria-haspopup="menu"
				aria-expanded={isOpen}
				onClick={() => setIsOpen((open) => !open)}
			>
				<span className="host-repo__avatar">{initialsOf(repository)}</span>
				<span className="host-repo__name">{repository}</span>
				<svg
					width="10"
					height="10"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>
			{isOpen ? (
				<div className="host-repo__menu" role="menu">
					{REPOSITORIES.map((candidate) => (
						<button
							key={candidate}
							type="button"
							role="menuitemradio"
							aria-checked={candidate === repository}
							className="host-repo__item"
							onClick={() => {
								setRepository(candidate);
								setIsOpen(false);
							}}
						>
							<span className="host-repo__avatar">{initialsOf(candidate)}</span>
							{candidate}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
