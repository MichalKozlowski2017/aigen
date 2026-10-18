import { THEME_STORAGE_KEY } from "./theme";

/** Inline boot script — sets data-theme before paint (default light). */
export function ThemeScript() {
  const code = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark")t="light";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
