import './GetStartedTab.css';

const TABS_GUIDE = [
  { name: 'Topstep',      desc: 'Your live Morning Strategy bot on Topstep. Arm/disarm, watch positions, and adjust trade parameters here.' },
  { name: 'Tradovate',    desc: 'Reserved for the upcoming Tradovate integration (Apex, Lucid, and other accounts routed through Tradovate). Not connected yet.' },
  { name: 'System Health', desc: 'Live diagnostics: connectivity, market feed freshness, clock sync, and safety checks. Check here first if something looks off.' },
  { name: 'Trade Recap',  desc: 'Your P&L history by day and by account -- click any day on the calendar to see the trades that made it up.' },
  { name: 'Pre-Flight',   desc: 'A checklist that confirms the bot is genuinely ready to arm before the market opens -- everything green means go.' },
];

const STEPS = [
  'Open the app and wait for the loading screen to finish -- it stays up until the bot has actually synced with Topstep, not just "started."',
  'Check Bot Health on the Topstep tab -- it should say OK, with Strategy / Risk / Exec / Pos. Mgr all lit up green.',
  'Open "Topstep Accounts" (top right) and make sure the accounts you want to trade are checked.',
  'Review Trade Parameters -- take profit, stop loss, trailing settings -- these carry over from last time unless you change them.',
  'Flip the switch from OFF to ON before 8:30 AM CT. Once armed, the bot fires automatically at the scheduled time -- no further clicking needed.',
];

const API_KEY_STEPS = [
  'Log in to your Topstep account and navigate to TopstepX.',
  'Go to Settings under any account you own.',
  'Click API.',
  'On the right side, select "Link to ProjectX."',
  'You\'ll be redirected to sign up under "Subscriptions" for a ProjectX API key -- this is Topstep\'s official gateway that lets outside software (your bot) place trades on your behalf.',
  'Once you have a ProjectX subscription, navigate back to ProjectX and click "Generate API key."',
  'Copy that key and paste it into the Topstep API Key field in your credentials.',
];

const FAQS = [
  {
    q: 'What does "Bot Health: OK" actually mean?',
    a: 'It means all four systems it checks -- Strategy, Risk, Exec (execution), and Pos. Mgr (position manager) -- are running normally. If any of those four turn red or gray, something in that specific system needs attention before it\'s safe to arm.',
  },
  {
    q: 'What if I see an error or a red indicator somewhere?',
    a: 'Check the System Health tab first -- it explains connectivity, market feed, and safety status in plain language. If it\'s not obvious what\'s wrong or what to do, stop and reach out rather than guessing.',
  },
  {
    q: 'What is a "Trailing Stop"?',
    a: 'Once a trade moves in your favor, the trailing stop automatically follows the price up (or down, if short) to lock in gains, instead of leaving your stop loss fixed at the original entry price the whole time.',
  },
  {
    q: 'What do "Breakeven Trigger" and "Profit Lock" mean?',
    a: 'Breakeven Trigger moves your stop to your entry price once you\'re up by that many dollars, so the trade can no longer lose money. Profit Lock goes further: once you\'re up by its trigger amount, it locks in a percentage of whatever the peak profit was, so a pullback can\'t erase all of your gains.',
  },
  {
    q: 'What happens if my computer goes to sleep or loses internet?',
    a: 'The bot corrects for clock drift and re-checks its connection automatically when the machine wakes back up. If the market feed goes stale, System Health will show it clearly rather than silently trading on old data.',
  },
  {
    q: 'Why did the live price stop updating?',
    a: 'Most often this just means the market is closed (evenings, weekends, holidays). If it\'s during regular trading hours, check System Health\'s "Feed Freshness" -- if it says stale, the bot already knows and is trying to reconnect on its own.',
  },
  {
    q: 'Can I close the app while a trade is open?',
    a: 'Don\'t. Closing the app stops the bot\'s ability to manage the trade (trailing stop, exits, etc.). Leave it running until you\'re flat for the day.',
  },
  {
    q: 'Where do I see how the bot has actually done?',
    a: 'The Trade Recap tab -- it shows realized P&L by day, and clicking any day shows the individual trades that made it up.',
  },
  {
    q: 'What\'s the difference between the accounts listed under "Topstep Accounts"?',
    a: 'Each one is a real Topstep account under your login. Only the ones you check will be traded -- unchecked accounts are simply skipped when the bot arms.',
  },
];

export default function GetStartedTab() {
  return (
    <div className="tab-single-col gst-tab">

      <header className="gst-hero">
        <span className="gst-eyebrow">Help center</span>
        <h1 className="gst-title">Get started with confidence</h1>
        <p className="gst-hero-copy">
          Everything you need to connect Topstep, prepare for the trading day,
          and understand what the dashboard is telling you.
        </p>
      </header>

      <div className="card gst-card">
        <div className="gst-section-heading">
          <span className="gst-section-number">01</span>
          <div>
            <div className="panel-title">Setup and daily workflow</div>
            <p className="gst-section-copy">Connect your account, learn the workspace, and prepare the bot before market open.</p>
          </div>
        </div>

        <div className="gst-subhead">Getting your ProjectX API key</div>
        <p className="gst-intro">
          Your API key is what lets the bot place trades on your behalf through Topstep's
          official ProjectX gateway -- without it, the bot has no way to connect to your account.
        </p>
        <ol className="gst-steps">
          {API_KEY_STEPS.map((step, i) => <li key={i}>{step}</li>)}
        </ol>

        <div className="gst-subhead">Your tabs</div>
        <div className="gst-tabs-list">
          {TABS_GUIDE.map(t => (
            <div className="gst-tab-row" key={t.name}>
              <span className="gst-tab-name">{t.name}</span>
              <span className="gst-tab-desc">{t.desc}</span>
            </div>
          ))}
        </div>

        <div className="gst-subhead">Arming the bot before market open</div>
        <ol className="gst-steps">
          {STEPS.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>

      <div className="card gst-card gst-faq-card">
        <div className="gst-section-heading">
          <span className="gst-section-number">02</span>
          <div>
            <div className="panel-title">Frequently asked questions</div>
            <p className="gst-section-copy">Clear answers to the questions that come up most often.</p>
          </div>
        </div>
        <div className="gst-faq-list">
          {FAQS.map(({ q, a }) => (
            <details className="gst-faq-item" key={q}>
              <summary className="gst-faq-q">{q}</summary>
              <p className="gst-faq-a">{a}</p>
            </details>
          ))}
        </div>
      </div>

    </div>
  );
}
