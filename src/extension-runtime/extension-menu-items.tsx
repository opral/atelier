import type {
	AtelierExtensionMenuItem,
	AtelierExtensionPreferences,
} from "../extension-api";
import type { ExtensionDefinition } from "./types";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";
import {
	ContextMenuCheckboxItem,
	ContextMenuItem,
	ContextMenuSeparator,
} from "../components/ui/context-menu";

export function resolveExtensionMenuItems(
	definition: ExtensionDefinition | null,
	preferences: AtelierExtensionPreferences,
): readonly AtelierExtensionMenuItem[] {
	if (!definition?.menuItems) return [];
	try {
		const keys = new Set<string>();
		return definition.menuItems({ preferences }).filter((item) => {
			if (!item || typeof item.key !== "string" || item.key.length === 0) {
				return false;
			}
			if (keys.has(item.key)) return false;
			keys.add(item.key);
			return true;
		});
	} catch (error) {
		console.warn(
			`[extension-menu] Failed to resolve menu items for "${definition.kind}".`,
			error,
		);
		return [];
	}
}

export function ExtensionDropdownMenuItems({
	items,
	itemClassName,
	separatorClassName,
}: {
	readonly items: readonly AtelierExtensionMenuItem[];
	readonly itemClassName?: string;
	readonly separatorClassName?: string;
}) {
	return items.map((item) => {
		if (item.kind === "separator") {
			return (
				<DropdownMenuSeparator key={item.key} className={separatorClassName} />
			);
		}
		if (item.kind === "checkbox") {
			const Icon = item.icon;
			return (
				<DropdownMenuCheckboxItem
					key={item.key}
					checked={item.checked}
					disabled={item.disabled}
					onSelect={item.onSelect}
					className={itemClassName}
					data-extension-menu-key={item.key}
				>
					{Icon ? (
						<Icon
							aria-hidden={true}
							className="size-3.25 shrink-0 text-[var(--color-icon-tertiary)]"
						/>
					) : (
						<span aria-hidden="true" className="size-3.25 shrink-0" />
					)}
					<span>{item.label}</span>
				</DropdownMenuCheckboxItem>
			);
		}
		return (
			<DropdownMenuItem
				key={item.key}
				disabled={item.disabled}
				onSelect={item.onSelect}
				className={itemClassName}
				data-extension-menu-key={item.key}
			>
				{item.icon ? (
					<item.icon
						aria-hidden={true}
						className="size-3.25 shrink-0 text-[var(--color-icon-tertiary)]"
					/>
				) : (
					<span aria-hidden="true" className="size-3.25 shrink-0" />
				)}
				<span>{item.label}</span>
			</DropdownMenuItem>
		);
	});
}

export function ExtensionContextMenuItems({
	items,
	itemClassName,
	separatorClassName,
}: {
	readonly items: readonly AtelierExtensionMenuItem[];
	readonly itemClassName?: string;
	readonly separatorClassName?: string;
}) {
	return items.map((item) => {
		if (item.kind === "separator") {
			return (
				<ContextMenuSeparator key={item.key} className={separatorClassName} />
			);
		}
		if (item.kind === "checkbox") {
			const Icon = item.icon;
			return (
				<ContextMenuCheckboxItem
					key={item.key}
					checked={item.checked}
					disabled={item.disabled}
					onSelect={item.onSelect}
					className={itemClassName}
					data-extension-menu-key={item.key}
				>
					{Icon ? (
						<Icon
							aria-hidden={true}
							className="size-3.25 shrink-0 text-[var(--color-icon-tertiary)]"
						/>
					) : (
						<span aria-hidden="true" className="size-3.25 shrink-0" />
					)}
					<span>{item.label}</span>
				</ContextMenuCheckboxItem>
			);
		}
		return (
			<ContextMenuItem
				key={item.key}
				disabled={item.disabled}
				onSelect={item.onSelect}
				className={itemClassName}
				data-extension-menu-key={item.key}
			>
				{item.icon ? (
					<item.icon
						aria-hidden={true}
						className="size-3.25 shrink-0 text-[var(--color-icon-tertiary)]"
					/>
				) : (
					<span aria-hidden="true" className="size-3.25 shrink-0" />
				)}
				<span>{item.label}</span>
			</ContextMenuItem>
		);
	});
}
