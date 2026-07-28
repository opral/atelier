import { fileExtensionFromPath } from "@/extension-runtime/file-handlers";
import "./style.css";

/** Extensions the bundled video extension claims, shared with icons and embeds. */
export const VIDEO_FILE_EXTENSIONS = ["mp4", "mov", "webm"] as const;

/** Resolve the browser MIME type for a video path handled by this extension. */
export function videoMimeTypeFromPath(filePath: string): string | undefined {
	switch (fileExtensionFromPath(filePath)) {
		case "mp4":
			return "video/mp4";
		case "mov":
			return "video/quicktime";
		case "webm":
			return "video/webm";
		default:
			return undefined;
	}
}

/** Format seconds as `m:ss` (or `h:mm:ss` past an hour) for player chrome. */
export function formatVideoTimecode(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const wholeSeconds = Math.floor(seconds);
	const hours = Math.floor(wholeSeconds / 3600);
	const minutes = Math.floor((wholeSeconds % 3600) / 60);
	const remainder = wholeSeconds % 60;
	const paddedSeconds = String(remainder).padStart(2, "0");
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
	}
	return `${minutes}:${paddedSeconds}`;
}

/** Format a byte count the way the player's specs chip displays it. */
export function formatVideoFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	const kilobytes = bytes / 1024;
	if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
	const megabytes = kilobytes / 1024;
	if (megabytes < 1024) return `${formatCompactNumber(megabytes)} MB`;
	return `${formatCompactNumber(megabytes / 1024)} GB`;
}

