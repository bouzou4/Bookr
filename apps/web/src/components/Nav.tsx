/** The dashboard's top-level sections. */
export type Tab = "watches" | "activity" | "credentials" | "health";

const TABS: { id: Tab; label: string }[] = [
  { id: "watches", label: "Watches" },
  { id: "activity", label: "Activity" },
  { id: "credentials", label: "Credentials" },
  { id: "health", label: "Health" },
];

/** Props for {@link Nav}. */
export interface NavProps {
  /** The currently selected tab. */
  active: Tab;
  /** Called with the newly selected tab id. */
  onSelect: (tab: Tab) => void;
  /** Called when the operator asks to log out. */
  onLogout: () => void;
}

/** Top navigation bar switching between the dashboard's sections. */
export function Nav({ active, onSelect, onLogout }: NavProps): React.JSX.Element {
  return (
    <nav className="nav">
      <span className="brand">Bookr</span>
      <ul>
        {TABS.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              className={tab.id === active ? "active" : ""}
              aria-current={tab.id === active ? "page" : undefined}
              onClick={() => onSelect(tab.id)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="logout" onClick={onLogout}>
        Log out
      </button>
    </nav>
  );
}
