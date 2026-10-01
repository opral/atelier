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
				"atw:inline-flex atw:items-center atw:justify-center atw:gap-2 atw:rounded-[9px] atw:px-4 atw:py-2.25 atw:text-[13.5px] atw:font-bold atw:transition-[background-color,border-color,color,box-shadow,filter,transform] atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:ring-offset-2",
				fullWidth && "atw:w-full",
				variant === "primary"
					? "atw:bg-[linear-gradient(180deg,var(--atelier-link)_0%,var(--atelier-link)_100%)] atw:text-accent-on atw:shadow-accent atw:hover:brightness-105 atw:active:translate-y-px"
					: "atw:border atw:border-border-strong atw:bg-panel atw:text-fg-muted atw:shadow-sm atw:hover:bg-bg-hover atw:hover:text-fg atw:active:translate-y-px",
				className,
			)}
			{...props}
		/>
	),
);

AtelierActionButton.displayName = "AtelierActionButton";

export { AtelierActionButton };
