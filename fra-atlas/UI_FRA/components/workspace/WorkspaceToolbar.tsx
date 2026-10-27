"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATE_OPTIONS } from "./types";

interface Props {
  onNewClaim: () => void;
  onReset: () => void;
  showGranted: boolean;
  onToggleGranted: () => void;
  showPending: boolean;
  onTogglePending: () => void;
  stateSel: string;
  onChangeState: (v: string) => void;
  districtOptions: string[];
  districtSel: string;
  onChangeDistrict: (v: string) => void;
  villageOptions: string[];
  villageSel: string;
  onChangeVillage: (v: string) => void;
}

export default function WorkspaceToolbar({
  onNewClaim,
  onReset,
  showGranted,
  onToggleGranted,
  showPending,
  onTogglePending,
  stateSel,
  onChangeState,
  districtOptions,
  districtSel,
  onChangeDistrict,
  villageOptions,
  villageSel,
  onChangeVillage,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg shadow-sm p-3">
      <Select value={stateSel || "__all"} onValueChange={(v) => onChangeState(v === "__all" ? "" : v)}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All states</SelectItem>
          {STATE_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={districtSel || "__all"} onValueChange={(v) => onChangeDistrict(v === "__all" ? "" : v)} disabled={!stateSel}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder={stateSel ? "District" : "Select state first"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All districts</SelectItem>
          {districtOptions.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={villageSel || "__all"} onValueChange={(v) => onChangeVillage(v === "__all" ? "" : v)} disabled={!districtSel}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder={districtSel ? "Village" : "Select district first"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All villages</SelectItem>
          {villageOptions.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 ml-2">
        <button
          type="button"
          onClick={onToggleGranted}
          className={`px-3 py-1 rounded-full text-sm font-medium border ${
            showGranted ? "bg-green-100 text-green-800 border-green-300" : "bg-gray-100 text-gray-400 border-gray-200"
          }`}
        >
          Granted
        </button>
        <button
          type="button"
          onClick={onTogglePending}
          className={`px-3 py-1 rounded-full text-sm font-medium border ${
            showPending ? "bg-red-100 text-red-800 border-red-300" : "bg-gray-100 text-gray-400 border-gray-200"
          }`}
        >
          Pending
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" onClick={onReset}>
          Reset View
        </Button>
        <Button onClick={onNewClaim} className="bg-gov-green hover:bg-gov-green/90">
          New FRA Claim
        </Button>
      </div>
    </div>
  );
}
