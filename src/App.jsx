import React, { useState, useEffect, useCallback } from 'react';

/* ───────────────────────── Configuratie ───────────────────────── */

const API_URL =
  'https://script.google.com/macros/s/AKfycbx1ZcbZlBbM8j2V1QupIh2ZCvghyDSAwwadnLuhPxN1jmPgnIK5nT7dMNNIa3hNymk/exec';

const REFRESH_MS = 10000;
const SHIFT_SWITCH_HOUR = 12;       // vanaf dit uur wordt PM getoond

const MIN_PER_ROUTE = 7;            // minuten laadtijd per route
const PLAN_OFFSET_MIN = 35;         // de vaste -35 uit de formule (zie toelichting)
const CONFIG_ROW = 1;               // index van sheet-rij 2 (C2 en F2)

const CONFIG_COL = { DOCKS: 2, START: 5 };    // C2 = aantal docks, F2 = starttijd
const ROUTE_COL = 4;                          // E = routemarkering
const ROUTE_MARKER = { AM: 'NIEAM', PM: 'NIEPM' };
const LOADED_COL = { AM: 12, PM: 13 };        // M (AM) / N (PM) = TRUE als geladen
const DOCK_COL = { AM: 13, PM: 15 };          // N (AM) / P (PM) = dock-nummer per bus

const DOCK_IDS = [1, 2, 3, 4];
const DOCK_KEYS = ['1', '2', '3', '4'];
const DOCK_COLORS = { 1: '#38bdf8', 2: '#a78bfa', 3: '#f59e0b', 4: '#2dd4bf' };

const C = {
  bg: '#060a13',
  surface: '#0e1626',
  border: '#1f2b42',
  text: '#f1f5f9',
  muted: '#7b8aa3',
  slate: '#94a3b8',
  sky: '#38bdf8',
  emerald: '#10b981',
  rose: '#f43f5e',
};

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", Consolas, "Liberation Mono", Menlo, monospace';

const SHIFT_LABEL = { AM: 'Ochtend · AM', PM: 'Middag · PM' };

/* ───────────────────────── Helpers ───────────────────────── */

const getActiveShift = (date) => (date.getHours() < SHIFT_SWITCH_HOUR ? 'AM' : 'PM');

const isTrue = (value) =>
  value === true || String(value ?? '').trim().toUpperCase() === 'TRUE';

