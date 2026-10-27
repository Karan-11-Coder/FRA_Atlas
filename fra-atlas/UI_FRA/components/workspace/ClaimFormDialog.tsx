"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import type { WorkspaceClaim } from "./types";

interface Props {
  open: boolean;
  editClaim: WorkspaceClaim | null;
  prefillCoords: { lat: number; lon: number } | null;
  pickOnMap: boolean;
  onTogglePick: (v: boolean) => void;
  onClose: () => void;
  onSaved: (claim: WorkspaceClaim) => void;
}

const emptyForm = {
  state: "",
  district: "",
  block: "",
  village: "",
  patta_holder: "",
  address: "",
  land_area: "",
  status: "Pending",
  date: new Date().toISOString().slice(0, 10),
  lat: "",
  lon: "",
};

function safeNumber(v: string): number | null {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export default function ClaimFormDialog({ open, editClaim, prefillCoords, pickOnMap, onTogglePick, onClose, onSaved }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editClaim) {
      setForm({
        state: editClaim.state || "",
        district: editClaim.district || "",
        block: editClaim.block || "",
        village: editClaim.village || "",
        patta_holder: editClaim.patta_holder || "",
        address: editClaim.address || "",
        land_area: Number.isFinite(Number(editClaim.land_area)) ? String(editClaim.land_area) : "",
        status: editClaim.status || "Pending",
        date: editClaim.date || new Date().toISOString().slice(0, 10),
        lat: editClaim.lat != null ? String(editClaim.lat) : "",
        lon: editClaim.lon != null ? String(editClaim.lon) : "",
      });
    } else {
      setForm((f) => ({
        ...emptyForm,
        lat: prefillCoords ? String(prefillCoords.lat) : f.lat,
        lon: prefillCoords ? String(prefillCoords.lon) : f.lon,
      }));
    }
    setError("");
  }, [open, editClaim, prefillCoords]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.state || !form.district || !form.village) {
      setError("Please fill State, District and Village.");
      return;
    }
    if (form.lat === "" || form.lon === "") {
      setError("Please provide coordinates (type them or pick on map).");
      return;
    }

    const payload = {
      state: form.state,
      district: form.district,
      block: form.block || null,
      village: form.village,
      patta_holder: form.patta_holder || null,
      address: form.address || null,
      land_area: safeNumber(form.land_area),
      status: form.status,
      date: form.date,
      lat: safeNumber(form.lat),
      lon: safeNumber(form.lon),
    };

    setSaving(true);
    setError("");
    try {
      let saved: WorkspaceClaim;
      if (editClaim?.id != null) {
        saved = await api.updateClaim(editClaim.id, payload);
      } else {
        const res = await api.createClaim(payload);
        saved = res.claim;
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editClaim ? `Edit Claim #${editClaim.id}` : "New FRA Claim"}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-2">
          <Checkbox id="pick-on-map" checked={pickOnMap} onCheckedChange={(v) => onTogglePick(!!v)} />
          <Label htmlFor="pick-on-map" className="text-sm cursor-pointer">
            Pick coordinates on map instead
          </Label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => update("state", e.target.value)} required />
              </div>
              <div>
                <Label>District</Label>
                <Input value={form.district} onChange={(e) => update("district", e.target.value)} required />
              </div>
              <div>
                <Label>Block</Label>
                <Input value={form.block} onChange={(e) => update("block", e.target.value)} />
              </div>
              <div>
                <Label>Village</Label>
                <Input value={form.village} onChange={(e) => update("village", e.target.value)} required />
              </div>
              <div>
                <Label>Patta Holder</Label>
                <Input value={form.patta_holder} onChange={(e) => update("patta_holder", e.target.value)} />
              </div>
              <div>
                <Label>Land Area (ha)</Label>
                <Input value={form.land_area} onChange={(e) => update("land_area", e.target.value)} placeholder="e.g. 1.5" />
              </div>
              <div className="col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => update("address", e.target.value)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => update("status", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Granted">Granted</SelectItem>
                    <SelectItem value="Rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
              </div>
              <div>
                <Label>Latitude</Label>
                <Input value={form.lat} onChange={(e) => update("lat", e.target.value)} />
              </div>
              <div>
                <Label>Longitude</Label>
                <Input value={form.lon} onChange={(e) => update("lon", e.target.value)} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="bg-gov-green hover:bg-gov-green/90">
                {saving ? "Saving..." : editClaim ? "Save changes" : "Save Claim"}
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  );
}
