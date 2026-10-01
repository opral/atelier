import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function ContextMenu({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
	return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
	return (
		<ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
	);
}

function ContextMenuContent({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				data-slot="context-menu-content"
				className={cn(
					"atelier-portal atw:bg-panel atw:text-fg atw:border-border atw:data-[state=open]:animate-in atw:data-[state=closed]:animate-out atw:data-[state=closed]:fade-out-0 atw:data-[state=open]:fade-in-0 atw:data-[state=closed]:zoom-out-95 atw:data-[state=open]:zoom-in-95 atw:z-50 atw:max-h-(--radix-context-menu-content-available-height) atw:min-w-[8rem] atw:origin-(--radix-context-menu-content-transform-origin) atw:overflow-x-hidden atw:overflow-y-auto atw:rounded-md atw:border atw:p-1 atw:font-sans atw:shadow-md",
					className,
				)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuItem({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
	return (
		<ContextMenuPrimitive.Item
			data-slot="context-menu-item"
			className={cn(
				"atw:focus:bg-bg-hover atw:focus:text-fg atw:[&_svg:not([class*='text-'])]:text-fg-muted atw:relative atw:flex atw:cursor-default atw:items-center atw:gap-2 atw:rounded-sm atw:px-2 atw:py-1.5 atw:text-sm atw:outline-hidden atw:select-none atw:data-[disabled]:pointer-events-none atw:data-[disabled]:opacity-50 atw:[&_svg]:pointer-events-none atw:[&_svg]:shrink-0 atw:[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function ContextMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
	return (
		<ContextMenuPrimitive.CheckboxItem
			data-slot="context-menu-checkbox-item"
			checked={checked}
			className={cn(
				"atw:focus:bg-bg-hover atw:focus:text-fg atw:relative atw:flex atw:cursor-default atw:items-center atw:gap-2 atw:rounded-sm atw:px-2 atw:py-1.5 atw:text-sm atw:outline-hidden atw:select-none atw:data-[disabled]:pointer-events-none atw:data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
			<span className="atw:ml-auto atw:flex atw:size-4 atw:shrink-0 atw:items-center atw:justify-center">
				<ContextMenuPrimitive.ItemIndicator>
					<CheckIcon className="atw:size-3.5 atw:text-link" strokeWidth={2.6} />
				</ContextMenuPrimitive.ItemIndicator>
			</span>
		</ContextMenuPrimitive.CheckboxItem>
	);
}

function ContextMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return (
		<ContextMenuPrimitive.Separator
			data-slot="context-menu-separator"
			className={cn("atw:bg-border atw:-mx-1 atw:my-1 atw:h-px", className)}
			{...props}
		/>
	);
}

export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuCheckboxItem,
	ContextMenuSeparator,
};