function formatCompactNumber(value: number): string {
	return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 5;
const CONTROLS_IDLE_HIDE_MS = 2500;

export type VideoPlayerVariant = "standalone" | "embed";

export type VideoPlayerOptions = {
	readonly variant: VideoPlayerVariant;
	/** Label for the floating file chip (standalone only). */
	readonly fileName?: string;
	/** Byte size shown in the specs chip (standalone only). */
	readonly fileSizeBytes?: number;
	/** Fires once per source when duration and dimensions become known. */
	readonly onMetadata?: (metadata: {
		readonly duration: number;
		readonly width: number;
		readonly height: number;
	}) => void;
	/** Fires when the browser cannot decode or load the current source. */
	readonly onError?: () => void;
	readonly document?: Document;
};

export type VideoPlayerController = {
	readonly element: HTMLElement;
	readonly video: HTMLVideoElement;
	setSource(src: string | null): void;
	destroy(): void;
};

type IconSpec = {
	readonly viewBox?: string;
	readonly fill?: string;
	readonly stroke?: string;
	readonly strokeWidth?: string;
	readonly paths: readonly string[];
	readonly circles?: readonly { cx: string; cy: string; r: string }[];
	readonly rects?: readonly Record<string, string>[];
};

const ICONS = {
	play: { fill: "currentColor", paths: ["M6 4l14 8-14 8z"] },
	pause: {
		fill: "currentColor",
		paths: [],
		rects: [
			{ x: "5", y: "4", width: "5", height: "16", rx: "1" },
			{ x: "14", y: "4", width: "5", height: "16", rx: "1" },
		],
	},
	volume: {
		stroke: "currentColor",
		strokeWidth: "2",
		paths: ["M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7"],
	},
	muted: {
		stroke: "currentColor",
		strokeWidth: "2",
		paths: ["M11 5 6 9H2v6h4l5 4z", "m22 9-6 6", "m16 9 6 6"],
	},
	fullscreen: {
		stroke: "currentColor",
		strokeWidth: "2",
		paths: [
			"M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3",
		],
	},
	film: {
		stroke: "currentColor",
		strokeWidth: "2",
		paths: ["M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"],
		rects: [{ x: "2", y: "4", width: "20", height: "16", rx: "2" }],
	},
	eye: {
		stroke: "currentColor",
		strokeWidth: "2.2",
		paths: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"],
		circles: [{ cx: "12", cy: "12", r: "3" }],
	},
} satisfies Record<string, IconSpec>;

function createIcon(doc: Document, spec: IconSpec): SVGSVGElement {
	const svgNamespace = "http://www.w3.org/2000/svg";
	const svg = doc.createElementNS(svgNamespace, "svg");
	svg.setAttribute("viewBox", spec.viewBox ?? "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("fill", spec.fill ?? "none");
	if (spec.stroke) {
		svg.setAttribute("stroke", spec.stroke);
		svg.setAttribute("stroke-width", spec.strokeWidth ?? "2");
		svg.setAttribute("stroke-linecap", "round");
		svg.setAttribute("stroke-linejoin", "round");
	}
	for (const pathData of spec.paths) {
		const path = doc.createElementNS(svgNamespace, "path");
		path.setAttribute("d", pathData);
		svg.append(path);
	}
	for (const circle of spec.circles ?? []) {
		const element = doc.createElementNS(svgNamespace, "circle");
		element.setAttribute("cx", circle.cx);
		element.setAttribute("cy", circle.cy);
		element.setAttribute("r", circle.r);
		svg.append(element);
	}
	for (const rect of spec.rects ?? []) {
		const element = doc.createElementNS(svgNamespace, "rect");
		for (const [attribute, value] of Object.entries(rect)) {
			element.setAttribute(attribute, value);
		}
		svg.append(element);
	}
	return svg;
}

/**
 * Framework-free video player used by both the standalone video tab and the
 * Markdown embed node view. `variant: "standalone"` renders the full glass
 * chrome (file chip, specs chip, scrubber knob, rate, mute, keyboard
 * shortcuts); `variant: "embed"` renders the compact pill from the design.
 *
 * Video chrome is intentionally dark in both themes — the stage is a dark
 * surface exactly like a paused frame, so controls do not follow theme tokens.
 */
export function createVideoPlayer(
	options: VideoPlayerOptions,
): VideoPlayerController {
	const doc = options.document ?? document;
	const isStandalone = options.variant === "standalone";

	// The whole player is built from <span> elements (styled as blocks) so the
	// same DOM stays valid when the Markdown editor mounts it inline in prose.
	const root = doc.createElement("span");
	root.className = "atelier-video-player";
	root.dataset.variant = options.variant;
	root.dataset.playing = "false";

	const video = doc.createElement("video");
	video.className = "atelier-video-surface";
	video.playsInline = true;
	video.preload = "metadata";
	root.append(video);

	let fileChip: HTMLElement | null = null;
	let specsChip: HTMLElement | null = null;
	if (isStandalone) {
		fileChip = doc.createElement("span");
		fileChip.className = "atelier-video-chip atelier-video-chip--file";
		const filmIcon = createIcon(doc, ICONS.film);
		filmIcon.classList.add("atelier-video-chip-icon");
		const fileLabel = doc.createElement("span");
		fileLabel.className = "atelier-video-chip-label";
		fileLabel.textContent = options.fileName ?? "";
		const divider = doc.createElement("span");
		divider.className = "atelier-video-chip-divider";
		const readOnly = doc.createElement("span");
		readOnly.className = "atelier-video-chip-muted";
		readOnly.append(
			createIcon(doc, ICONS.eye),
			doc.createTextNode(" read-only"),
		);
		fileChip.append(filmIcon, fileLabel, divider, readOnly);

		specsChip = doc.createElement("span");
		specsChip.className = "atelier-video-chip atelier-video-chip--specs";
		specsChip.hidden = true;
		root.append(fileChip, specsChip);
	}

	const puck = doc.createElement("button");
	puck.type = "button";
	puck.className = "atelier-video-puck";
	puck.setAttribute("aria-label", "Play");
	puck.append(createIcon(doc, ICONS.play));
	root.append(puck);

	const pill = doc.createElement("span");
	pill.className = "atelier-video-pill";

	const toggle = doc.createElement("button");
	toggle.type = "button";
	toggle.className = "atelier-video-toggle";
	toggle.setAttribute("aria-label", "Play");
	const togglePlayIcon = createIcon(doc, ICONS.play);
	togglePlayIcon.classList.add("atelier-video-icon-play");
	const togglePauseIcon = createIcon(doc, ICONS.pause);
	togglePauseIcon.classList.add("atelier-video-icon-pause");
	toggle.append(togglePlayIcon, togglePauseIcon);

	const timecode = doc.createElement("span");
	timecode.className = "atelier-video-timecode";
	timecode.textContent = "0:00 / 0:00";

	const track = doc.createElement("span");
	track.className = "atelier-video-track";
	track.setAttribute("role", "slider");
	track.setAttribute("aria-label", "Seek");
	track.setAttribute("aria-valuemin", "0");
	track.setAttribute("aria-valuemax", "0");
	track.setAttribute("aria-valuenow", "0");
	const trackFill = doc.createElement("span");
	trackFill.className = "atelier-video-track-fill";
	track.append(trackFill);
	let trackKnob: HTMLElement | null = null;
	if (isStandalone) {
		trackKnob = doc.createElement("span");
		trackKnob.className = "atelier-video-track-knob";
		track.append(trackKnob);
	}

	pill.append(toggle, timecode, track);

	let rateButton: HTMLButtonElement | null = null;
	let muteButton: HTMLButtonElement | null = null;
	if (isStandalone) {
		rateButton = doc.createElement("button");
		rateButton.type = "button";
		rateButton.className = "atelier-video-rate";
		rateButton.setAttribute("aria-label", "Playback speed");
		rateButton.textContent = "1×";

		muteButton = doc.createElement("button");
		muteButton.type = "button";
		muteButton.className = "atelier-video-mute";
		muteButton.setAttribute("aria-label", "Mute");
		const volumeIcon = createIcon(doc, ICONS.volume);
		volumeIcon.classList.add("atelier-video-icon-volume");
		const mutedIcon = createIcon(doc, ICONS.muted);
		mutedIcon.classList.add("atelier-video-icon-muted");
		muteButton.append(volumeIcon, mutedIcon);
		pill.append(rateButton, muteButton);
	}

	const fullscreenButton = doc.createElement("button");
	fullscreenButton.type = "button";
	fullscreenButton.className = "atelier-video-fullscreen";
	fullscreenButton.setAttribute("aria-label", "Fullscreen");
	fullscreenButton.append(createIcon(doc, ICONS.fullscreen));
	pill.append(fullscreenButton);
	root.append(pill);

	const errorState = doc.createElement("span");
	errorState.className = "atelier-video-error";
	errorState.setAttribute("role", "alert");
	errorState.hidden = true;
	errorState.textContent = "This video could not be played.";
	root.append(errorState);

	if (isStandalone) root.tabIndex = 0;

	let destroyed = false;
	let currentSource: string | null = null;
	let metadataReported = false;
	let rateIndex = 0;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let scrubbing = false;

	const clearIdleTimer = () => {
		if (idleTimer !== null) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	};
	const hideControlsWhenIdle = () => {
		clearIdleTimer();
		if (video.paused) return;
		idleTimer = setTimeout(() => {
			if (!destroyed && !video.paused && !scrubbing) {
				root.dataset.idle = "true";
			}
		}, CONTROLS_IDLE_HIDE_MS);
	};
	const wakeControls = () => {
		delete root.dataset.idle;
		hideControlsWhenIdle();
	};

	const refreshPlaybackState = () => {
		const playing = !video.paused && !video.ended;
		root.dataset.playing = playing ? "true" : "false";
		const label = playing ? "Pause" : "Play";
		toggle.setAttribute("aria-label", label);
		if (playing) hideControlsWhenIdle();
		else {
			clearIdleTimer();
			delete root.dataset.idle;
		}
	};

	const refreshTime = () => {
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const current = Math.min(video.currentTime || 0, duration || Infinity);
		timecode.textContent = `${formatVideoTimecode(current)} / ${formatVideoTimecode(duration)}`;
		const fraction = duration > 0 ? Math.min(1, current / duration) : 0;
		const percent = `${(fraction * 100).toFixed(2)}%`;
		trackFill.style.width = percent;
		if (trackKnob) trackKnob.style.left = `calc(${percent} - 5px)`;
		track.setAttribute("aria-valuemax", String(Math.round(duration)));
		track.setAttribute("aria-valuenow", String(Math.round(current)));
	};

	const refreshSpecs = () => {
		if (!specsChip) return;
		const parts: string[] = [];
		if (Number.isFinite(video.duration) && video.duration > 0) {
			parts.push(formatVideoTimecode(video.duration));
		}
		if (video.videoWidth > 0 && video.videoHeight > 0) {
			parts.push(`${video.videoWidth}×${video.videoHeight}`);
		}
		const size = formatVideoFileSize(options.fileSizeBytes ?? Number.NaN);
		if (size) parts.push(size);
		specsChip.textContent = parts.join(" · ");
		specsChip.hidden = parts.length === 0;
	};

	const togglePlayback = () => {
		if (root.dataset.videoState === "error" || !currentSource) return;
		if (video.paused || video.ended) {
			void video.play()?.catch?.(() => {});
		} else {
			video.pause();
		}
	};

	const seekBy = (deltaSeconds: number) => {
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0) return;
		video.currentTime = Math.min(
			duration,
			Math.max(0, (video.currentTime || 0) + deltaSeconds),
		);
		refreshTime();
	};

	const seekToPointer = (event: PointerEvent) => {
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0) return;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return;
		const fraction = Math.min(
			1,
			Math.max(0, (event.clientX - rect.left) / rect.width),
		);
		video.currentTime = fraction * duration;
		refreshTime();
	};

	const toggleFullscreen = () => {
		if (doc.fullscreenElement === root) {
			void doc.exitFullscreen?.()?.catch?.(() => {});
			return;
		}
		void root.requestFullscreen?.()?.catch?.(() => {});
	};

	const cycleRate = () => {
		rateIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
		const rate = PLAYBACK_RATES[rateIndex]!;
		video.playbackRate = rate;
		if (rateButton) rateButton.textContent = `${rate}×`;
	};

	const toggleMute = () => {
		video.muted = !video.muted;
		root.dataset.muted = video.muted ? "true" : "false";
		muteButton?.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
	};

	const handleLoadedMetadata = () => {
		refreshTime();
		refreshSpecs();
		if (metadataReported) return;
		metadataReported = true;
		options.onMetadata?.({
			duration: Number.isFinite(video.duration) ? video.duration : 0,
			width: video.videoWidth,
			height: video.videoHeight,
		});
	};

	const handleVideoError = () => {
		if (!currentSource) return;
		root.dataset.videoState = "error";
		errorState.hidden = false;
		options.onError?.();
	};

	const handleTrackPointerDown = (event: PointerEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		scrubbing = true;
		track.setPointerCapture?.(event.pointerId);
		seekToPointer(event);
	};
	const handleTrackPointerMove = (event: PointerEvent) => {
		if (scrubbing) seekToPointer(event);
	};
	const endScrub = () => {
		scrubbing = false;
		hideControlsWhenIdle();
	};

	const handleKeydown = (event: KeyboardEvent) => {
		// Let focused buttons keep their native Space/Enter activation.
		if (
			event.target instanceof HTMLElement &&
			event.target.closest("button") !== null
		) {
			return;
		}
		switch (event.key) {
			case " ":
			case "k":
				event.preventDefault();
				togglePlayback();
				break;
			case "ArrowLeft":
				event.preventDefault();
				seekBy(-SEEK_STEP_SECONDS);
				break;
			case "ArrowRight":
				event.preventDefault();
				seekBy(SEEK_STEP_SECONDS);
				break;
			case "f":
				event.preventDefault();
				toggleFullscreen();
				break;
			case "m":
				event.preventDefault();
				toggleMute();
				break;
		}
	};

	video.addEventListener("play", refreshPlaybackState);
	video.addEventListener("pause", refreshPlaybackState);
	video.addEventListener("ended", refreshPlaybackState);
	video.addEventListener("timeupdate", refreshTime);
	video.addEventListener("durationchange", refreshTime);
	video.addEventListener("loadedmetadata", handleLoadedMetadata);
	video.addEventListener("error", handleVideoError);
	video.addEventListener("click", togglePlayback);
	puck.addEventListener("click", togglePlayback);
	toggle.addEventListener("click", togglePlayback);
	fullscreenButton.addEventListener("click", toggleFullscreen);
	rateButton?.addEventListener("click", cycleRate);
	muteButton?.addEventListener("click", toggleMute);
	track.addEventListener("pointerdown", handleTrackPointerDown);
	track.addEventListener("pointermove", handleTrackPointerMove);
	track.addEventListener("pointerup", endScrub);
	track.addEventListener("pointercancel", endScrub);
	root.addEventListener("pointermove", wakeControls);
	root.addEventListener("pointerdown", wakeControls);
	if (isStandalone) root.addEventListener("keydown", handleKeydown);

	return {
		element: root,
		video,
		setSource(src: string | null) {
			if (destroyed || src === currentSource) return;
			currentSource = src;
			metadataReported = false;
			delete root.dataset.videoState;
			errorState.hidden = true;
			if (src) {
				video.src = src;
			} else {
				video.removeAttribute("src");
				video.load?.();
			}
			refreshPlaybackState();
			refreshTime();
			refreshSpecs();
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			clearIdleTimer();
			video.removeEventListener("play", refreshPlaybackState);
			video.removeEventListener("pause", refreshPlaybackState);
			video.removeEventListener("ended", refreshPlaybackState);
			video.removeEventListener("timeupdate", refreshTime);
			video.removeEventListener("durationchange", refreshTime);
			video.removeEventListener("loadedmetadata", handleLoadedMetadata);
			video.removeEventListener("error", handleVideoError);
			video.removeEventListener("click", togglePlayback);
			puck.removeEventListener("click", togglePlayback);
			toggle.removeEventListener("click", togglePlayback);
			fullscreenButton.removeEventListener("click", toggleFullscreen);
			rateButton?.removeEventListener("click", cycleRate);
			muteButton?.removeEventListener("click", toggleMute);
			track.removeEventListener("pointerdown", handleTrackPointerDown);
			track.removeEventListener("pointermove", handleTrackPointerMove);
			track.removeEventListener("pointerup", endScrub);
			track.removeEventListener("pointercancel", endScrub);
			root.removeEventListener("pointermove", wakeControls);
			root.removeEventListener("pointerdown", wakeControls);
			if (isStandalone) root.removeEventListener("keydown", handleKeydown);
			video.pause?.();
			video.removeAttribute("src");
			video.load?.();
			root.remove();
		},
	};
}
