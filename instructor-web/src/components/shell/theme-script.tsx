const THEME_KEY = 'nacolm-theme';

// Runs before paint so there's no flash of the wrong theme. Sets data-theme
// only when the user has explicitly chosen one (see ThemeToggle) — with
// nothing stored, globals.css's @media (prefers-color-scheme: dark) rule
// decides, so a first-time visitor still gets the right theme for their OS.
const SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${THEME_KEY}');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export function ThemeScript() {
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

export { THEME_KEY };
