import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { evictAllLixQueryCaches } from "@/lib/lix-react";
import { isRecoverableLixSessionError } from "@/lib/lix-session-error";

export type AtelierErrorFallbackContext = {
	readonly error: unknown;
};

export type AtelierErrorFallback =
	| ReactNode
	| ((context: AtelierErrorFallbackContext) => ReactNode);

export type AtelierErrorBoundaryProps = {
	readonly children: ReactNode;
	readonly onError?: (error: unknown, errorInfo: ErrorInfo) => void;
	/**
	 * Host hook for a gone / expired / closed Lix protocol session. LixRay
	 * should close the current client and call `openRepositoryLixSession`
	 * (`web-app/src/lib/repository-lix-session.ts`), then remount `<Atelier>`
	 * with the new `lix`. The JS SDK handshake lives on
	 * `RemoteLixBinding.open()` in `@lix-js/sdk`.
	 */
	readonly onSessionExpired?: (error: unknown) => void;
	readonly errorFallback?: AtelierErrorFallback;
};

type AtelierErrorBoundaryState = {
	readonly error: unknown | null;
	readonly remountKey: number;
	readonly autoRecoveries: number;
};

const MAX_AUTO_SESSION_RECOVERIES = 1;

export class AtelierErrorBoundary extends Component<
	AtelierErrorBoundaryProps,
	AtelierErrorBoundaryState
> {
	state: AtelierErrorBoundaryState = {
		error: null,
		remountKey: 0,
		autoRecoveries: 0,
	};

	static getDerivedStateFromError(error: unknown): { error: unknown } {
		return { error };
	}

	componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
		this.props.onError?.(error, errorInfo);
		if (!isRecoverableLixSessionError(error)) return;
		this.props.onSessionExpired?.(error);
		evictAllLixQueryCaches();
		if (this.state.autoRecoveries >= MAX_AUTO_SESSION_RECOVERIES) return;
		queueMicrotask(() => {
			this.setState((state) => ({
				error: null,
				remountKey: state.remountKey + 1,
				autoRecoveries: state.autoRecoveries + 1,
			}));
		});
	}

	#retrySessionRecovery = (): void => {
		const { error } = this.state;
		if (error !== null) {
			this.props.onSessionExpired?.(error);
		}
		evictAllLixQueryCaches();
		this.setState((state) => ({
			error: null,
			remountKey: state.remountKey + 1,
			autoRecoveries: 0,
		}));
	};

	render(): ReactNode {
		const { error, remountKey } = this.state;
		if (error !== null) {
			if (isRecoverableLixSessionError(error)) {
				if (this.state.autoRecoveries < MAX_AUTO_SESSION_RECOVERIES) {
					return <AtelierSessionRecoveryPending />;
				}
				return (
					<AtelierSessionRecoveryPrompt onRetry={this.#retrySessionRecovery} />
				);
			}
			const fallback = this.props.errorFallback;
			return typeof fallback === "function"
				? fallback({ error })
				: (fallback ?? <AtelierRenderError error={error} />);
		}
		return <Fragment key={remountKey}>{this.props.children}</Fragment>;
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

function AtelierSessionRecoveryPending() {
	return (
		<div className="grid h-full w-full place-content-center bg-[var(--color-bg-app)] p-6 text-center text-[var(--color-text-secondary)]">
			<div role="status">Reconnecting to Lix…</div>
		</div>
	);
}

function AtelierSessionRecoveryPrompt({
	onRetry,
}: {
	readonly onRetry: () => void;
}) {
	return (
		<div className="grid h-full w-full place-content-center bg-[var(--color-bg-app)] p-6 text-center text-[var(--color-text-primary)]">
			<div
				className="grid max-w-[640px] justify-items-center gap-3"
				role="alert"
			>
				<strong>Lix session expired</strong>
				<span className="text-[var(--color-text-secondary)]">
					The Lix protocol session is unknown, expired, or closed. Opening a new
					client session…
				</span>
				<button
					type="button"
					onClick={onRetry}
					className="inline-flex h-8 items-center rounded-[7px] bg-[var(--color-bg-control)] px-3 text-[13px] font-semibold hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
