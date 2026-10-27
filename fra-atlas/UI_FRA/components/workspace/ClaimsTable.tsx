"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { WorkspaceClaim } from "./types";

interface Props {
  claims: WorkspaceClaim[];
  onZoom: (claim: WorkspaceClaim) => void;
  onEdit: (claim: WorkspaceClaim) => void;
  onDeleted: (ids: Array<number | string>) => void;
}

export default function ClaimsTable({ claims, onZoom, onEdit, onDeleted }: Props) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return claims
      .filter((c) => {
        if (statusFilter !== "all" && c.status !== statusFilter) return false;
        if (!s) return true;
        return (
          (c.village || "").toLowerCase().includes(s) ||
          (c.patta_holder || "").toLowerCase().includes(s) ||
          (c.district || "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [claims, q, statusFilter]);

  function toggle(id: number | string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function deleteOne(id: number | string) {
    if (!confirm(`Delete claim ${id}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteClaim(id);
      onDeleted([id]);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      alert("Delete failed: " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected claim(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.bulkDeleteClaims(ids);
      onDeleted(ids);
      setSelected(new Set());
    } catch (err: any) {
      alert("Bulk delete failed: " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search village / holder / district" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Granted">Granted</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing <strong>{filtered.length}</strong> of <strong>{claims.length}</strong>
          </span>
          <Button size="sm" variant="destructive" disabled={selected.size === 0 || busy} onClick={deleteSelected}>
            {busy ? "Working..." : `Delete selected (${selected.size})`}
          </Button>
        </div>
      </div>

      <div className="border rounded-lg max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((c) => c.id)) : new Set())}
                />
              </TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Village</TableHead>
              <TableHead>Holder</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => {
              const hasCoords = c.lat != null && c.lon != null;
              return (
                <TableRow key={c.id} className="cursor-pointer" onDoubleClick={() => onZoom(c)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </TableCell>
                  <TableCell>{c.id}</TableCell>
                  <TableCell>
                    {c.village || "—"}
                    <div className="text-xs text-muted-foreground">{c.district || ""}</div>
                  </TableCell>
                  <TableCell>{c.patta_holder || "—"}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        c.status === "Granted"
                          ? "bg-green-100 text-green-800"
                          : c.status === "Rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                      }
                    >
                      {c.status || "—"}
                    </Badge>
                    {!hasCoords && <div className="text-xs text-muted-foreground mt-1">No coords</div>}
                  </TableCell>
                  <TableCell>{c.date || "—"}</TableCell>
                  <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => onEdit(c)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" disabled={!hasCoords} onClick={() => onZoom(c)}>
                      Zoom
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteOne(c.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No claims match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
