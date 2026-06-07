// Canvas LMS plugin entrypoint.
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { resolveCanvasConfig } from "./src/config.js";
import { CanvasPoller } from "./src/poller.js";

export default definePluginEntry({
  id: "canvas-lms",
  name: "Canvas LMS",
  description:
    "Polls Canvas LMS for assignments, deadlines, and announcements. Surfaces urgent items to Jarvis via TaskFlow.",
  register(api: OpenClawPluginApi) {
    let config;
    try {
      config = resolveCanvasConfig(api.pluginConfig);
    } catch (err) {
      api.logger.warn?.(`[canvas-lms] skipping startup — ${String(err)}`);
      return;
    }

    const poller = new CanvasPoller(config, api.runtime, api.logger);
    poller.start();

    // Clean up on shutdown so the interval doesn't keep the process alive.
    api.onDispose?.(() => poller.stop());
  },
});
