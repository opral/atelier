import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"atw:inline-flex atw:cursor-pointer atw:items-center atw:justify-center atw:gap-2 atw:whitespace-nowrap atw:rounded-md atw:text-sm atw:font-medium atw:transition-all atw:disabled:pointer-events-none atw:disabled:opacity-50 atw:[&_svg]:pointer-events-none atw:[&_svg:not([class*='size-'])]:size-4 atw:shrink-0 atw:[&_svg]:shrink-0 atw:outline-none atw:focus-visible:border-ring atw:focus-visible:ring-ring atw:focus-visible:ring-[3px] atw:aria-invalid:ring-danger/20 atw:dark:aria-invalid:ring-danger/40 atw:aria-invalid:border-danger",
	{
		variants: {
			variant: {
				default:
					"atw:bg-accent atw:text-accent-on atw:shadow-xs atw:hover:bg-accent/90",
				destructive:
					"atw:bg-danger atw:text-accent-on atw:shadow-xs atw:hover:bg-danger/90 atw:focus-visible:ring-danger/20 atw:dark:focus-visible:ring-danger/40 atw:dark:bg-danger/60",
				ghost:
					"atw:hover:bg-bg-hover atw:hover:text-fg atw:dark:hover:bg-bg-hover/50",
			},
			size: {
				default: "atw:h-9 atw:px-4 atw:py-2 atw:has-[>svg]:px-3",
				sm: "atw:h-8 atw:rounded-md atw:gap-1.5 atw:px-3 atw:has-[>svg]:px-2.5",
				icon: "atw:size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant,
	size,
	...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
	return (
		<button
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button };
