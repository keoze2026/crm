import { Outlet } from "react-router-dom";
import { type ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { MobileHeader } from "@/components/dashboard/mobile-header";
import Widget from "@/components/dashboard/widget";
import RecentActivity from "@/components/dashboard/recent-activity";

/**
 * App shell — ported from the dashboard-m-o-n-k-y template.
 * 12-column grid: sidebar (2) · main content (7) · right rail (3).
 * The sidebar renders as a mobile Sheet (via SidebarProvider) below `lg`.
 */
export default function Layout() {
  return (
    <SidebarProvider>
      <MobileHeader />

      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-gap lg:px-sides">
        {/* Sidebar (desktop inline; mobile Sheet is portaled out of this hidden wrapper) */}
        <div className="hidden lg:block col-span-2 top-0 relative">
          <DashboardSidebar />
        </div>

        {/* Main content */}
        <div className="col-span-1 lg:col-span-7 min-w-0">
          <Outlet />
        </div>

        {/* Right rail */}
        <div className="col-span-3 hidden lg:block">
          <div className="space-y-gap py-sides min-h-screen max-h-screen sticky top-0 overflow-clip">
            <Widget />
            <RecentActivity />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Shared page header used across pages (kept from the original layout API). */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
