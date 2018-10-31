import { IRoute, IRouterComponent, RouterComponentEventKind, RouterEventKind } from "./model";
import { Router } from "./router";
import { isClass } from "./util";

const template = document.createElement("template");
template.innerHTML = `<slot></slot>`;

export class RouterComponent extends HTMLElement implements IRouterComponent {

	/**
	 * The parent router.
	 * Is REQUIRED if this router is a child.
	 * When set, the relevant listeners are added or teared down because they depend on the parent.
	 */
	_parentRouter: IRouterComponent | null | undefined;
	set parentRouter (value: IRouterComponent | null | undefined) {
		this.tearDownListeners();
		this._parentRouter = value;
		this.hookUpListeners();
	}

	get parentRouter () {
		return this._parentRouter;
	}

	/**
	 * Whether the router is a child router.
	 */
	get isChildRouter () {
		return this.parentRouter != null;
	}

	/**
	 * Contains the available routes.
	 */
	private routes: IRoute[] = [];

	/**
	 * The current route.
	 */
	private currentRoute: IRoute | null;

	constructor () {
		super();

		this.onPathChanged = this.onPathChanged.bind(this);

		// Attach the template
		const shadow = this.attachShadow({mode: "open"});
		shadow.appendChild(template.content.cloneNode(true));
	}

	/**
	 * Remove event listeners and clean up.
	 */
	disconnectedCallback () {
		this.tearDownListeners();
	}

	/**
	 * Sets up the routes.
	 * @param {IRoute[]} routes
	 * @param parentRouter
	 * @param {boolean} navigate
	 * @returns {Promise<void>}
	 */
	async setup (routes: IRoute[], parentRouter?: RouterComponent | null, navigate = true) {

		// Clean up the current routes
		await this.clearRoutes();

		// Add the routes to the array
		this.routes = routes;

		// Store the reference to the parent router.
		this.parentRouter = parentRouter;

		// Register that the path has changed so the correct route can be loaded.
		if (navigate) {
			await this.onPathChanged();
		}
	}

	/**
	 * Removes all routes.
	 */
	async clearRoutes () {
		this.routes.length = 0;
	}

	/**
	 * Hook up listeners to either the window or the parent router.
	 */
	private hookUpListeners () {
		if (this.isChildRouter) {
			this.parentRouter!.addEventListener(RouterComponentEventKind.DidChangeRoute, this.onPathChanged);

		} else {
			Router.addEventListener(RouterEventKind.PopState, this.onPathChanged);
			Router.addEventListener(RouterEventKind.OnPushState, this.onPathChanged);
		}
	}

	/**
	 * Tear down the listeners from either the window or the parent router.
	 */
	private tearDownListeners () {
		if (this.isChildRouter) {
			this.parentRouter!.removeEventListener(RouterComponentEventKind.DidChangeRoute, this.onPathChanged);
		}

		Router.removeEventListener(RouterEventKind.PopState, this.onPathChanged);
		Router.removeEventListener(RouterEventKind.OnPushState, this.onPathChanged);
	}

	/**
	 * Each time the path changes, load the new path.
	 * Prevents the event from continuing down the router tree if a navigation was made.
	 * @private
	 */
	private async onPathChanged () {
		await this.loadPath(Router.currentPath);
	}

	/**
	 * Matches the first route that matches the given path.
	 * @private
	 */
	private matchRoute (path: string): IRoute | null {
		for (const route of this.routes) {

			// We need to treat empty paths a bit different because an empty string matches every path.
			const matchPath = route.path === "" ? /^$/ : route.path;
			if (path.match(matchPath) != null) {
				return route;
			}
		}

		return null;
	}

	/**
	 * Loads a new path based on the routes.
	 * Returns true if a navigation was made to a new page.
	 * @private
	 */
	private async loadPath (path: string): Promise<boolean> {

		// Find the corresponding route.
		const route = this.matchRoute(path);

		// Ensure that a route was found.
		if (route == null) {
			throw new Error(`No routes matches the path '${path}'.`);
		}

		// Check whether the component or redirectTo is specified (and that both are not specified)
		if (route.component == null && route.redirectTo == null && !(route.component != null && route.redirectTo != null)) {
			throw new Error(`The route ´${route.path}´ needs to have either a component or a redirectTo set (and not both).`);
		}

		try {

			// Check whether the guards allows us to go to the new route.
			if (route.guards != null) {
				// @ts-ignore
				for (const guard of route.guards) {
					if (!guard(this, route)) {
						// Dispatch globally that a navigation was cancelled.
						Router.dispatchEvent(RouterEventKind.NavigationCancel, route);
						return false;
					}
				}
			}

			// Only change route if its a new route.
			const navigate = (this.currentRoute !== route);
			if (navigate) {

				// Dispatch globally that a navigation has started.
				Router.dispatchEvent(RouterEventKind.NavigationStart, route);

				// Redirect if nessesary
				if (route.redirectTo != null) {
					Router.replaceState(null, null, route.redirectTo);
					return false;
				}

				// If the component provided is a function (and not a class) call the function to get the promise.
				let component = route.component;
				if (component instanceof Function && !isClass(component)) {
					component = route.component();
				}

				let module = await Promise.resolve(component);
				const page = module.default ? (new module.default()) : new module();
				page.parentRouter = this;

				if (this.childNodes.length > 0) {
					const previousPage = this.childNodes[0];
					this.removeChild(previousPage);
				}

				this.appendChild(page);
				this.currentRoute = route;
			}

			// Scroll to the top of the new page if nessesary.
			// Scrolling to the top is the default behavior.
			if (route.scrollToTop == null || route.scrollToTop) {
				window.scrollTo(0, 0);
			}

			// Always dispatch the did change route event to notify the children that something happened.
			// This is because the child routes might have to change routes further down the tree.
			this.dispatchDidChangeRouteEvent(route);

			// Dispatch globally that a navigation has ended.
			if (navigate) {
				Router.dispatchEvent(RouterEventKind.NavigationEnd, route);
			}

			return navigate;

		} catch (e) {
			Router.dispatchEvent(RouterEventKind.NavigationError, route);
			throw e;
		}
	}

	/**
	 * Dispatches a did change route event.
	 * @param {IRoute} route
	 */
	private dispatchDidChangeRouteEvent (route: IRoute) {
		this.dispatchEvent(new CustomEvent(RouterComponentEventKind.DidChangeRoute, {
			detail: {
				route
			}
		}));
	}
}

window.customElements.define("router-component", RouterComponent);