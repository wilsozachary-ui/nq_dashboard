import SystemHealthPanel from './SystemHealthPanel';
import BotLogConsole from './BotLogConsole';

export default function SystemHealthTab() {
  return (
    <div className="tab-single-col">
      <SystemHealthPanel />
      <BotLogConsole />
    </div>
  );
}
