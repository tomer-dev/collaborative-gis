import { createRootRoute, Outlet } from '@tanstack/react-router';

// Minimal root so the router plugin can generate routeTree.gen.ts; M1 T9 adds context and layout.
export const Route = createRootRoute({ component: Outlet });
