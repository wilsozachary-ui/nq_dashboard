import { useEffect, useMemo, useState } from 'react';
import { getMonthlyPnL } from '../api/pnlApi';
import {
  isPracticeAccountName,
  useSelectedAccounts,
  useTestBotSnapshot,
} from './morningStrategyShared';
import './DobermanLounge.css';

const CHICAGO_TIME_ZONE = 'America/Chicago';

export function getDobermanState({ isArmed, dailyPnl }) {
  const pnl = typeof dailyPnl === 'number' && Number.isFinite(dailyPnl) ? dailyPnl : 0;
  if (pnl > 0) return 'celebrate';
  if (pnl < 0) return 'lose';
  return isArmed ? 'run' : 'sit';
}

export function isDobermanArmed(snapshot = {}) {
  if (snapshot._snapshotMeta?.stale) return false;
  const status = snapshot.status || 'OFF';
  return Boolean(snapshot.armed) || status === 'ARMED' || status === 'ACTIVE';
}

export function chicagoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function accountIdOf(account) {
  return account?.account_id ?? account?.accountId ?? account?.id;
}

function accountNameOf(account) {
  return account?.account_name ?? account?.accountName ?? account?.name;
}

export function aggregateSelectedDailyRealizedPnl({ rows, accountIds, accounts, date }) {
  const selected = new Set((accountIds || []).map(String));
  if (selected.size === 0) return 0;

  const liveSelected = new Set(
    (accounts || [])
      .filter(account => selected.has(String(accountIdOf(account))))
      .filter(account => !isPracticeAccountName(accountNameOf(account)))
      .map(account => String(accountIdOf(account)))
  );

  return (rows || []).reduce((total, row) => {
    if (row?.date !== date || row?.strategy !== 'morning_strategy') return total;
    if (row.account_id == null || !liveSelected.has(String(row.account_id))) return total;
    const realized = Number(row.realized);
    return Number.isFinite(realized) ? total + realized : total;
  }, 0);
}

function useSelectedDailyMorningPnl() {
  const { accountIds, accounts } = useSelectedAccounts();
  const today = chicagoDateKey();
  const selectionKey = [...accountIds].map(String).sort().join('|');
  const accountsReady = accountIds.every(id =>
    accounts.some(account => String(accountIdOf(account)) === String(id))
  );
  const [ledger, setLedger] = useState({ key: null, rows: [], ready: false });
  const [reconnectRevision, setReconnectRevision] = useState(0);

  useEffect(() => {
    const reload = () => setReconnectRevision(revision => revision + 1);
    window.addEventListener('nq:ws-reconnect', reload);
    return () => window.removeEventListener('nq:ws-reconnect', reload);
  }, []);

  useEffect(() => {
    const key = `${today}:${selectionKey}`;
    if (!selectionKey) {
      setLedger({ key, rows: [], ready: true });
      return undefined;
    }
    if (!accountsReady) {
      setLedger({ key, rows: [], ready: false });
      return undefined;
    }

    const controller = new AbortController();
    const [year, month] = today.split('-').map(Number);
    setLedger({ key, rows: [], ready: false });
    getMonthlyPnL(month, year, 'morning_strategy', null, controller.signal)
      .then(rows => {
        if (!controller.signal.aborted) {
          setLedger({ key, rows: Array.isArray(rows) ? rows : [], ready: true });
        }
      })
      .catch(error => {
        if (error.name !== 'AbortError') setLedger({ key, rows: [], ready: false });
      });
    return () => controller.abort();
  }, [accountsReady, reconnectRevision, selectionKey, today]);

  useEffect(() => {
    const key = `${today}:${selectionKey}`;
    const handlePnl = event => {
      const row = event.detail;
      if (!row || row.type !== 'pnl_monthly') return;
      if (row.date !== today || row.strategy !== 'morning_strategy' || row.account_id == null) return;
      if (!accountIds.map(String).includes(String(row.account_id))) return;

      setLedger(previous => {
        if (!previous.ready || previous.key !== key) return previous;
        const rows = [...previous.rows];
        const index = rows.findIndex(candidate =>
          candidate.date === row.date
          && candidate.strategy === row.strategy
          && String(candidate.account_id) === String(row.account_id)
        );
        if (index === -1) rows.push(row);
        else rows[index] = row;
        return { ...previous, rows };
      });
    };
    window.addEventListener('nq:integrated-pnl', handlePnl);
    return () => window.removeEventListener('nq:integrated-pnl', handlePnl);
  }, [accountIds, selectionKey, today]);

  const dailyPnl = useMemo(() => {
    if (!ledger.ready || ledger.key !== `${today}:${selectionKey}` || !accountsReady) return null;
    return aggregateSelectedDailyRealizedPnl({
      rows: ledger.rows,
      accountIds,
      accounts,
      date: today,
    });
  }, [accountIds, accounts, accountsReady, ledger, selectionKey, today]);

  return dailyPnl;
}

