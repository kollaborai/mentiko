#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/system/native-plugin-handler-cli.ts
var native_plugin_handler_cli_exports = {};
__export(native_plugin_handler_cli_exports, {
  runNativePluginHandlerCli: () => runNativePluginHandlerCli
});
module.exports = __toCommonJS(native_plugin_handler_cli_exports);
var HANDLERS = /* @__PURE__ */ new Set(["pagerduty", "github-pr", "linear", "custom-webhook", "email-digest", "notify-email"]);
function runNativePluginHandlerCli(argv) {
  if (argv[0] !== "dispatch" || argv[1] !== "--handler" || argv.length !== 3 || !HANDLERS.has(argv[2])) {
    throw new Error("usage: runner-native-plugin dispatch --handler <builtin-handler>");
  }
  throw new Error(`native plugin handler is not implemented: ${argv[2]}`);
}
if (require.main === module) {
  try {
    runNativePluginHandlerCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runNativePluginHandlerCli
});
