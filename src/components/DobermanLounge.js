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

function StandingDoberman({ pose }) {
  return (
    <g className={`dl-dog-pose dl-dog-pose--${pose}`} transform="translate(160 140)">
      {/* Lean torso, deep chest and pronounced tuck-up. */}
      <path d="M-41-42H22L39-36L49-25V-11H35L27-17H8L1-8H-18L-23-17H-36L-46-27Z" className="dl-dog-shadow" />
      <path d="M-43-45H21L38-39L46-29V-14H33L25-21H7L-1-11H-20L-26-20H-39L-49-31Z" className="dl-dog-ink" />
      {/* Tall neck and unmistakably long Doberman head/muzzle. */}
      <path d="M-48-65L-27-72L-14-59L-18-39L-35-25L-50-34L-56-50Z" className="dl-dog-ink" />
      <path d="M-86-72H-50L-36-62L-40-49L-63-43L-88-48L-99-57L-96-67Z" className="dl-dog-ink" />
      <path d="M-100-63H-79V-48H-94L-104-54Z" className="dl-dog-ink" />
      {/* Cropped upright ears. */}
      <path d="M-78-70L-73-103L-61-76ZM-56-73L-48-101L-41-65Z" className="dl-dog-ink" />
      {/* Long athletic legs and high-set docked tail. */}
      <path d="M-34-22H-20V24H-10V31H-30L-37 24ZM22-20H35V17L44 24V31H25L18 24Z" className="dl-dog-ink" />
      <path d="M38-38L54-47L63-61L71-59L66-43L53-29L44-23Z" className="dl-dog-ink" />
      {/* Rust muzzle, brows, throat, chest and stockings. */}
      <path d="M-101-59H-80V-50H-94L-102-55ZM-76-67H-65V-61H-77ZM-48-56H-40V-48H-49Z" className="dl-rust" />
      <path d="M-50-45L-39-35L-34-20H-43L-50-31Z" className="dl-rust-hi" />
      <path d="M-34 8H-21V25H-13V29H-29L-35 24ZM23 7H34V18L42 25V29H28L22 23Z" className="dl-rust" />
      <rect x="-73" y="-62" width="5" height="5" className="dl-eye" />
      <rect x="-104" y="-59" width="5" height="6" className="dl-nose" />
      <rect x="-48" y="-47" width="11" height="4" className="dl-collar" />
    </g>
  );
}

function SittingDoberman() {
  return (
    <g className="dl-dog-pose dl-dog-pose--sit" transform="translate(160 143)">
      {/* Front-facing pose: a strong symmetrical breed silhouette remains
          readable against the couch, TV and dark floor at small sizes. */}
      <path d="M-34-65L-30-101L-12-76H12L30-101L34-65L32-41L20-23H-20L-32-41Z" className="dl-dog-outline" />
      <path d="M-28-63L-26-91L-10-71H10L26-91L28-63L27-43L17-28H-17L-27-43Z" className="dl-dog-ink" />
      <path d="M-27-83L-18-73L-27-69ZM27-83L18-73L27-69Z" className="dl-ear-rust" />

      {/* Long wedge muzzle and classic rust cheek points. */}
      <path d="M-22-52H22L28-39L20-21H-20L-28-39Z" className="dl-rust" />
      <path d="M-13-48H13L20-35L13-20H-13L-20-35Z" className="dl-dog-muzzle" />
      <path d="M-9-45H9V-38L5-34H-5L-9-38Z" className="dl-nose" />
      <path d="M-13-27H13V-23H-13Z" className="dl-mouth" />
      <rect x="-23" y="-58" width="10" height="6" className="dl-rust-hi" />
      <rect x="13" y="-58" width="10" height="6" className="dl-rust-hi" />
      <rect x="-19" y="-50" width="4" height="4" className="dl-eye" />
      <rect x="15" y="-50" width="4" height="4" className="dl-eye" />
      <rect x="-24" y="-27" width="48" height="5" className="dl-collar" />
      <rect x="-3" y="-22" width="6" height="7" className="dl-collar-tag" />

      {/* Deep chest, narrow waist, straight forelegs and seated haunches. */}
      <path d="M-25-22L-43-6L-48 21L-37 30H-17L-10 18H10L17 30H37L48 21L43-6L25-22Z" className="dl-dog-outline" />
      <path d="M-22-19L-37-5L-41 18L-33 25H-18L-12 13H12L18 25H33L41 18L37-5L22-19Z" className="dl-dog-ink" />
      <path d="M-15-16H-3V7H-11L-18-2ZM3-16H15L18-2L11 7H3Z" className="dl-rust-hi" />
      <path d="M-29-5H-15V25H-8V31H-31V25H-26ZM15-5H29L26 25H31V31H8V25H15Z" className="dl-dog-ink" />
      <path d="M-28 12H-16V25H-10V29H-29ZM16 12H28L29 29H10V25H16Z" className="dl-rust" />
    </g>
  );
}

function RestingDoberman() {
  return (
    <g className="dl-dog-pose dl-dog-pose--lose" transform="translate(160 150)">
      <path d="M-43-30H31L48-23L51-10L42-3H-34L-48-9L-52-20Z" className="dl-dog-shadow" />
      <path d="M-46-33H29L45-26L48-13L39-6H-36L-51-12L-55-23Z" className="dl-dog-ink" />
      <path d="M-55-48L-38-54L-26-43L-31-27L-47-18L-61-27Z" className="dl-dog-ink" />
      <path d="M-88-55H-57L-45-47L-49-35L-70-29L-94-34L-103-42L-100-51Z" className="dl-dog-ink" />
      <path d="M-103-47H-82V-33H-97L-108-39Z" className="dl-dog-ink" />
      <path d="M-82-54L-78-78L-66-59ZM-62-56L-55-77L-49-49Z" className="dl-dog-ink" />
      <path d="M-40-11H-5V-2H-47L-55-7ZM18-10H45V-2H10Z" className="dl-dog-ink" />
      <path d="M42-25L57-32L67-42L73-38L66-27L51-18Z" className="dl-dog-ink" />
      <path d="M-105-43H-84V-35H-98L-106-40ZM-79-51H-68V-45H-80ZM-55-43H-48V-36H-56Z" className="dl-rust" />
      <path d="M-59-35L-48-27L-44-16H-53L-59-25Z" className="dl-rust-hi" />
      <path d="M-39-9H-12V-3H-43ZM23-9H43V-3H18Z" className="dl-rust" />
      <rect x="-76" y="-47" width="5" height="4" className="dl-eye" />
      <rect x="-108" y="-43" width="5" height="6" className="dl-nose" />
      <rect x="-57" y="-37" width="11" height="4" className="dl-collar" />
    </g>
  );
}

function DobermanSprite() {
  return (
    <g className="dl-dog-motion dl-doberman-reference" data-dog-style="black-rust-profile">
      <StandingDoberman pose="run" />
      <SittingDoberman />
      <StandingDoberman pose="celebrate" />
      <RestingDoberman />
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
