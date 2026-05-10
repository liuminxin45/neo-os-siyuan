const { Plugin } = require("siyuan");

class SiyuanAddonPlugin extends Plugin {
  async onload() {}

  onLayoutReady() {}

  onunload() {}
}

module.exports = {
  default: SiyuanAddonPlugin,
};
