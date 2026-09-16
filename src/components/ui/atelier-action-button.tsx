import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type AtelierActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly variant?: "primary" | "secondary";
	readonly fullWidth?: boolean;
};

/**
 * The featured and secondary actions used in Atelier's workspace surfaces.
 *
 * Keeping both treatments here makes their shared geometry and focus behavior
 * explicit while allowing their visual hierarchy to differ by intent.
 */
const AtelierActionButton = forwardRef<
	HTMLButtonElement,
	AtelierActionButtonProps
>(
	(
		{
			className,
			fullWidth = false,
			type = "button",
			variant = "primary",
			...props
		},
		ref,
	) => (
		<button
			ref={ref}
			type={type}
			data-ui="atelier-action-button"
			data-slot="atelier-action-button"
			data-variant={variant}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-[9px] px-4 py-2.25 text-[13.5px] font-bold transition-[background-color,border-color,color,box-shadow,filter,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				fullWidth && "w-full",
				variant === "primary"
					? "bg-[linear-gradient(180deg,var(--at-link)_0%,var(--at-link)_100%)] text-accent-on shadow-shadow-accent hover:brightness-105 active:translate-y-px"
					: "border border-border-strong bg-panel text-fg-muted shadow-shadow-sm hover:bg-bg-hover hover:text-fg active:translate-y-px",
				className,
			)}
			{...props}
		/>
	),
);

AtelierActionButton.displayName = "AtelierActionButton";

export { AtelierActionButton };
