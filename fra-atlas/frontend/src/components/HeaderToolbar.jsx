// src/components/HeaderToolbar.jsx
import React from "react";

export default function HeaderToolbar(props) {
  const {
    onNewClaim,
    onReset,
    // kept for compatibility (not rendered as checkboxes anymore)
    showStates,
    setShowStates,
    showDistricts,
    setShowDistricts,
    showVillages,
    setShowVillages,

    // claim status chips
    showGranted,
    setShowGranted,
    showPending,
    setShowPending,

    // view/breadcrumb
    viewMode,
    selectedStateFeature,
    selectedDistrictFeature,
    onBackToState,
    onBackToDistrict,

    // new user props
    currentUser,
    onLogout,

    // NEW: cascading filter props
    stateOptions = [],              // string[]
    selectedStateValue = "",        // string
    onChangeState = () => {},
    districtOptions = [],           // string[]
    selectedDistrictValue = "",     // string
    onChangeDistrict = () => {},
    villageOptions = [],            // string[]
    selectedVillageValue = "",      // string
    onChangeVillage = () => {},
  } = props;

  function getStateLabel(f) {
    if (!f) return "";
    return (
      f?.properties?.STATE ||
      f?.properties?.NAME_1 ||
      f?.properties?.st_name ||
      f?.properties?.name ||
      ""
    );
  }

  function handleImgError(e) {
    console.warn("Logo failed to load:", e.currentTarget.src);
    e.currentTarget.style.display = "none";
  }

  const userDisplayName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.username ||
    currentUser?.email ||
    null;

  return (
    <header className="header-bar w-full">
      {/* Top row with logos (left), centered title, action buttons (right) */}
      <div className="header-inner max-w-full mx-auto px-4 py-3 relative flex items-center justify-between">
        {/* LEFT: Logos */}
        <div className="header-left flex items-center gap-3">
          <img
            src="/logos/ministry.png"
            alt="Ministry of Tribal Affairs"
            onError={handleImgError}
            className="org-logo mota-logo"
          />
          <img
            src="/logos/navic.png"
            alt="NavIC"
            onError={handleImgError}
            className="org-logo navic-logo"
          />
        </div>

        {/* CENTER: Absolutely centered FRA Atlas */}
        <div className="header-center absolute left-0 right-0 pointer-events-none text-center">
          <div className="site-title inline-block pointer-events-none">
            <div className="text-xl font-bold text-gray-800 tracking-tight">
              FRA Atlas
            </div>
          </div>
        </div>

        {/* RIGHT: Action buttons + user area */}
        <div className="header-right flex items-center gap-3 ml-auto">
          <button
            onClick={onNewClaim}
            className="btn-primary px-4 py-2 rounded-lg shadow"
            aria-label="New FRA Claim"
          >
            New FRA Claim
          </button>

          <button
            onClick={onReset}
            className="btn-reset px-4 py-2 rounded-lg border"
            aria-label="Reset View"
          >
            Reset View
          </button>

          {/* NEW: user name + logout (small, right-aligned) */}
          <div className="ml-4 flex items-center space-x-3">
            {userDisplayName ? (
              <>
                <div className="text-sm font-medium text-gray-800">
                  <span className="sr-only">Signed in as</span>
                  Welcome,{" "}
                  <span className="font-semibold">
                    {userDisplayName}
                  </span>
                  {currentUser?.role ? (
                    <span className="text-xs text-gray-500 ml-2">({currentUser.role})</span>
                  ) : null}
                </div>

                <button
                  onClick={onLogout}
                  className="px-3 py-1 border rounded hover:bg-gray-100 text-sm"
                  title="Logout"
                  aria-label="Logout"
                  type="button"
                >
                  Logout
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom controls row */}
      <div className="controls-row max-w-full mx-auto px-6 py-3">
        <div className="flex items-center flex-wrap gap-4">
          {/* === NEW: Cascading Filters (left of Granted/Pending) === */}
          <div className="flex items-center gap-2">
            {/* State */}
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedStateValue}
              onChange={(e) => onChangeState(e.target.value)}
              title="Select State"
              aria-label="Select State"
            >
              <option value="">State</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* District */}
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedDistrictValue}
              onChange={(e) => onChangeDistrict(e.target.value)}
              title="Select District"
              aria-label="Select District"
              disabled={!selectedStateValue || districtOptions.length === 0}
            >
              <option value="">{selectedStateValue ? "District" : "Select state first"}</option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {/* Village */}
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedVillageValue}
              onChange={(e) => onChangeVillage(e.target.value)}
              title="Select Village"
              aria-label="Select Village"
              disabled={!selectedDistrictValue || villageOptions.length === 0}
            >
              <option value="">
                {selectedDistrictValue ? "Village" : "Select district first"}
              </option>
              {villageOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Granted / Pending pills (unchanged appearance; now toggle) */}
          <div className="flex items-center gap-2 ml-4">
            <button
              type="button"
              className={`status-pill granted ${showGranted ? "" : "opacity-50"}`}
              onClick={() => setShowGranted(!showGranted)}
              aria-pressed={showGranted}
              aria-label="Toggle Granted"
              title="Toggle Granted"
            >
              Granted
            </button>
            <button
              type="button"
              className={`status-pill pending ${showPending ? "" : "opacity-50"}`}
              onClick={() => setShowPending(!showPending)}
              aria-pressed={showPending}
              aria-label="Toggle Pending"
              title="Toggle Pending"
            >
              Pending
            </button>
          </div>

          {/* Right-aligned Level indicator */}
          <div className="ml-auto text-sm text-gray-600">
            Level: {viewMode}
          </div>
        </div>
      </div>
    </header>
  );
}
