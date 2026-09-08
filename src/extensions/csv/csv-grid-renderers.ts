import {
	AllCellRenderers,
	markerCellRenderer,
} from "@glideapps/glide-data-grid";

// Glide uses an 18px row checkbox. Scale its own renderer to 14px while
// preserving the full hit target and the original row-number typography.
const compactMarker: typeof markerCellRenderer = {
	...markerCellRenderer,
	draw(args) {
		const { ctx, rect, cell } = args;
		if (cell.markerKind === "number")
			return markerCellRenderer.draw(args, cell);
		if (cell.markerKind === "both" && !cell.checked) {
			ctx.save();
			ctx.globalAlpha = 1 - args.hoverAmount;
			markerCellRenderer.draw(
				{
					...args,
					hoverAmount: 0,
					cell: { ...cell, markerKind: "number" },
				},
				cell,
			);
			ctx.restore();
		}
		ctx.save();
		const centerX = rect.x + rect.width / 2;
		const centerY = rect.y + rect.height / 2;
		ctx.translate(centerX, centerY);
		ctx.scale(14 / 18, 14 / 18);
		ctx.translate(-centerX, -centerY);
		markerCellRenderer.draw(
			{
				...args,
				cell: {
					...cell,
					markerKind: cell.markerKind === "both" ? "checkbox" : cell.markerKind,
				},
			},
			cell,
		);
		ctx.restore();
	},
};
export const csvCellRenderers: typeof AllCellRenderers = AllCellRenderers.map((renderer) =>
	renderer.kind === compactMarker.kind
		? {
				...renderer,
				draw(
					args: Parameters<typeof renderer.draw>[0],
					cell: Parameters<typeof renderer.draw>[1],
				) {
					if (args.cell.kind === compactMarker.kind) {
						compactMarker.draw({ ...args, cell: args.cell }, args.cell);
					} else renderer.draw(args, cell);
				},
			}
		: renderer,
);
