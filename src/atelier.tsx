import {
	useCallback,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	type Ref,
} from "react";
import { Atelier as Workspace, AtelierSkeleton } from "./create-atelier";
import type { AtelierProps as WorkspaceProps } from "./create-atelier";
import {
	createAtelier,
	type AtelierOptions,
	type AtelierInstance,
} from "./atelier-instance";
import { FileView } from "./file-view";
import { History } from "./history";

/** Commands owned by a mounted workspace. The host owns the Lix lifecycle. */
export type AtelierShellHandle = Pick<AtelierInstance, "documents" | "views">;
export type AtelierShellProps = AtelierOptions &
	Omit<WorkspaceProps, "instance"> & {
		readonly ref?: Ref<AtelierShellHandle>;
	};

function Shell({
	ref,
	slots,
	topBarProps,
	onError,
	errorFallback,
	lix,
	debug,
	readOnly,
	extensions,
	defaultOpenPanels,
	onEvent,
	sessionStateStore,
	preferencesStore,
	branchSession,
	reviewStatusStore,
	filesView,
	centralPanel,
}: AtelierShellProps) {
	const onEventRef = useRef(onEvent);
	useLayoutEffect(() => {
		onEventRef.current = onEvent;
	}, [onEvent]);
	const emit = useCallback<NonNullable<AtelierOptions["onEvent"]>>(
		(event) => onEventRef.current?.(event),
		[],
	);
	const instance = useMemo(
		() =>
			createAtelier({
				lix,
				debug,
				readOnly,
				extensions,
				defaultOpenPanels,
				onEvent: emit,
				sessionStateStore,
				preferencesStore,
				branchSession,
				reviewStatusStore,
				filesView,
				centralPanel,
			}),
		[
			lix,
			debug,
			readOnly,
			extensions,
			defaultOpenPanels,
			emit,
			sessionStateStore,
			preferencesStore,
			branchSession,
			reviewStatusStore,
			filesView,
			centralPanel,
		],
	);
	useImperativeHandle(
		ref,
		() => ({ documents: instance.documents, views: instance.views }),
		[instance],
	);
	return (
		<Workspace
			instance={instance}
			slots={slots}
			topBarProps={topBarProps}
			onError={onError}
			errorFallback={errorFallback}
		/>
	);
}

export const Atelier = {
	Shell,
	FileView,
	History,
	ShellSkeleton: AtelierSkeleton,
};
