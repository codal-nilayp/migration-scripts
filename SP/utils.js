import fs from "fs-extra";

export async function safeExecute(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`❌ ${label}`, e);
    return null;
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const resumeStore = {
  file: "resume.json",

  load() {
    if (!fs.existsSync(this.file)) return null;
    return fs.readJsonSync(this.file);
  },

  save(handle) {
    fs.writeJsonSync(this.file, { lastHandle: handle });
  }
};
