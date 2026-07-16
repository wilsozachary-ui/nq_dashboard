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

function DogMarkings() {
  return (
    <>
      <rect x="-11" y="-23" width="7" height="7" className="dl-rust" />
      <rect x="4" y="-23" width="7" height="7" className="dl-rust" />
      <rect x="-7" y="-13" width="14" height="5" className="dl-rust" />
      <rect x="-13" y="-25" width="4" height="4" className="dl-eye" />
      <rect x="9" y="-25" width="4" height="4" className="dl-eye" />
    </>
  );
}

function DobermanSprite() {
  return (
    <g className="dl-dog-motion">
      <g className="dl-dog-pose dl-dog-pose--run" transform="translate(160 138)">
        <rect x="-30" y="-25" width="51" height="22" className="dl-dog-black" />
        <rect x="15" y="-38" width="24" height="28" className="dl-dog-black" />
        <polygon points="18,-38 21,-54 29,-39" className="dl-dog-black" />
        <polygon points="30,-39 38,-54 38,-36" className="dl-dog-black" />
        <rect x="-42" y="-30" width="15" height="6" className="dl-dog-black" />
        <rect x="-26" y="-5" width="8" height="22" className="dl-dog-black" />
        <rect x="10" y="-5" width="8" height="22" className="dl-dog-black" />
        <rect x="-19" y="13" width="21" height="5" className="dl-rust" />
        <rect x="16" y="13" width="20" height="5" className="dl-rust" />
        <g transform="translate(27 -15)"><DogMarkings /></g>
      </g>

      <g className="dl-dog-pose dl-dog-pose--sit" transform="translate(160 145)">
        <rect x="-19" y="-37" width="38" height="31" className="dl-dog-black" />
        <rect x="-24" y="-13" width="48" height="19" className="dl-dog-black" />
        <rect x="-15" y="-62" width="30" height="29" className="dl-dog-black" />
        <polygon points="-14,-61 -11,-78 -2,-62" className="dl-dog-black" />
        <polygon points="3,-62 12,-78 14,-59" className="dl-dog-black" />
        <rect x="-20" y="3" width="9" height="16" className="dl-dog-black" />
        <rect x="11" y="3" width="9" height="16" className="dl-dog-black" />
        <rect x="-22" y="16" width="13" height="5" className="dl-rust" />
        <rect x="9" y="16" width="13" height="5" className="dl-rust" />
        <g transform="translate(0 -39)"><DogMarkings /></g>
      </g>

      <g className="dl-dog-pose dl-dog-pose--celebrate" transform="translate(160 135)">
        <rect x="-24" y="-33" width="46" height="27" className="dl-dog-black" />
        <rect x="-14" y="-58" width="29" height="28" className="dl-dog-black" />
        <polygon points="-13,-57 -10,-73 -1,-58" className="dl-dog-black" />
        <polygon points="3,-58 12,-73 14,-55" className="dl-dog-black" />
        <rect x="-31" y="-31" width="8" height="25" className="dl-dog-black" />
        <rect x="22" y="-31" width="8" height="25" className="dl-dog-black" />
        <rect x="-20" y="-7" width="8" height="25" className="dl-dog-black" />
        <rect x="12" y="-7" width="8" height="25" className="dl-dog-black" />
        <rect x="-33" y="-8" width="12" height="5" className="dl-rust" />
        <rect x="21" y="-8" width="12" height="5" className="dl-rust" />
        <rect x="-22" y="15" width="13" height="5" className="dl-rust" />
        <rect x="9" y="15" width="13" height="5" className="dl-rust" />
        <g transform="translate(0 -35)"><DogMarkings /></g>
      </g>

      <g className="dl-dog-pose dl-dog-pose--lose" transform="translate(160 151)">
        <rect x="-43" y="-20" width="67" height="20" className="dl-dog-black" />
        <rect x="18" y="-27" width="29" height="22" className="dl-dog-black" />
        <polygon points="22,-26 25,-38 32,-27" className="dl-dog-black" />
        <polygon points="35,-27 43,-37 44,-23" className="dl-dog-black" />
        <rect x="-48" y="-4" width="36" height="6" className="dl-dog-black" />
        <rect x="-35" y="-5" width="18" height="6" className="dl-rust" />
        <g transform="translate(33 -4)"><DogMarkings /></g>
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
