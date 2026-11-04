const { initializeSettings } = require("./utils/config");

App({
  onLaunch() {
    initializeSettings();
  }
});
