import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import MonkeyIcon from "@/components/icons/monkey";
import BellIcon from "@/components/icons/bell";
import RecentActivity from "@/components/dashboard/recent-activity";
import { useAuth } from "@/auth/AuthContext";

export function MobileHeader() {
  const { canAccess } = useAuth();
  const showActivity = canAccess("logs");

  return (
    <div className="lg:hidden h-header-mobile sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <SidebarTrigger />

        <div className="flex items-center gap-2">
          <div className="h-8 w-16 bg-primary rounded flex items-center justify-center">
            <MonkeyIcon className="size-6 text-primary-foreground" />
          </div>
        </div>

        {showActivity ? (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" size="icon" className="relative" aria-label="Recent activity">
                <BellIcon className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] max-w-md p-3 overflow-y-auto">
              <SheetTitle className="sr-only">Recent Activity</SheetTitle>
              <RecentActivity />
            </SheetContent>
          </Sheet>
        ) : (
          <div className="size-9" />
        )}
      </div>
    </div>
  );
}
