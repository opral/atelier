import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function DropdownMenu({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
	return (
		<DropdownMenuPrimitive.Trigger
			data-slot="dropdown-menu-trigger"
			{...props}
		/>
	);
}

function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				className={cn(
					"atelier-portal atw:bg-panel atw:text-fg atw:border-border atw:data-[state=open]:animate-in atw:data-[state=closed]:animate-out atw:data-[state=closed]:fade-out-0 atw:data-[state=open]:fade-in-0 atw:data-[state=closed]:zoom-out-95 atw:data-[state=open]:zoom-in-95 atw:data-[side=bottom]:slide-in-from-top-2 atw:data-[side=left]:slide-in-from-right-2 atw:data-[side=right]:slide-in-from-left-2 atw:data-[side=top]:slide-in-from-bottom-2 atw:z-50 atw:max-h-(--radix-dropdown-menu-content-available-height) atw:min-w-[8rem] atw:origin-(--radix-dropdown-menu-content-transform-origin) atw:overflow-x-hidden atw:overflow-y-auto atw:rounded-md atw:border atw:p-1 atw:font-sans atw:shadow-md",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuItem({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			data-slot="dropdown-menu-item"
			className={cn(
				"atw:focus:bg-bg-hover atw:focus:text-fg atw:[&_svg:not([class*='text-'])]:text-fg-muted atw:relative atw:flex atw:cursor-default atw:items-center atw:gap-2 atw:rounded-sm atw:px-2 atw:py-1.5 atw:text-sm atw:outline-hidden atw:select-none atw:data-[disabled]:pointer-events-none atw:data-[disabled]:opacity-50 atw:[&_svg]:pointer-events-none atw:[&_svg]:shrink-0 atw:[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			checked={checked}
			className={cn(
				"atw:focus:bg-bg-hover atw:focus:text-fg atw:relative atw:flex atw:cursor-default atw:items-center atw:gap-2 atw:rounded-sm atw:px-2 atw:py-1.5 atw:text-sm atw:outline-hidden atw:select-none atw:data-[disabled]:pointer-events-none atw:data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
			<span className="atw:ml-auto atw:flex atw:size-4 atw:shrink-0 atw:items-center atw:justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<CheckIcon className="atw:size-3.5 atw:text-link" strokeWidth={2.6} />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("atw:bg-border atw:-mx-1 atw:my-1 atw:h-px", className)}
			{...props}
		/>
	);
}

function DropdownMenuSub({
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
	return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			data-slot="dropdown-menu-sub-trigger"
			className={cn(
				"atw:focus:bg-bg-hover atw:focus:text-fg atw:data-[state=open]:bg-bg-hover atw:data-[state=open]:text-fg atw:flex atw:cursor-default atw:items-center atw:rounded-sm atw:px-2 atw:py-1.5 atw:text-sm atw:outline-hidden atw:select-none",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="atw:ml-auto atw:size-4" />
		</DropdownMenuPrimitive.SubTrigger>
	);
}

function DropdownMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
	return (
		<DropdownMenuPrimitive.SubContent
			data-slot="dropdown-menu-sub-content"
			className={cn(
				"atelier-portal atw:bg-panel atw:text-fg atw:border-border atw:data-[state=open]:animate-in atw:data-[state=closed]:animate-out atw:data-[state=closed]:fade-out-0 atw:data-[state=open]:fade-in-0 atw:data-[state=closed]:zoom-out-95 atw:data-[state=open]:zoom-in-95 atw:data-[side=bottom]:slide-in-from-top-2 atw:data-[side=left]:slide-in-from-right-2 atw:data-[side=right]:slide-in-from-left-2 atw:data-[side=top]:slide-in-from-bottom-2 atw:z-50 atw:min-w-[8rem] atw:origin-(--radix-dropdown-menu-content-transform-origin) atw:overflow-hidden atw:rounded-md atw:border atw:p-1 atw:font-sans atw:shadow-lg",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
};
