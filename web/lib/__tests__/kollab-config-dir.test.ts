import { homedir } from "node:os";
import { join } from "node:path";
import { kollabConfigDir } from "../kollab-config-dir";

describe("kollabConfigDir", () => {
  const prev = process.env.KOLLAB_CONFIG_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.KOLLAB_CONFIG_DIR;
    else process.env.KOLLAB_CONFIG_DIR = prev;
  });

  it("uses KOLLAB_CONFIG_DIR when set, else ~/.kollab", () => {
    process.env.KOLLAB_CONFIG_DIR = "/tmp/mentiko-kollab";
    expect(kollabConfigDir()).toBe("/tmp/mentiko-kollab");
    process.env.KOLLAB_CONFIG_DIR = "  ";
    expect(kollabConfigDir()).toBe(join(homedir(), ".kollab"));
    delete process.env.KOLLAB_CONFIG_DIR;
    expect(kollabConfigDir()).toBe(join(homedir(), ".kollab"));
  });
});
