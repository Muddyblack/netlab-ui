import { useEffect, useState } from "react";

export function usePortalInjection() {
    const [portalContainer, setPortalContainer] = useState<Element | null>(null);
    const [navbarPortalContainer, setNavbarPortalContainer] = useState<HTMLElement | null>(null);
    const [tabBarContainer, setTabBarContainer] = useState<HTMLElement | null>(null);
    const [leftSidebarToggleContainer, setLeftSidebarToggleContainer] = useState<HTMLElement | null>(null);
    const [netlabLinksPaletteContainer, setNetlabLinksPaletteContainer] = useState<HTMLElement | null>(null);

    // Main canvas portal — injected into clab-ui's <main>
    useEffect(() => {
        let active = true;
        const find = () => {
            const el = document.querySelector('[data-testid="topoviewer-app"] main');
            if (el) { setPortalContainer(el); } else if (active) { requestAnimationFrame(find); }
        };
        find();
        return () => { active = false; };
    }, []);

    // Navbar toolbar portal — inserted before the "About" button
    useEffect(() => {
        const PORTAL_ID = "theme-toggle-portal";
        const tryInject = () => {
            if (document.getElementById(PORTAL_ID)) return true;
            const aboutBtn = document.querySelector<HTMLElement>('[data-testid="navbar-about"]');
            if (!aboutBtn) return false;
            const el = document.createElement("span");
            el.id = PORTAL_ID;
            el.style.cssText = "display:inline-flex;align-items:center";
            aboutBtn.parentElement?.insertBefore(el, aboutBtn);
            setNavbarPortalContainer(el);
            return true;
        };
        if (tryInject()) return;
        const obs = new MutationObserver(() => { if (tryInject()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
        return () => { obs.disconnect(); document.getElementById(PORTAL_ID)?.remove(); setNavbarPortalContainer(null); };
    }, []);

    // Tab bar portal — appended to clab-ui's <main>, sits above the canvas
    useEffect(() => {
        const TAB_BAR_ID = "lab-tab-bar-portal";
        const tryInject = () => {
            if (document.getElementById(TAB_BAR_ID)) return true;
            const main = document.querySelector('[data-testid="topoviewer-app"] main');
            if (!main) return false;
            const el = document.createElement("div");
            el.id = TAB_BAR_ID;
            el.style.cssText = "position:absolute;top:0;left:0;right:0;z-index:4";
            main.appendChild(el);
            setTabBarContainer(el);
            return true;
        };
        if (tryInject()) return;
        const obs = new MutationObserver(() => { if (tryInject()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
        return () => { obs.disconnect(); document.getElementById(TAB_BAR_ID)?.remove(); setTabBarContainer(null); };
    }, []);

    // Left sidebar toggle handle — floats on the right edge of the explorer pane.
    // Found structurally (no data-testid needed in clab-ui):
    //   topoviewer-app (flex col) > children[1] (layout flex row) > firstElementChild (explorer pane)
    useEffect(() => {
        const TOGGLE_ID = "left-sidebar-toggle-portal";
        let resizeObs: ResizeObserver | null = null;
        let styleObs: MutationObserver | null = null;
        let contextPanelObs: MutationObserver | null = null;
        let resizeHandler: (() => void) | null = null;

        const getExplorerPane = (): HTMLElement | null => {
            const app = document.querySelector<HTMLElement>('[data-testid="topoviewer-app"]');
            if (!app) return null;
            // layout row = second child of the topoviewer-app column (first is the AppBar)
            const layoutRow = app.children[1] as HTMLElement | undefined;
            if (!layoutRow) return null;
            // explorer pane = first div child of the layout flex row
            return layoutRow.firstElementChild as HTMLElement | null;
        };

        const updatePosition = (pane: HTMLElement, handle: HTMLElement) => {
            const rect = pane.getBoundingClientRect();
            // Collapsed pane width is zero, so the handle anchors to the app's left edge.
            const x = rect.width > 0 ? rect.right : 0;
            const app = document.querySelector<HTMLElement>('[data-testid="topoviewer-app"]');
            const appRect = app?.getBoundingClientRect();
            const midY = appRect
                ? appRect.top + appRect.height / 2
                : window.innerHeight / 2;
            handle.style.left = `${x}px`;
            handle.style.top = `${midY}px`;
        };

        const updateVisibility = (handle: HTMLElement) => {
            const app = document.querySelector<HTMLElement>('[data-testid="topoviewer-app"]');
            const appRect = app?.getBoundingClientRect();
            const panelPaper = document.querySelector<HTMLElement>("[data-testid='context-panel'] .MuiDrawer-paper");
            const panelRect = panelPaper?.getBoundingClientRect();
            const panelIsOpenOnLeft = Boolean(
                appRect &&
                panelRect &&
                panelRect.width > 0 &&
                panelRect.left <= appRect.left + 2 &&
                panelRect.right > appRect.left + 24
            );
            const handleRect = handle.getBoundingClientRect();
            const handleIsAtLeftEdge = handleRect.width > 0 && handleRect.left <= (appRect?.left ?? 0) + 24;
            const panelToggleOverlapsLeftEdge = handleIsAtLeftEdge && Array.from(
                document.querySelectorAll<HTMLElement>("[data-testid='panel-toggle-btn']")
            ).some((button) => {
                const rect = button.getBoundingClientRect();
                return rect.width > 0 && rect.left <= (appRect?.left ?? 0) + 24;
            });
            const shouldHide = panelIsOpenOnLeft || panelToggleOverlapsLeftEdge;

            handle.style.opacity = shouldHide ? "0" : "1";
            handle.style.pointerEvents = shouldHide ? "none" : "auto";
        };

        const updateHandle = (pane: HTMLElement, handle: HTMLElement) => {
            updatePosition(pane, handle);
            updateVisibility(handle);
        };

        const tryInject = () => {
            if (document.getElementById(TOGGLE_ID)) return true;
            const pane = getExplorerPane();
            if (!pane) return false;

            const el = document.createElement("div");
            el.id = TOGGLE_ID;
            el.style.cssText = [
                "position:fixed",
                "z-index:1300",
                "transform:translateY(-50%)",
                "display:flex",
                "flex-direction:column",
                "align-items:center",
                "gap:4px",
                "transition:left 250ms cubic-bezier(0.4,0,0.2,1),top 250ms cubic-bezier(0.4,0,0.2,1),opacity 120ms ease",
                "pointer-events:auto"
            ].join(";");
            document.body.appendChild(el);
            updateHandle(pane, el);

            resizeObs = new ResizeObserver(() => updateHandle(pane, el));
            resizeObs.observe(pane);

            // Reposition when the pane's inline collapse styles change.
            styleObs = new MutationObserver(() => {
                requestAnimationFrame(() => updateHandle(pane, el));
            });
            styleObs.observe(pane, { attributes: true, attributeFilter: ["style"] });

            contextPanelObs = new MutationObserver(() => {
                requestAnimationFrame(() => updateVisibility(el));
            });
            contextPanelObs.observe(document.body, { attributes: true, childList: true, subtree: true });

            resizeHandler = () => updateHandle(pane, el);
            window.addEventListener("resize", resizeHandler);

            setLeftSidebarToggleContainer(el);
            return true;
        };

        if (tryInject()) return;
        const mutObs = new MutationObserver(() => { if (tryInject()) mutObs.disconnect(); });
        mutObs.observe(document.body, { childList: true, subtree: true });

        return () => {
            mutObs.disconnect();
            resizeObs?.disconnect();
            styleObs?.disconnect();
            contextPanelObs?.disconnect();
            if (resizeHandler) window.removeEventListener("resize", resizeHandler);
            document.getElementById(TOGGLE_ID)?.remove();
            setLeftSidebarToggleContainer(null);
        };
    }, []);

    // Netlab links replace clab-ui's generic Networks palette section inside the
    // Nodes tab. clab-ui does not currently export a per-section replacement
    // prop, so this keeps the DOM patch small and tied to the visible label.
    useEffect(() => {
        const PORTAL_ID = "netlab-links-palette-portal";
        const HIDDEN_ATTR = "data-netlab-hidden-networks-section";
        let active = true;
        let mutationObs: MutationObserver | null = null;

        const hide = (element: Element | null | undefined) => {
            if (!(element instanceof HTMLElement)) return;
            if (element.dataset.netlabHiddenNetworksSection !== "true") {
                element.dataset.netlabHiddenNetworksSection = "true";
            }
            if (element.style.display !== "none") {
                element.style.display = "none";
            }
        };

        const restoreHidden = () => {
            document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}="true"]`).forEach((element) => {
                element.style.display = "";
                delete element.dataset.netlabHiddenNetworksSection;
            });
        };

        const findNetworksHeader = (): HTMLElement | null => {
            const panel = document.querySelector<HTMLElement>("[data-testid='context-panel']");
            if (!panel) return null;
            return Array.from(panel.querySelectorAll<HTMLElement>("div")).find((element) => (
                element.textContent?.trim() === "Networks" &&
                element.nextElementSibling instanceof HTMLElement &&
                element.nextElementSibling.nextElementSibling instanceof HTMLElement
            )) ?? null;
        };

        const inject = () => {
            const header = findNetworksHeader();
            const parent = header?.parentElement;
            if (!active || !header || !parent) {
                setNetlabLinksPaletteContainer((current) => current?.isConnected ? current : null);
                return false;
            }

            let portal = document.getElementById(PORTAL_ID) as HTMLElement | null;
            if (!portal) {
                portal = document.createElement("div");
                portal.id = PORTAL_ID;
                portal.style.cssText = "width:100%;";
            }
            if (portal.parentElement !== parent || portal.nextSibling !== header) {
                parent.insertBefore(portal, header);
            }

            hide(header);
            hide(header.nextElementSibling);
            hide(header.nextElementSibling?.nextElementSibling);
            document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}="true"]`).forEach((element) => {
                if (element !== header && element !== header.nextElementSibling && element !== header.nextElementSibling?.nextElementSibling) {
                    element.style.display = "";
                    delete element.dataset.netlabHiddenNetworksSection;
                }
            });
            setNetlabLinksPaletteContainer(portal);
            return true;
        };

        let pendingFrame = 0;
        const scheduleInject = () => {
            if (pendingFrame) return;
            pendingFrame = requestAnimationFrame(() => {
                pendingFrame = 0;
                inject();
            });
        };

        scheduleInject();
        mutationObs = new MutationObserver(scheduleInject);
        mutationObs.observe(document.body, { childList: true, subtree: true });

        return () => {
            active = false;
            if (pendingFrame) cancelAnimationFrame(pendingFrame);
            mutationObs?.disconnect();
            document.getElementById(PORTAL_ID)?.remove();
            restoreHidden();
            setNetlabLinksPaletteContainer(null);
        };
    }, []);

    // Palette tab ORDER (netlab workflow tabs before YAML/JSON) is handled at the
    // source in clab-ui via patches/@srl-labs+clab-ui+0.3.0.patch — it splices the
    // host's customPaletteTabs in ahead of yaml/json when building visibleTabs.
    // Reordering the rendered DOM from here is intentionally NOT done: MUI Tabs
    // requires DOM child order to match its React children order (it looks up the
    // selected tab by source index and measures children[index] for the indicator,
    // and watches the first/last DOM child for scroll-arrow visibility). Moving
    // nodes desyncs that and lands the indicator under the wrong tab; CSS `order`
    // fixes the indicator but hides the "more tabs" scroll arrow. Fixing it in the
    // component's own render is the only place both stay correct.

    return { portalContainer, navbarPortalContainer, tabBarContainer, leftSidebarToggleContainer, netlabLinksPaletteContainer };
}