// "06:00" of "06:00:00" → minuten sinds middernacht. Een Sheets-tijdgetal (fractie van een dag) ook.
function timeToMinutes(value) {
  if (typeof value === 'number') return (value % 1) * 1440;
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseSheet(sheetData, shift) {
  const rows = sheetData?.[shift] ?? [];
  const config = rows[CONFIG_ROW] ?? [];

  // Routes: rijen met de routemarkering in kolom E
  const routeRows = rows.filter((row) =>
    String(row[ROUTE_COL] ?? '').toUpperCase().includes(ROUTE_MARKER[shift])
  );

  // Geladen: routes waarvan de vinkje-kolom TRUE is
  const loadedRoutes = routeRows.filter((row) => isTrue(row[LOADED_COL[shift]])).length;

  // Bussen per laaddock (zoals voorheen)
  const docks = { 1: 0, 2: 0, 3: 0, 4: 0 };
  rows.forEach((row) => {
    const dock = String(row[DOCK_COL[shift]] ?? '').trim();
    if (DOCK_KEYS.includes(dock)) docks[dock]++;
  });

  return {
    routes: routeRows.length,
    loadedRoutes,
    docks,
    dockCount: parseInt(String(config[CONFIG_COL.DOCKS] ?? '').trim(), 10),
    startMin: timeToMinutes(config[CONFIG_COL.START]),
  };
}

// Berekening van voorsprong of vertraging
//  - Geplande duur  = (routes / docks) × 7 − 35            (vanaf F2)
//  - Beschikbaar    = (F2 + geplande duur) − nu            (minuten)
//  - Nog nodig      = ((routes − geladen) / docks) × 7     (minuten)
//  - Vertraging     = nog nodig − beschikbaar  (> 0 = achter, ≤ 0 = voor)
function calculateStatus({ routes, loadedRoutes, dockCount, startMin }, nowMin) {
  if (!(dockCount >= 1) || startMin === null) return null;

  const plannedDuration = (routes / dockCount) * MIN_PER_ROUTE - PLAN_OFFSET_MIN;
  const plannedEnd = startMin + plannedDuration;
  const available = plannedEnd - nowMin;

  const remainingRoutes = Math.max(0, routes - loadedRoutes);
  const remainingNeeded = (remainingRoutes / dockCount) * MIN_PER_ROUTE;

  return {
    delay: remainingNeeded - available,
    available,
    remainingNeeded,
  };
}

// Conventie uit je oorspronkelijke code: '-' = voorsprong, '+' = vertraging
function formatDelay(minutes) {
  const rounded = Math.round(minutes);
  const abs = Math.abs(rounded);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${rounded > 0 ? '+' : '-'}${hh}:${mm}`;
}

const fmtMin = (minutes) => `${Math.round(minutes)} min`;

const fmtTime = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ───────────────────────── Onderdelen ───────────────────────── */

function GlobalStyles() {
  return (
    <style>{`
      html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; background: ${C.bg}; overflow: hidden; }
      @keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.55); } 70% { box-shadow: 0 0 0 10px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      .fade-up { animation: fadeUp .45s ease both; }
      .live-dot { animation: ping 1.8s infinite; }
      .spin { animation: spin 1s linear infinite; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      @media (prefers-reduced-motion: reduce) {
        .fade-up, .live-dot, .spin { animation: none; }
      }
    `}</style>
  );
}

function KpiCard({ label, value, sub, color = C.text, tone = 'default' }) {
  const background =
    tone === 'ahead' ? 'linear-gradient(180deg, rgba(16,185,129,.14), rgba(16,185,129,.03))'
    : tone === 'behind' ? 'linear-gradient(180deg, rgba(244,63,94,.16), rgba(244,63,94,.03))'
    : C.surface;
  const borderColor =
    tone === 'ahead' ? 'rgba(16,185,129,.4)'
    : tone === 'behind' ? 'rgba(244,63,94,.45)'
    : C.border;

  return (
    <div className="fade-up" style={{
      background, border: `1px solid ${borderColor}`, borderRadius: 18,
      padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: '0 10px 28px rgba(0,0,0,.3)', minWidth: 0,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: C.muted }}>
        {label}
      </div>
      <div style={{
        fontSize: 48, fontWeight: 900, lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums', fontFamily: tone === 'default' ? FONT : MONO,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: C.muted }}>{sub}</div>
    </div>
  );
}

// Elke kaart schaalt mee met zijn eigen grootte (container query units)
function DockCard({ id, count, share, active, index }) {
  const color = DOCK_COLORS[id];

  return (
    <article className="fade-up" style={{
      animationDelay: `${index * 60}ms`,
      containerType: 'size',
      background: C.surface, border: `1px solid ${C.border}`, borderTop: `4px solid ${color}`,
      borderRadius: 18, boxShadow: '0 10px 28px rgba(0,0,0,.35)',
      minHeight: 0, minWidth: 0, overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', boxSizing: 'border-box', padding: '4cqh 5cqw',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '2cqh',
      }}>
        {/* Bovenste rij: naam + status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2cqw', flex: 'none' }}>
          <span style={{
            fontSize: 'min(5cqh, 2.4cqw)', fontWeight: 800, letterSpacing: 1.5,
            textTransform: 'uppercase', color: C.text, whiteSpace: 'nowrap',
          }}>
            Laaddock {id}
          </span>
          <span style={{
            fontSize: 'min(4cqh, 1.8cqw)', fontWeight: 800, letterSpacing: 1,
            padding: '0.35em 0.85em', borderRadius: 999, whiteSpace: 'nowrap',
            color: active ? color : C.muted,
            background: active ? `${color}1f` : 'rgba(123,138,163,.12)',
          }}>
            {active ? 'ACTIEF' : 'INACTIEF'}
          </span>
        </div>

        {/* Midden: het aantal */}
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '1cqh',
        }}>
          <div style={{
            fontSize: 'min(36cqh, 28cqw)', fontWeight: 900, lineHeight: 1,
            color, fontVariantNumeric: 'tabular-nums',
          }}>
            {count}
          </div>
          <div style={{
            fontSize: 'min(4.2cqh, 1.9cqw)', fontWeight: 700, letterSpacing: 1.5,
            textTransform: 'uppercase', color: C.muted,
          }}>
            Bussen geladen
          </div>
        </div>

        {/* Onderkant: aandeel */}
        <div style={{ flex: 'none' }}>
          <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,.12)', overflow: 'hidden' }}>
            <div style={{
              width: `${share}%`, height: '100%', background: color,
              borderRadius: 'inherit', transition: 'width .6s ease',
            }} />
          </div>
          <div style={{
            marginTop: 8, fontSize: 'min(4cqh, 1.8cqw)', color: C.muted,
            textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          }}>
            {share}% van totaal
          </div>
        </div>
      </div>
    </article>
  );
}

function SectionTitle({ title, color, aside }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.text }}>
          {title}
        </h2>
      </div>
      {aside && <span style={{ fontSize: 14, color: C.muted }}>{aside}</span>}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: C.muted }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, fontWeight: 600, letterSpacing: 1 }}>
        <span className="spin" style={{
          width: 22, height: 22, borderRadius: '50%',
          border: `2px solid ${C.border}`, borderTopColor: C.sky,
        }} />
        GEGEVENS LADEN…
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.rose}`, borderRadius: 18,
        padding: 48, maxWidth: 560, textAlign: 'center',
      }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.rose, marginBottom: 12 }}>Verbindingsfout</div>
        <p style={{ color: C.slate, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
          {message}
          <br />
          Controleer de Google Apps Script-deployment en de toegang tot de spreadsheet.
        </p>
        <button onClick={onRetry} style={{
          background: C.rose, color: '#fff', border: 'none', padding: '12px 26px',
          borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: FONT,
        }}>
          Probeer opnieuw
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Hoofdcomponent ───────────────────────── */

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`Fout bij ophalen (${res.status}).`);

      const sheetData = await res.json();
      if (!sheetData || typeof sheetData !== 'object') {
        throw new Error('Onverwacht dataformaat ontvangen.');
      }

      const shift = getActiveShift(new Date());
      setData({ shift, ...parseSheet(sheetData, shift) });
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
      setError(err.message || 'Verbinding met de spreadsheet mislukt.');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const dataTimer = setInterval(fetchData, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [fetchData]);

  const loaded = data !== null;
  const shift = data?.shift ?? getActiveShift(now);
  const routes = data?.routes ?? 0;
  const docks = data?.docks ?? { 1: 0, 2: 0, 3: 0, 4: 0 };
  const totalLoaded = DOCK_IDS.reduce((sum, id) => sum + docks[id], 0);

  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const status = data ? calculateStatus(data, nowMin) : null;
  const isBehind = status !== null && status.delay > 0;

  const connection = error ? 'error' : loaded ? 'live' : 'loading';
  const connectionStyle = {
    live:    { color: C.emerald, border: C.border, bg: 'rgba(16,185,129,.06)', label: 'LIVE' },
    loading: { color: C.sky,     border: C.border, bg: 'rgba(56,189,248,.06)', label: 'VERBINDEN…' },
    error:   { color: C.rose,    border: C.rose,   bg: 'rgba(244,63,94,.08)',  label: 'VERBINDING VERSTOORD' },
  }[connection];

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: `radial-gradient(1400px 700px at 10% -10%, #0d1d33 0%, ${C.bg} 60%)`,
      color: C.text, fontFamily: FONT, overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <GlobalStyles />

      {/* Header */}
      <header style={{
        flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 20, padding: '1.8vh 40px', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.sky}, #0284c7)`,
            display: 'grid', placeItems: 'center', boxShadow: '0 8px 24px rgba(56,189,248,.25)',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#041320" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.2, color: C.sky, textTransform: 'uppercase' }}>
              Laaddocks · Live
            </div>
            <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 800, letterSpacing: -0.5, color: '#fff' }}>
              Laaddock Overzicht
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {/* Klok */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 6, textTransform: 'capitalize' }}>
              {now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>

          {/* Verbindingsstatus */}
          <div role="status" aria-live="polite" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 999,
            border: `1px solid ${connectionStyle.border}`, background: connectionStyle.bg,
            color: connectionStyle.color, fontSize: 13, fontWeight: 800, letterSpacing: 1,
          }}>
            <span className="live-dot" style={{ width: 9, height: 9, borderRadius: '50%', background: connectionStyle.color }} />
            {connectionStyle.label}
          </div>
        </div>
      </header>

      {/* Inhoud */}
      {!loaded && !error && <LoadingState />}
      {!loaded && error && <ErrorState message={error} onRetry={fetchData} />}

      {loaded && (
        <main style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '2vh',
          padding: '2.5vh 40px 2vh',
        }}>
          {/* KPI-rij */}
          <section style={{
            flex: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20,
          }}>
            <KpiCard label="Totaal routes" value={routes} sub={`Huidige ${SHIFT_LABEL[shift]}`} />
            <KpiCard label="Totaal geladen" value={totalLoaded} sub="Over alle laaddocks" color={C.sky} />
            <KpiCard
              label={!status ? 'Voorsprong / vertraging' : isBehind ? 'Vertraging' : 'Voorsprong'}
              value={status ? formatDelay(status.delay) : '–'}
              sub={status
                ? `Nog nodig ${fmtMin(status.remainingNeeded)} · beschikbaar ${fmtMin(status.available)}`
                : 'Controleer C2 en F2 in de sheet'}
              color={!status ? C.muted : isBehind ? C.rose : C.emerald}
              tone={!status ? 'default' : isBehind ? 'behind' : 'ahead'}
            />
          </section>

          {/* Laaddocks */}
          <SectionTitle
            title="Laaddocks"
            color={C.sky}
            aside={`${DOCK_IDS.length} docks · ververst elke ${REFRESH_MS / 1000} seconden`}
          />

          <section style={{
            flex: 1, minHeight: 0, display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: 20,
          }}>
            {DOCK_IDS.map((id, index) => {
              const count = docks[id];
              const share = totalLoaded ? Math.round((count / totalLoaded) * 100) : 0;
              return (
                <DockCard
                  key={id}
                  id={id}
                  count={count}
                  share={share}
                  active={count > 0}
                  index={index}
                />
              );
            })}
          </section>
        </main>
      )}

      {/* Footer */}
      <footer style={{
        flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12, padding: '10px 40px', borderTop: `1px solid ${C.border}`,
        fontSize: 13, color: C.muted,
      }}>
        <span>
          Laatst bijgewerkt:{' '}
          <strong style={{ color: C.slate, fontVariantNumeric: 'tabular-nums' }}>
            {lastUpdate ? fmtTime(lastUpdate) : '—'}
          </strong>
        </span>
        {error && loaded && (
          <span style={{ color: C.rose, fontWeight: 600 }}>
            Verbindingsprobleem: laatst bekende gegevens worden getoond
          </span>
        )}
      </footer>
    </div>
  );
}