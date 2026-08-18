import { Component, type ErrorInfo, type ReactNode } from "react";

export type AtelierErrorFallbackContext = {
	readonly error: unknown;
};

export type AtelierErrorFallback =
	| ReactNode
	| ((context: AtelierErrorFallbackContext) => ReactNode);

export type AtelierErrorBoundaryProps = {
	readonly children: ReactNode;
	readonly onError?: (error: unknown, errorInfo: ErrorInfo) => void;
	readonly errorFallback?: AtelierErrorFallback;
};

type AtelierErrorBoundaryState = {
	readonly error: unknown | null;
};

export class AtelierErrorBoundary extends Component<
	AtelierErrorBoundaryProps,
	AtelierErrorBoundaryState
> {
	state: AtelierErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): AtelierErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
		this.props.onError?.(error, errorInfo);
	}

	render(): ReactNode {
		const { error } = this.state;
		if (error !== null) {
			const fallback = this.props.errorFallback;
			return typeof fallback === "function"
				? fallback({ error })
				: (fallback ?? <AtelierRenderError error={error} />);
		}
		return this.props.children;
	}
}

function AtelierRenderError({ error }: { readonly error: unknown }) {
	const message =
		error instanceof Error && error.message
			? error.message
			: "An unexpected error occurred while rendering Atelier.";
	return (
		<div className="grid h-full w-full place-content-center bg-[var(--color-bg-app)] p-6 text-center text-[var(--color-text-primary)]">
			<div className="grid max-w-[640px] gap-2" role="alert">
				<strong>Unable to render Atelier</strong>
				<span className="text-[var(--color-text-secondary)]">{message}</span>
			</div>
		</div>
	);
}