const STATE_COPY = {
  celebrate: {
    badge: 'GREEN DAY',
    label: 'Doberman Lounge: profitable day, Doberman celebrating',
  },
  lose: {
    badge: 'RED DAY',
    label: 'Doberman Lounge: losing day, Doberman lying down',
  },
  run: {
    badge: 'ARMED',
    label: 'Doberman Lounge: bot armed, Doberman running',
  },
  sit: {
    badge: 'OFF DUTY',
    label: 'Doberman Lounge: bot disarmed, Doberman sitting',
  },
};

function DobermanSprite() {
  return (
    <g className="dl-dog-motion dl-doberman-reference" data-dog-style="black-rust-profile">
      <g className="dl-dog-pose dl-dog-pose--run" transform="translate(160 140)">
        <path d="M-31-35H34V-30H46V-22H53V5H45V12H-30V6H-39V-25H-31Z" className="dl-dog-shadow" />
        <path d="M-30-33H35V-27H46V4H38V9H-29V3H-36V-24H-30Z" className="dl-dog-ink" />
        <path d="M-34-25H-47V-42H-58V-58H-47V-68H-37V-53H-26V-39H-18V-25Z" className="dl-dog-ink" />
        <path d="M-58-55H-78V-49H-91V-35H-78V-29H-51V-36H-43V-51H-58Z" className="dl-dog-ink" />
        <path d="M-51-58V-77H-43V-67H-36V-52ZM-68-54V-70H-60V-61H-54V-52Z" className="dl-dog-ink" />
        <path d="M45-24H58V-31H66V-42H73V-34H69V-20H61V-9H48Z" className="dl-dog-ink" />
        <path d="M-27 6H-17V24H-7V31H-25V24H-32V10ZM22 6H32V18H43V25H27V31H13V24H20Z" className="dl-dog-ink" />
        <path d="M-29 8H-20V22H-13V29H-25V23H-29ZM24 7H32V18H39V24H28V29H20V23H24Z" className="dl-rust" />
        <path d="M-91-42H-74V-34H-88V-37H-94V-42ZM-65-55H-56V-49H-66ZM-49-46H-42V-33H-48Z" className="dl-rust" />
        <rect x="-72" y="-50" width="4" height="4" className="dl-eye" />
        <rect x="-38" y="-31" width="5" height="26" className="dl-rust-hi" />
      </g>

      <g className="dl-dog-pose dl-dog-pose--sit" transform="translate(160 145)">
        <path d="M-24-42H14V-30H27V-14H37V7H29V15H-26V7H-35V-27H-24Z" className="dl-dog-shadow" />
        <path d="M-26-43H7V-35H17V-18H26V6H18V12H-25V5H-32V-30H-26Z" className="dl-dog-ink" />
        <path d="M-27-34H-43V-52H-54V-68H-44V-78H-34V-61H-22V-44H-15V-30Z" className="dl-dog-ink" />
        <path d="M-54-65H-74V-59H-87V-45H-72V-39H-48V-47H-40V-61H-54Z" className="dl-dog-ink" />
        <path d="M-47-69V-87H-39V-76H-33V-62ZM-65-64V-80H-57V-71H-51V-62Z" className="dl-dog-ink" />
        <path d="M18-13H33V-3H40V12H31V17H12V10H17Z" className="dl-dog-ink" />
        <path d="M-23 6H-13V27H-5V33H-25V27H-30V11ZM13 10H24V27H34V33H11Z" className="dl-dog-ink" />
        <path d="M-87-52H-70V-44H-84V-47H-90ZM-61-65H-53V-58H-62ZM-43-55H-36V-41H-42Z" className="dl-rust" />
        <path d="M-25 7H-16V26H-9V31H-24ZM17 12H24V27H31V31H15Z" className="dl-rust" />
        <rect x="-68" y="-60" width="4" height="4" className="dl-eye" />
        <rect x="-34" y="-39" width="5" height="27" className="dl-rust-hi" />
      </g>

      <g className="dl-dog-pose dl-dog-pose--celebrate" transform="translate(160 135)">
        <path d="M-31-35H34V-30H46V-22H53V5H45V12H-30V6H-39V-25H-31Z" className="dl-dog-shadow" />
        <path d="M-30-33H35V-27H46V4H38V9H-29V3H-36V-24H-30Z" className="dl-dog-ink" />
        <path d="M-34-25H-47V-42H-58V-58H-47V-68H-37V-53H-26V-39H-18V-25Z" className="dl-dog-ink" />
        <path d="M-58-55H-78V-49H-91V-35H-78V-29H-51V-36H-43V-51H-58Z" className="dl-dog-ink" />
        <path d="M-51-58V-77H-43V-67H-36V-52ZM-68-54V-70H-60V-61H-54V-52Z" className="dl-dog-ink" />
        <path d="M45-24H58V-31H66V-42H73V-34H69V-20H61V-9H48Z" className="dl-dog-ink" />
        <path d="M-27 4H-17V-14H-9V-22H-25V-14H-31ZM23 5H33V-12H43V-20H27V-13H21Z" className="dl-dog-ink" />
        <path d="M-28-16H-19V-8H-27ZM25-15H34V-8H24Z" className="dl-rust" />
        <path d="M-91-42H-74V-34H-88V-37H-94V-42ZM-65-55H-56V-49H-66ZM-49-46H-42V-33H-48Z" className="dl-rust" />
        <rect x="-72" y="-50" width="4" height="4" className="dl-eye" />
        <rect x="-38" y="-31" width="5" height="26" className="dl-rust-hi" />
      </g>

      <g className="dl-dog-pose dl-dog-pose--lose" transform="translate(160 151)">
        <path d="M-30-27H43V-21H54V-5H46V3H-37V-2H-48V-15H-39V-22H-30Z" className="dl-dog-shadow" />
        <path d="M-31-25H42V-19H50V-3H42V1H-38V-4H-46V-14H-37V-20H-31Z" className="dl-dog-ink" />
        <path d="M-38-17H-54V-30H-64V-43H-54V-51H-44V-39H-34V-25H-27V-17Z" className="dl-dog-ink" />
        <path d="M-64-41H-82V-36H-95V-24H-78V-20H-51V-27H-44V-38H-64Z" className="dl-dog-ink" />
        <path d="M-58-43V-57H-50V-49H-44V-38ZM-73-40V-52H-66V-45H-61V-38Z" className="dl-dog-ink" />
        <path d="M47-18H60V-24H68V-31H74V-24H70V-14H62V-6H50Z" className="dl-dog-ink" />
        <path d="M-30-3H-5V5H-35V1H-42V-4ZM23-2H47V5H17V2H10V-3Z" className="dl-dog-ink" />
        <path d="M-95-31H-78V-24H-92V-27H-98ZM-70-42H-62V-36H-71ZM-53-34H-46V-23H-52Z" className="dl-rust" />
        <rect x="-77" y="-37" width="4" height="4" className="dl-eye" />
        <rect x="-42" y="-19" width="5" height="16" className="dl-rust-hi" />
      </g>
    </g>
  );
}

