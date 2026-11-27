import "virtual:uno.css";
import "@/styles/global.css";
import { createApp } from "vue";
import { vRipple } from "@/directives/ripple";
import App from "./App.vue";
import { syncCompanionTheme } from "./theme";

const app = createApp(App);
app.directive("ripple", vRipple);

let mounted = false;
const stopTheme = syncCompanionTheme(() => {
  app.mount("#app");
  mounted = true;
});

/** 页面卸载或开发模式重载时释放窗口订阅 */
function dispose() {
  window.removeEventListener("pagehide", dispose);
  stopTheme();
  if (mounted) {
    app.unmount();
    mounted = false;
  }
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
