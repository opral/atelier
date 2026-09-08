import type { ReactNode } from "react";
import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";
import { getStroke } from "perfect-freehand";
import { parseExcalidrawScene } from "./scene";

type Element = Record<string, unknown>;
type Point = [number, number];
const number = (value: unknown, fallback = 0) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;
const color = (value: unknown, fallback: string) =>
	typeof value === "string" &&
	/^(?:#[0-9a-f]{3,8}|transparent|none|[a-z]+)$/i.test(value)
		? value
		: fallback;
const pointsOf = (element: Element): Point[] =>
	Array.isArray(element.points)
		? element.points
				.filter(Array.isArray)
				.map((point) => [number(point[0]), number(point[1])])
		: [];
const generator = rough.generator();

function roughPaths(drawable: Drawable) {
	return generator
		.toPaths(drawable)
		.map((path, index) => (
			<path
				key={index}
				d={path.d}
				stroke={path.stroke}
				strokeWidth={path.strokeWidth}
				fill={path.fill}
				strokeDasharray={
					drawable.sets[index]?.type === "path" ? undefined : "none"
				}
			/>
		));
}

function arrowhead(
	kind: unknown,
	tip: Point,
	neighbor: Point,
	stroke: string,
	width: number,
): ReactNode {
	if (typeof kind !== "string") return null;
	const size = Math.max(12, width * 5);
	const angle =
		(Math.atan2(tip[1] - neighbor[1], tip[0] - neighbor[0]) * 180) / Math.PI;
	let shape: ReactNode;
	switch (kind) {
		case "dot":
		case "circle":
		case "circle_outline":
			shape = (
				<circle
					cx={-size / 2}
					r={size / 2}
					fill={kind.endsWith("outline") ? "none" : stroke}
				/>
			);
			break;
		case "bar":
			shape = <path d={`M 0 ${-size / 2} L 0 ${size / 2}`} />;
			break;
		case "diamond":
		case "diamond_outline":
			shape = (
				<polygon
					points={`0,0 ${-size / 2},${size / 2} ${-size},0 ${-size / 2},${-size / 2}`}
					fill={kind.endsWith("outline") ? "none" : stroke}
				/>
			);
			break;
		case "triangle":
		case "triangle_outline":
			shape = (
				<polygon
					points={`0,0 ${-size},${size / 2} ${-size},${-size / 2}`}
					fill={kind.endsWith("outline") ? "none" : stroke}
				/>
			);
			break;
		default:
			shape = (
				<path d={`M ${-size} ${-size / 2} L 0 0 L ${-size} ${size / 2}`} />
			);
	}
	return (
		<g
			transform={`translate(${tip.join(" ")}) rotate(${angle})`}
			fill="none"
			stroke={stroke}
			strokeWidth={width}
			strokeDasharray="none"
			data-arrowhead={kind}
		>
			{shape}
		</g>
	);
}

function shapeOf(
	element: Element,
	files: Record<string, unknown>,
	index: number,
): ReactNode {
	const w = Math.abs(number(element.width)),
		h = Math.abs(number(element.height));
	const stroke = color(element.strokeColor, "#222"),
		fill = color(element.backgroundColor, "none");
	const width = Math.max(0.1, number(element.strokeWidth, 1));
	// RoughJS falls back to Math.random when a seed collapses to zero during
	// its 31-bit PRNG arithmetic. Keep imported seeds in the supported range.
	const seed =
		Math.abs(Math.trunc(number(element.seed, index + 1))) % 2147483647 || 1;
	const options: Options = {
		seed,
		stroke,
		fill: fill === "none" || fill === "transparent" ? undefined : fill,
		strokeWidth: width,
		roughness: Math.max(0, number(element.roughness, 1)),
		fillStyle: ["solid", "hachure", "cross-hatch", "zigzag"].includes(
			String(element.fillStyle),
		)
			? String(element.fillStyle)
			: "hachure",
		hachureGap: width * 4,
		fillWeight: width / 2,
	};
	switch (element.type) {
		case "rectangle":
		case "frame":
		case "magicframe": {
			if (element.roundness) {
				const r = Math.min(w / 2, h / 2, 32, Math.min(w, h) * 0.25);
				return roughPaths(
					generator.path(
						`M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`,
						options,
					),
				);
			}
			return roughPaths(generator.rectangle(0, 0, w, h, options));
		}
		case "ellipse":
			return roughPaths(generator.ellipse(w / 2, h / 2, w, h, options));
		case "diamond":
			return roughPaths(
				generator.polygon(
					[
						[w / 2, 0],
						[w, h / 2],
						[w / 2, h],
						[0, h / 2],
					],
					options,
				),
			);
		case "text": {
			const fontSize = Math.max(1, number(element.fontSize, 20));
			const lines = String(element.text ?? "").split("\n");
			const lineHeight =
				Math.max(0.1, number(element.lineHeight, 1.25)) * fontSize;
			const align = element.textAlign;
			const x = align === "center" ? w / 2 : align === "right" ? w : 0;
			const y =
				element.verticalAlign === "middle"
					? (h - lines.length * lineHeight) / 2
					: element.verticalAlign === "bottom"
						? h - lines.length * lineHeight
						: 0;
			const family =
				element.fontFamily === 3
					? "monospace"
					: element.fontFamily === 2
						? "Helvetica, Arial, sans-serif"
						: "Excalifont, Virgil, cursive";
			return (
				<text
					fill={stroke}
					stroke="none"
					fontSize={fontSize}
					fontFamily={family}
					textAnchor={
						align === "center" ? "middle" : align === "right" ? "end" : "start"
					}
					dominantBaseline="text-before-edge"
					xmlSpace="preserve"
				>
					{lines.map((line, i) => (
						<tspan key={i} x={x} y={y + i * lineHeight}>
							{line}
						</tspan>
					))}
				</text>
			);
		}
		case "image": {
			const file = files[String(element.fileId)];
			const url =
				file && typeof file === "object" && "dataURL" in file
					? file.dataURL
					: null;
			// Raster-only data URLs cannot execute scripts or trigger external fetches.
			if (
				typeof url === "string" &&
				/^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/.test(
					url,
				)
			) {
				const scale = Array.isArray(element.scale) ? element.scale : [1, 1];
				const sx = number(scale[0], 1) < 0 ? -1 : 1,
					sy = number(scale[1], 1) < 0 ? -1 : 1;
				return (
					<image
						href={url}
						width={w}
						height={h}
						preserveAspectRatio="none"
						transform={`translate(${sx < 0 ? w : 0} ${sy < 0 ? h : 0}) scale(${sx} ${sy})`}
					/>
				);
			}
			return (
				<g>
					<rect width={w} height={h} fill="none" />
					<text fill={stroke} stroke="none" fontSize="14" y="16">
						Image unavailable
					</text>
				</g>
			);
		}
		case "freedraw": {
			const points = pointsOf(element);
			const pressures = Array.isArray(element.pressures)
				? element.pressures
				: [];
			const outline = getStroke(
				points.map((point, i) => [
					...point,
					Math.max(0, Math.min(1, number(pressures[i], 0.5))),
				]),
				{
					size: width * 4.25,
					thinning: 0.6,
					smoothing: 0.5,
					streamline: 0.5,
					simulatePressure: element.simulatePressure !== false,
					easing: (t) => Math.sin((t * Math.PI) / 2),
					last: true,
				},
			);
			const path = outline.length
				? `M ${outline[0]!.join(" ")} Q ${outline
						.map((point, i) => {
							const next = outline[(i + 1) % outline.length]!;
							return `${point.join(" ")} ${(point[0]! + next[0]!) / 2} ${(point[1]! + next[1]!) / 2}`;
						})
						.join(" ")} Z`
				: "";
			return <path d={path} fill={stroke} stroke="none" />;
		}
		case "line":
		case "arrow": {
			const points = pointsOf(element);
			if (points.length < 2) return null;
			const body =
				element.roundness && !element.elbowed
					? generator.curve(points, { ...options, fill: "none" })
					: generator.linearPath(points, { ...options, fill: "none" });
			return (
				<>
					{roughPaths(body)}
					{arrowhead(
						element.startArrowhead,
						points[0]!,
						points[1]!,
						stroke,
						width,
					)}
					{arrowhead(
						element.endArrowhead,
						points.at(-1)!,
						points.at(-2)!,
						stroke,
						width,
					)}
				</>
			);
		}
		default:
			return (
				<g>
					<rect width={w} height={h} fill="none" strokeDasharray="4 4" />
					<text fill={stroke} stroke="none" fontSize="14">
						{String(element.type ?? "Element")}
					</text>
				</g>
			);
	}
}

/** Pure seeded SVG geometry: the server and first browser render are identical. */
export function SceneContent({ content }: { readonly content: string }) {
	const parsed = parseExcalidrawScene(content);
	if (!parsed.ok) return <p>{parsed.error}</p>;
	const elements = parsed.scene.elements.filter(
		(element) => !element.isDeleted,
	);
	if (exceedsPreviewBudget(elements))
		return <p>This drawing is too large to preview.</p>;
	const bounds = elements.flatMap((element) => {
		const x = number(element.x),
			y = number(element.y),
			w = Math.abs(number(element.width)),
			h = Math.abs(number(element.height));
		const angle = number(element.angle),
			c = Math.cos(angle),
			s = Math.sin(angle);
		const points: Point[] = [
			[0, 0],
			[w, 0],
			[w, h],
			[0, h],
			...pointsOf(element),
		];
		const padding = Math.max(24, number(element.strokeWidth, 1) * 8);
		return points.flatMap(([px, py]) => {
			const rx = x + w / 2 + (px - w / 2) * c - (py - h / 2) * s;
			const ry = y + h / 2 + (px - w / 2) * s + (py - h / 2) * c;
			return [
				[rx - padding, ry - padding],
				[rx + padding, ry + padding],
			];
		});
	});
	const [left, top, right, bottom] = bounds.reduce(
		([minX, minY, maxX, maxY], [x, y]) => [
			Math.min(minX!, x!),
			Math.min(minY!, y!),
			Math.max(maxX!, x!),
			Math.max(maxY!, y!),
		],
		bounds.length
			? [Infinity, Infinity, -Infinity, -Infinity]
			: [-24, -24, 124, 124],
	);
	return (
		<svg
			role="img"
			aria-label="Drawing preview"
			viewBox={`${left} ${top} ${right - left} ${bottom - top}`}
			className="h-full min-h-64 w-full"
			data-atelier-scene-content=""
			style={{
				background: color(
					parsed.scene.appState.viewBackgroundColor,
					"transparent",
				),
			}}
		>
			<title>Drawing preview</title>
			{elements.map((element, index) => {
				const w = Math.abs(number(element.width)),
					h = Math.abs(number(element.height));
				const width = Math.max(0.1, number(element.strokeWidth, 1));
				return (
					<g
						key={String(element.id ?? index)}
						transform={`translate(${number(element.x)} ${number(element.y)}) rotate(${(number(element.angle) * 180) / Math.PI} ${w / 2} ${h / 2})`}
						stroke={color(element.strokeColor, "#222")}
						strokeWidth={width}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeDasharray={
							element.strokeStyle === "dashed"
								? `${width * 8} ${width * 8}`
								: element.strokeStyle === "dotted"
									? `${width} ${width * 4}`
									: undefined
						}
						opacity={
							Math.max(0, Math.min(100, number(element.opacity, 100))) / 100
						}
					>
						{shapeOf(element, parsed.scene.files, index)}
					</g>
				);
			})}
		</svg>
	);
}

function exceedsPreviewBudget(elements: readonly Element[]): boolean {
	if (elements.length > 2_000) return true;
	let points = 0;
	let hatchLines = 0;
	for (const element of elements) {
		const width = Math.abs(number(element.width));
		const height = Math.abs(number(element.height));
		if (
			[element.x, element.y, width, height].some(
				(value) => Math.abs(number(value)) > 1_000_000,
			)
		)
			return true;
		if (
			Math.abs(number(element.strokeWidth)) > 1_000 ||
			Math.abs(number(element.roughness)) > 100
		)
			return true;
		const rawPoints = Array.isArray(element.points) ? element.points : [];
		points += rawPoints.length;
		if (points > 50_000) return true;
		if (
			rawPoints.some(
				(point) =>
					Array.isArray(point) &&
					point.some((value) => Math.abs(number(value)) > 1_000_000),
			)
		)
			return true;
		const fill = color(element.backgroundColor, "none");
		if (
			fill !== "none" &&
			fill !== "transparent" &&
			element.fillStyle !== "solid"
		) {
			const gap = Math.max(
				1,
				Math.round(Math.max(0.1, number(element.strokeWidth, 1)) * 4),
			);
			hatchLines +=
				((width + height) / gap) *
				(element.fillStyle === "cross-hatch" ? 2 : 1);
			if (hatchLines > 50_000) return true;
		}
	}
	return false;
}
