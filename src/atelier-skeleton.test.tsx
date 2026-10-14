import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AtelierSkeleton } from "./create-atelier";

describe("AtelierSkeleton", () => {
	test("draws the brand where the workspace will: the open sidebar's header", () => {
		const { container } = render(
			<AtelierSkeleton
				isLeftSidebarVisible
				leftSidebarSize={25}
				slots={{ navbarBrand: <span>Brand</span> }}
			/>,
		);

		const sidebarHeader = container.querySelector(
			'[data-atelier-part="sidebar-header"]',
		);
		expect(sidebarHeader).toContainElement(screen.getByText("Brand"));
		expect(sidebarHeader?.parentElement).toHaveStyle({
			width: "calc((100% - 8px) * 0.25)",
		});
		expect(
			container.querySelector('[data-atelier-part="top-bar"]'),
		).toHaveAttribute("data-shows-identity", "false");
	});

	test("folds the brand into the island's header when the sidebar is closed", () => {
		const { container } = render(
			<AtelierSkeleton slots={{ navbarBrand: <span>Brand</span> }} />,
		);

		expect(
			container.querySelector('[data-atelier-part="sidebar-header"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-atelier-part="top-bar"]'),
		).toContainElement(screen.getByText("Brand"));
	});
});
