import {
	Component,
	createContext,
	useContext,
	type ErrorInfo,
	type ReactNode,
	type ContextType,
} from "react";

export type AtelierErrorInfo = ErrorInfo & {
	readonly operation?:
		| "extension_load"
		| "extension_observe"
		| "extension_render";
	readonly viewKind?: string;
	readonly fileId?: string;
};

type ErrorReporter = (error: unknown, info: AtelierErrorInfo) => void;
const ErrorReporterContext = createContext<ErrorReporter | undefined>(
	undefined,
);
export function useAtelierErrorReporter() {
	return useContext(ErrorReporterContext);
}

export type AtelierErrorFallbackContext = {
	readonly error: unknown;
};

export type AtelierErrorFallback =
	| ReactNode
	| ((context: AtelierErrorFallbackContext) => ReactNode);

export type AtelierErrorBoundaryProps = {
	readonly children: ReactNode;
	readonly onError?: ErrorReporter;
	readonly errorFallback?: AtelierErrorFallback;
};

type AtelierErrorBoundaryState = {
	readonly error: unknown | null;
};

export class AtelierErrorBoundary extends Component<
	AtelierErrorBoundaryProps,
	AtelierErrorBoundaryState
> {
	static contextType = ErrorReporterContext;
	declare context: ContextType<typeof ErrorReporterContext>;
	state: AtelierErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): AtelierErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
		(this.props.onError ?? this.context)?.(error, errorInfo);
	}

	render(): ReactNode {
		const { error } = this.state;
		if (error !== null) {
			const fallback = this.props.errorFallback;
			return typeof fallback === "function"
				? fallback({ error })
				: (fallback ?? <AtelierRenderError error={error} />);
		}
		return (
			<ErrorReporterContext.Provider value={this.props.onError ?? this.context}>
				{this.props.children}
			</ErrorReporterContext.Provider>
		);
	}
}

function AtelierRenderError({ error }: { readonly error: unknown }) {
	const message =
		error instanceof Error && error.message
			? error.message
			: "An unexpected error occurred while rendering Atelier.";
	return (
		<div className="atw:grid atw:h-full atw:w-full atw:place-content-center atw:bg-bg atw:p-6 atw:text-center atw:text-fg">
			<div className="atw:grid atw:max-w-[640px] atw:gap-2" role="alert">
				<strong>Unable to render Atelier</strong>
				<span className="atw:text-fg-muted">{message}</span>
			</div>
		</div>
	);
}
