import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bullet } from "@/components/ui/bullet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/AuthContext";
import { useAsync } from "@/lib/useAsync";
import { api } from "@/api/client";
import type { AuditLog } from "@/types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Colour dot by outcome — errors red, writes amber, reads/normal blue-ish. */
function statusColor(log: AuditLog): string {
  const code = log.status_code ?? 0;
  if (code >= 500) return "bg-destructive";
  if (code >= 400) return "bg-warning";
  const method = (log.method ?? "").toUpperCase();
  if (method === "DELETE") return "bg-destructive";
  if (method === "POST" || method === "PUT" || method === "PATCH") return "bg-success";
  return "bg-primary";
}

/** Human-friendly action label, e.g. "user.login" -> "User Login". */
function summarize(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Right-rail activity feed backed by the real audit log. Only rendered for users
 * who may see System Logs (admins); returns null otherwise so the rail collapses
 * to just the clock widget.
 */
export default function RecentActivity() {
  const { canAccess } = useAuth();
  const allowed = canAccess("logs");

  const logs = useAsync(
    () => (allowed ? api.auditLogs({ limit: 8, offset: 0 }) : Promise.resolve({ rows: [], total: 0, limit: 8, offset: 0 })),
    [allowed],
  );

  if (!allowed) return null;

  const rows = logs.data?.rows ?? [];

  return (
    <Card className="w-full">
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2.5">
          <Bullet />
          Recent Activity
        </CardTitle>
        {logs.data && (
          <Badge variant="secondary" className="bg-accent text-xs">
            {logs.data.total}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
        {logs.loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground uppercase">Loading…</p>
        ) : logs.error ? (
          <p className="py-6 text-center text-xs text-destructive">{logs.error}</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground uppercase">No recent activity</p>
        ) : (
          rows.map((log) => (
            <div
              key={log.id}
              className="group flex items-start gap-3 rounded-lg border border-border/40 bg-background/50 p-3 transition-all hover:border-border"
            >
              <div className={cn("mt-1.5 size-2 shrink-0 rounded-full", statusColor(log))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="truncate text-sm font-medium">{summarize(log.action)}</h4>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(log.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {log.user_email ?? "system"}
                  {log.path ? ` · ${log.method ?? ""} ${log.path}` : ""}
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
