import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider({
	delayDuration = 3000,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({
	delayDuration,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
	delayDuration?: number;
}) {
	return (
		<TooltipProvider delayDuration={delayDuration ?? 3000}>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	);
}

function TooltipTrigger({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 0,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					"atelier-portal atw:bg-overlay atw:text-overlay-fg atw:animate-in atw:fade-in-0 atw:zoom-in-95 atw:data-[state=closed]:animate-out atw:data-[state=closed]:fade-out-0 atw:data-[state=open]:zoom-in-95 atw:data-[state=closed]:zoom-out-95 atw:data-[side=bottom]:slide-in-from-top-2 atw:data-[side=left]:slide-in-from-right-2 atw:data-[side=right]:slide-in-from-left-2 atw:data-[side=top]:slide-in-from-bottom-2 atw:z-50 atw:w-fit atw:origin-(--radix-tooltip-content-transform-origin) atw:rounded-md atw:px-3 atw:py-1.5 atw:font-sans atw:text-xs atw:text-balance",
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow className="atw:bg-overlay atw:fill-overlay atw:z-50 atw:size-2.5 atw:translate-y-[calc(-50%_-_2px)] atw:rotate-45 atw:rounded-[2px]" />
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipTrigger, TooltipContent };