function LoungeScene({ state }) {
  return (
    <svg
      className="dl-scene"
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="dl-grid-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" className="dl-grid-line" />
        </pattern>
      </defs>
      <rect width="320" height="180" className="dl-wall" />
      <rect width="320" height="118" className="dl-grid" />
      <rect y="118" width="320" height="62" className="dl-floor" />
      <path d="M0 124H320M0 143H320M0 162H320" className="dl-floor-lines" />

      <g className="dl-poster">
        <rect x="137" y="14" width="46" height="31" />
        <path d="M147 36V23H152L160 32V23H165V36H160L152 28V36ZM168 36V23H174V31H180V36Z" />
      </g>

      <g className="dl-tv">
        <rect x="124" y="51" width="72" height="43" className="dl-tv-frame" />
        <rect x="131" y="57" width="58" height="30" className="dl-tv-screen" />
        <path d="M137 78L147 68L155 73L166 62L184 78" className="dl-tv-chart" />
        <rect x="155" y="94" width="10" height="8" className="dl-tv-frame" />
        <rect x="142" y="101" width="36" height="5" className="dl-tv-frame" />
      </g>

      <g className="dl-couch">
        <rect x="18" y="91" width="86" height="38" className="dl-couch-dark" />
        <rect x="26" y="81" width="69" height="34" className="dl-couch-main" />
        <rect x="14" y="101" width="16" height="32" className="dl-couch-main" />
        <rect x="92" y="101" width="16" height="32" className="dl-couch-main" />
        <path d="M59 82V115M28 102H94" className="dl-couch-seam" />
        <rect x="22" y="129" width="9" height="8" className="dl-furniture-shadow" />
        <rect x="91" y="129" width="9" height="8" className="dl-furniture-shadow" />
      </g>

      <g className="dl-lamp">
        <rect x="111" y="66" width="5" height="62" className="dl-lamp-metal" />
        <path d="M98 62H129L124 80H103Z" className="dl-lamp-shade" />
        <rect x="103" y="128" width="22" height="5" className="dl-lamp-metal" />
      </g>

      <g className="dl-bookshelf">
        <rect x="245" y="42" width="59" height="96" className="dl-shelf-frame" />
        <path d="M251 72H298M251 103H298" className="dl-shelf-line" />
        <path d="M255 51V68M262 48V68M271 54V68M282 49V68M290 53V68M254 79V99M264 83V99M273 77V99M285 81V99M293 76V99M255 110V132M266 113V132M278 108V132M290 115V132" className="dl-books" />
      </g>

      <ellipse cx="160" cy="154" rx="61" ry="19" className="dl-rug" />
      <path d="M111 154H209M124 144H196M125 164H195" className="dl-rug-lines" />

      {state === 'celebrate' && (
        <g className="dl-sparkles">
          <rect x="115" y="100" width="5" height="5" style={{ '--spark-delay': '0s' }} />
          <rect x="203" y="110" width="4" height="4" style={{ '--spark-delay': '-.4s' }} />
          <rect x="137" y="78" width="4" height="4" style={{ '--spark-delay': '-.8s' }} />
          <rect x="185" y="84" width="5" height="5" style={{ '--spark-delay': '-1.2s' }} />
          <rect x="220" y="137" width="3" height="3" style={{ '--spark-delay': '-1.6s' }} />
        </g>
      )}
      <DobermanSprite />
    </svg>
  );
}

export function DobermanLoungeView({ isArmed, dailyPnl }) {
  const state = getDobermanState({ isArmed, dailyPnl });
  const copy = STATE_COPY[state];
  return (
    <section className={`card dl-panel dl-panel--${state}`} aria-label={copy.label} data-state={state}>
      <header className="dl-header">
        <h3 className="panel-title dl-title">Doberman Lounge</h3>
        <span className="dl-badge">{copy.badge}</span>
      </header>
      <div className="dl-room" data-testid="doberman-room">
        <LoungeScene state={state} />
      </div>
    </section>
  );
}

export default function DobermanLounge() {
  const snapshot = useTestBotSnapshot('live');
  const dailyPnl = useSelectedDailyMorningPnl();
  const isArmed = isDobermanArmed(snapshot);
  return <DobermanLoungeView isArmed={isArmed} dailyPnl={dailyPnl} />;
}
