import { sandboxReady } from "../api";
import { useLab } from "../store";
import { Mark } from "./ui";

const NAV = [
  ["market", "Marketplace"], ["trial", "Trial"], ["watch", "Watch"], ["record", "Record"], ["gate", "Gate"],
  ["integrations", "Integrations"], ["identities", "Identities"], ["products", "Products"],
] as const;

export function TopBar() {
  const { health } = useLab();
  const sandbox = health && sandboxReady(health);
  return (
    <header className="bar">
      <div className="wrap bar__in">
        <a className="wordmark" href="#top" aria-label="Mole, back to top"><Mark /> Mole</a>
        <nav className="bar__nav" aria-label="Sections">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="bar__status" role="status">
          <span><i className={`dot ${health ? "dot--on" : "dot--off"}`} /> lab {health ? "online" : "offline"}</span>
          <span><i className={`dot ${health?.registry.ok ? "dot--on" : "dot--off"}`} /> registry {health?.registry.ok ? `${health.registry.ms}ms` : "—"}</span>
          <span><i className={`dot ${sandbox ? "dot--on" : "dot--off"}`} /> sandbox {sandbox ? (health.sandbox.kind === "microvm" ? "microVM" : "ready") : health ? "unavailable" : "—"}</span>
        </div>
      </div>
    </header>
  );
}
